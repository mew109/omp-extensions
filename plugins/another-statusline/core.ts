import { appendFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Segment-agnostic shared machinery for the statusline widget: width math,
 * the width allocator, a command runner and a fetch poller. Segment modules
 * (segments/*.ts) import from here; index.ts owns the Segment contract and
 * assembles them.
 */

export const ERROR_LOG = join(tmpdir(), "another-statusline-errors.log");

// -------------------------------------------------------------- width logic

// Measure per grapheme cluster, not code point: an emoji base alone is 1
// cell but emoji+VS16 as one cluster is 2 (🌦 = 1, 🌦️ = 2), so per-code-point
// summing undercounts. Bun.stringWidth is the same engine the host renderer
// wraps with; pi-tui expands a tab to 3 cells.
const STRING_WIDTH_OPTS = { countAnsiEscapeCodes: false, ambiguousIsNarrow: true } as const;
const TAB_CELLS = 3;
const CLUSTERS = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Visible cell width of one grapheme cluster (same engine the widget renderer wraps with). */
function cellWidth(cluster: string): number {
	return cluster === "\t" ? TAB_CELLS : Bun.stringWidth(cluster, STRING_WIDTH_OPTS);
}

/** Visible cell width of `text`, summed per grapheme cluster. */
export function displayWidth(text: string): number {
	let w = 0;
	for (const s of CLUSTERS.segment(text)) w += cellWidth(s.segment);
	return w;
}

/** Truncate to `width` cells keeping the rightmost part (path policy). */
export function truncateRight(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	const cs = [...CLUSTERS.segment(text)].map((s) => s.segment);
	let tail = "";
	let used = 0;
	for (let i = cs.length - 1; i >= 0 && used < width - 1; i--) {
		const cw = cellWidth(cs[i]);
		if (used + cw > width - 1) break;
		tail = cs[i] + tail;
		used += cw;
	}
	return `…${tail}`;
}

/** Truncate to `width` cells keeping the leftmost part (git/pr policy). */
export function truncateLeft(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	const cs = [...CLUSTERS.segment(text)].map((s) => s.segment);
	let head = "";
	let used = 0;
	for (const c of cs) {
		const cw = cellWidth(c);
		if (used + cw > width - 1) break;
		head += c;
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

/** Padding budget for the setWidget surface only: omp renders each widget
 * line as Text(line, 1, 0) (1 cell per side); tui.tight removes it. The
 * status surface renders full width, so callers there pass hpad = 0. */
export const WIDGET_HPAD = 2;

export interface LineSeg {
	text: string;
	keep: "head" | "tail";
	max: number;
	min: number;
}

/** Truncate segments to fit one statusline row inside `termWidth` cells
 * (separators included): budget = termWidth - hpad - separators, shrink
 * rightmost first via allocate. Returns the truncated per-segment texts. */
export function buildStatusLine(segs: LineSeg[], termWidth: number, separator = "  ", hpad: number = WIDGET_HPAD): string[] {
	const budget = termWidth - hpad - (segs.length - 1) * separator.length;
	const widths = allocate(budget, segs.map((s) => ({ desired: Math.min(displayWidth(s.text), s.max), min: s.min })));
	return segs.map((s, i) => truncate(s.text, s.keep, widths[i]));
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
	/** Error-log label; a function is evaluated at write time so configurable names stay current. */
	label: string | (() => string);
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
	/** Drop the cached value; the next render refetches (settings changed). */
	invalidate(): void;
}

/**
 * Cache + cadence for a background-fetch segment. Fetch failures keep the
 * stale cache and only append to ERROR_LOG — they must never surface as a
 * widget-killing notify.
 */
export function createPoller<T extends { fetchedAt: number }>(spec: PollerSpec<T>): Poller<T> {
	let cache: T | null = null;
	let rerender: (() => void) | null = null;
	let attemptAt = 0;
	let inFlight: Promise<void> | null = null;

	const log = (err: unknown): void => {
		const label = typeof spec.label === "function" ? spec.label() : spec.label;
		try {
			appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${label}: ${err instanceof Error ? err.message : String(err)}\n`);
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
		invalidate: () => {
			cache = null;
		},
	};
}
