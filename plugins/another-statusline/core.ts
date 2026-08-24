import { appendFileSync } from "node:fs";
import { execFile } from "node:child_process";

/**
 * Shared machinery for the statusline segments: the Segment contract, width
 * math, the width allocator, a command runner and a fetch poller. Segment
 * modules (segments/*.ts) import from here; index.ts assembles them.
 */

const ERROR_LOG = "/tmp/another-statusline-errors.log";

// ------------------------------------------------------------------ contract

/** Structural pick of the theme symbol set; the Theme class is not typed per-glyph. */
export interface IconHolder {
	icon?: {
		folder?: string;
		scratchFolder?: string;
		branch?: string;
		git?: string;
		pr?: string;
	};
}

export interface SegmentCtx {
	cwd: string;
	theme: IconHolder;
	/** Re-render the widget now (call when background data lands). */
	rerender(): void;
}

export interface SegmentView {
	text: string;
	/** OSC 8 target; index.ts wraps the truncated text with it. */
	href?: { kind: "file" | "url"; target: string };
}

export interface Segment {
	id: string;
	/** Width budget in cells: max = normal display cap, min = shrink floor. */
	max: number;
	min: number;
	/** Squeeze policy: "head" keeps the left part (default), "tail" keeps the right (path). */
	keep?: "head" | "tail";
	/** Render now; null hides the segment. May be async (commands, lookups). */
	render(ctx: SegmentCtx): SegmentView | null | Promise<SegmentView | null>;
	/** Start background refresh (fetch cadence, timers); rerender fires on new data. */
	start?(rerender: () => void): void;
}

// ------------------------------------------------------------- user config

export interface SegmentOption {
	max?: number;
	min?: number;
}

export interface StatuslineConfig {
	segments?: string[];
	segmentOptions?: Record<string, SegmentOption>;
}

/** Parse config text (YAML; JSON is valid YAML). Non-object top level or parse failure -> null. */
export function parseStatuslineConfig(text: string): StatuslineConfig | null {
	if (typeof Bun === "undefined" || typeof Bun.YAML?.parse !== "function") return null;
	let raw: unknown;
	try {
		raw = Bun.YAML.parse(text);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const cfg: StatuslineConfig = {};
	const rec = raw as Record<string, unknown>;
	if (Array.isArray(rec.segments) && rec.segments.every((s) => typeof s === "string")) {
		cfg.segments = rec.segments as string[];
	}
	if (typeof rec.segmentOptions === "object" && rec.segmentOptions !== null) {
		const opts: Record<string, SegmentOption> = {};
		for (const [id, val] of Object.entries(rec.segmentOptions as Record<string, unknown>)) {
			if (typeof val !== "object" || val === null) continue;
			const o: SegmentOption = {};
			const v = val as Record<string, unknown>;
			if (typeof v.max === "number" && Number.isInteger(v.max) && v.max >= 1) o.max = v.max;
			if (typeof v.min === "number" && Number.isInteger(v.min) && v.min >= 1) o.min = v.min;
			opts[id] = o;
		}
		cfg.segmentOptions = opts;
	}
	return cfg;
}

/** Reorder/filter segments per cfg.segments; null/empty/invalid -> all in built-in order; unknown ids excluded. */
export function resolveSegments(all: Segment[], cfg: StatuslineConfig | null): Segment[] {
	const order = cfg?.segments;
	if (!order || order.length === 0) return all;
	const out: Segment[] = [];
	for (const id of order) {
		const seg = all.find((s) => s.id === id);
		if (seg) out.push(seg);
	}
	return out;
}

/** Validated per-segment bounds; invalid fields ignored, min > max falls back to both built-ins. */
export function resolveBounds(seg: Segment, opt: SegmentOption | undefined): { max: number; min: number } {
	if (!opt) return { max: seg.max, min: seg.min };
	const max = typeof opt.max === "number" ? opt.max : seg.max;
	const min = typeof opt.min === "number" ? opt.min : seg.min;
	if (min > max) return { max: seg.max, min: seg.min };
	return { max, min };
}

// -------------------------------------------------------------- width logic

/** True for codepoints that render two terminal cells (CJK, emoji, fullwidth). */
function isWide(cp: number): boolean {
	return (
		(cp >= 0x1100 && cp <= 0x115f) ||
		(cp >= 0x2e80 && cp <= 0x303e) ||
		(cp >= 0x3041 && cp <= 0x33ff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x4e00 && cp <= 0xa4cf) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe30 && cp <= 0xfe4f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0x1f000 && cp <= 0x1fbff)
	);
}

/** Visible cell width of one character (wide/emoji codepoints count 2). */
function cellWidth(ch: string): number {
	return isWide(ch.codePointAt(0)!) ? 2 : 1;
}

/** Visible cell width of `text` (wide/emoji codepoints count 2, others 1). */
export function displayWidth(text: string): number {
	let w = 0;
	for (const ch of text) w += cellWidth(ch);
	return w;
}

/** Truncate to `width` cells keeping the rightmost part (path policy). */
export function truncateRight(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	const chars = [...text];
	let tail = "";
	let used = 0;
	for (let i = chars.length - 1; i >= 0 && used < width - 1; i--) {
		const cw = cellWidth(chars[i]);
		if (used + cw > width - 1) break;
		tail = chars[i] + tail;
		used += cw;
	}
	return `…${tail}`;
}

/** Truncate to `width` cells keeping the leftmost part (git/pr policy). */
export function truncateLeft(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	let head = "";
	let used = 0;
	for (const ch of text) {
		const cw = cellWidth(ch);
		if (used + cw > width - 1) break;
		head += ch;
		used += cw;
	}
	return `${head}…`;
}

/** Truncate to `width` cells keeping the `keep` side. */
export function truncate(text: string, keep: "head" | "tail", width: number): string {
	return keep === "tail" ? truncateRight(text, width) : truncateLeft(text, width);
}

export interface SegBudget {
	/** Normal width of the segment text, already capped at its max. */
	desired: number;
	/** Shrink floor before spilling into the segment on the left. */
	min: number;
}

/**
 * Allocate `budget` cells across `segs` (separators excluded from the
 * budget). When over budget, shrink rightmost first: down to each segment's
 * min, then below min (floor 1) continuing from the right until it fits.
 */
export function allocate(budget: number, segs: SegBudget[]): number[] {
	const w = segs.map((s) => s.desired);
	let excess = w.reduce((a, b) => a + b, 0) - budget;
	for (const floor of [null, 1] as const) {
		for (let i = w.length - 1; excess > 0 && i >= 0; i--) {
			const f = floor === null ? segs[i].min : floor;
			const room = w[i] - f;
			if (room <= 0) continue;
			const take = Math.min(room, excess);
			w[i] -= take;
			excess -= take;
		}
	}
	return w;
}

// ------------------------------------------------------------------ runners

/** Run a command capturing stdout; null on any failure (ENOENT, timeout, ...). */
export function run(cmd: string, args: string[], cwd: string, timeoutMs = 5000): Promise<string | null> {
	const { promise, resolve } = Promise.withResolvers<string | null>();
	execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
		resolve(err ? null : stdout);
	});
	return promise;
}

// ------------------------------------------------------------------- poller

export interface PollerSpec<T> {
	/** Verbatim label for the error log, e.g. `weather fetch failed (Taipei)`. */
	label: string;
	/** Refetch period (staleness threshold and background timer interval). */
	refreshMs: number;
	/** Floor between HTTP attempts. */
	minAttemptMs: number;
	/** One fetch attempt; null = HTTP error or unparseable body. */
	fetch(): Promise<T | null>;
}

export interface Poller<T> {
	/** Cached value; null until the first successful fetch. */
	data(): T | null;
	/** Fire a fetch when stale and off the attempt floor (fire-and-forget). */
	maybeFetch(): void;
	/** Start the unref'd refresh timer; rerender fires when fresh data lands. */
	start(rerender: () => void): void;
}

/**
 * Cache + cadence for a background-fetch segment (weather, stock). Fetch
 * failures keep the stale cache and only append to ERROR_LOG — they must
 * never surface as a widget-killing notify.
 */
export function createPoller<T extends { fetchedAt: number }>(spec: PollerSpec<T>): Poller<T> {
	let cache: T | null = null;
	let rerender: (() => void) | null = null;
	let attemptAt = 0;
	let inFlight: Promise<void> | null = null;

	const log = (err: unknown): void => {
		try {
			appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${spec.label}: ${err instanceof Error ? err.message : String(err)}\n`);
		} catch {
			// logging must never throw
		}
	};

	const fetch = (): Promise<void> => {
		if (inFlight) return inFlight;
		attemptAt = Date.now();
		inFlight = spec
			.fetch()
			.then((d) => {
				if (d) {
					cache = d;
					try {
						rerender?.();
					} catch {
						// the re-render hook must never break the fetch chain
					}
				} else log(new Error("no data (HTTP error or unparseable body)"));
			})
			.catch(log)
			.finally(() => {
				inFlight = null;
			});
		return inFlight;
	};

	return {
		data: () => cache,
		// Fire-and-forget: the widget renders at once (the segment hides while
		// the cache is empty) and rerender fires when data lands.
		maybeFetch: () => {
			const stale = cache === null || Date.now() - cache.fetchedAt >= spec.refreshMs;
			if (stale && Date.now() - attemptAt >= spec.minAttemptMs) void fetch();
		},
		start: (fn) => {
			rerender = fn;
			const timer = setInterval(() => void fetch(), spec.refreshMs);
			// The timer never keeps the process alive.
			timer.unref();
		},
	};
}
