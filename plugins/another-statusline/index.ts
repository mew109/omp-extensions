import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { fileHyperlink, urlHyperlink } from "@oh-my-pi/pi-coding-agent/tui";

import { buildStatusLine } from "./core";
import { pathSegment } from "./segments/path";
import { gitSegment } from "./segments/git";
import { prSegment } from "./segments/pr";
import { applyWeatherSettings, weatherSegment, weatherSettings } from "./segments/weather";
import { applyStockSettings, stockSegment, stockSettings } from "./segments/stock";

/**
 * Another statusline: renders the registered segments as one widget line
 * below the editor. Replaces the built-in `path`, `git` and `pr` status-line
 * segments (remove those from `statusLine.leftSegments`).
 *
 * Layout: segment order and per-segment max/min widths are configurable via
 * `$PI_CODING_AGENT_DIR/another-statusline.yml` (see README); without a
 * config file the built-in defaults apply. Weather (location, label
 * language) and stock (symbol, name) settings follow the same precedence
 * (env vars > YAML > built-in defaults; see README). The rightmost entry
 * shrinks first when the line is too wide. Two spaces between segments. The
 * line must fit one terminal row: segments shrink rightmost first, down to
 * their min width, then below min (floor 1), until it fits. The budget
 * reserves 2 cells for omp's per-line widget padding (WIDGET_HPAD).
 *
 * Division of labor: index.ts owns the Segment contract, the loader config
 * and the assembly; core.ts keeps the segment-agnostic machinery (width
 * math, command runner, poller); each segment module owns its settings
 * slice (parse + env precedence + apply).
 *
 * Hyperlinks: segments may return an href (file path or URL); index.ts wraps
 * the truncated text with the first-party fileHyperlink/urlHyperlink helpers
 * (wrapped after truncation so width allocation sees plain text only).
 *
 * Not replicated (status-line-only context unavailable to extensions): the
 * worktree label, the activeRepo " relativeRepoRoot" suffix.
 */

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

interface LoaderConfig {
	segments?: string[];
	segmentOptions?: Record<string, SegmentOption>;
}

/** Lenient field-level parse of the raw config object; invalid fields are dropped, never fatal. */
export function parseLoaderConfig(raw: Record<string, unknown>): LoaderConfig {
	const cfg: LoaderConfig = {};
	if (Array.isArray(raw.segments) && raw.segments.every((s) => typeof s === "string")) {
		cfg.segments = raw.segments as string[];
	}
	if (typeof raw.segmentOptions === "object" && raw.segmentOptions !== null) {
		const opts: Record<string, SegmentOption> = {};
		for (const [id, val] of Object.entries(raw.segmentOptions as Record<string, unknown>)) {
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
export function resolveSegments(all: Segment[], cfg: LoaderConfig | null): Segment[] {
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

const WIDGET_KEY = "another-statusline";
const ERROR_LOG = "/tmp/another-statusline-errors.log";
const SEPARATOR = "  ";
const RESIZE_DEBOUNCE_MS = 300;

// Segment registry. Add a segment: drop segments/<id>.ts exporting a
// `Segment`, import it here, add it to this list. Order = display order;
// the rightmost entry (list tail) is the first to shrink.
const SEGMENTS: Segment[] = [pathSegment, gitSegment, prSegment, weatherSegment, stockSegment];

// User config: segment order, per-segment max/min, and segment settings
// slices (weather, stock). Re-read on every refresh so saving the file
// takes effect without a restart; missing file = defaults.
const CONFIG_PATH = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"),
	"another-statusline.yml",
);

export default function anotherStatusline(pi: ExtensionAPI): void {
	const fail = (ctx: ExtensionContext, err: unknown): void => {
		try {
			if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// clearing the widget must never throw
		}
		const short = err instanceof Error ? err.message : String(err);
		const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
		try {
			appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${detail}\n`);
			try {
				ctx.ui.notify(`another-statusline: ${short} (details: ${ERROR_LOG})`, "error");
			} catch {
				// notify must never throw
			}
		} catch {
			try {
				ctx.ui.notify(`another-statusline: ${short}`, "error");
			} catch {
				// notify must never throw
			}
		}
	};

	const clear = (ctx: ExtensionContext): void => {
		try {
			if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
		} catch {
			// shutdown cleanup must not throw
		}
	};

	// Guards against overlapping async refreshes (turn_end can fire while a
	// git/gh lookup is still in flight). A call during a refresh queues one
	// trailing rerun so background data landing mid-render is never dropped.
	let refreshing = false;
	let rerenderQueued = false;
	let lastCtx: ExtensionContext | undefined;

	let configWarned = false;
	const logConfigError = (err: unknown, notify = true): void => {
		const detail = err instanceof Error ? err.stack ?? err.message : String(err);
		try {
			appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] config: ${detail}\n`);
		} catch {
			// logging must never throw
		}
		if (notify && !configWarned) {
			configWarned = true;
			const c = lastCtx;
			if (c?.hasUI) {
				try {
					c.ui.notify(`another-statusline: config error (details: ${ERROR_LOG})`, "error");
				} catch {
					// notify must never throw
				}
			}
		}
	};

	const loadConfig = (): Record<string, unknown> | null => {
		let text: string;
		try {
			text = readFileSync(CONFIG_PATH, "utf8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") logConfigError(err);
			return null;
		}
		if (typeof Bun === "undefined" || typeof Bun.YAML?.parse !== "function") return null;
		let raw: unknown;
		try {
			raw = Bun.YAML.parse(text);
		} catch {
			raw = null;
		}
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			logConfigError(new Error(`invalid config: ${CONFIG_PATH}`));
			return null;
		}
		return raw as Record<string, unknown>;
	};

	// Re-renders the widget with the last context; no-op after shutdown.
	const rerender = (): void => {
		const c = lastCtx;
		if (c) void refresh(c).catch((err) => fail(c, err));
	};

	const refresh = async (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI) return;
		if (refreshing) {
			rerenderQueued = true;
			return;
		}
		refreshing = true;
		try {
			const sctx: SegmentCtx = { cwd: ctx.cwd, theme: ctx.ui.theme as unknown as IconHolder, rerender };
			const raw = loadConfig();
			const cfg = parseLoaderConfig(raw ?? {});
			applyWeatherSettings(weatherSettings(raw?.weather, process.env));
			applyStockSettings(stockSettings(raw?.stock, process.env));
			const ordered = resolveSegments(SEGMENTS, cfg);
			for (const id of cfg?.segments ?? []) {
				if (!ordered.some((s) => s.id === id)) logConfigError(new Error(`unknown segment id: ${id}`), false);
			}
			const views = await Promise.all(ordered.map((s) => Promise.resolve(s.render(sctx))));

			const active: { seg: Segment; text: string; href: SegmentView["href"] }[] = [];
			for (let i = 0; i < ordered.length; i++) {
				const v = views[i];
				if (v) active.push({ seg: ordered[i], text: v.text, href: v.href });
			}
			if (active.length === 0) {
				clear(ctx);
				return;
			}
			const termWidth = process.stdout.columns || Number(process.env.COLUMNS) || 80; // mirrors pi-tui terminal.columns
			const parts = buildStatusLine(
				active.map((a) => {
					const b = resolveBounds(a.seg, cfg?.segmentOptions?.[a.seg.id]);
					return { text: a.text, keep: a.seg.keep ?? "head", max: b.max, min: b.min };
				}),
				termWidth,
				SEPARATOR,
			);
			const line = parts
				.map((t, i) => {
					// Wrap after truncation: width allocation must see plain text only.
					const href = active[i].href;
					if (!href) return t;
					return href.kind === "file" ? fileHyperlink(href.target, t) : urlHyperlink(href.target, t);
				})
				.join(SEPARATOR);
			ctx.ui.setWidget(WIDGET_KEY, [line], { placement: "belowEditor" });
		} catch (err) {
			fail(ctx, err);
		} finally {
			refreshing = false;
			if (rerenderQueued) {
				rerenderQueued = false;
				void refresh(ctx).catch((err) => fail(ctx, err));
			}
		}
	};

	const onRefresh = (_event: unknown, ctx: ExtensionContext): void => {
		lastCtx = ctx;
		void refresh(ctx).catch((err) => fail(ctx, err));
	};

	// Background segments (weather, stock) start their unref'd timers; their
	// rerender re-renders the widget when fresh data lands.
	for (const s of SEGMENTS) s.start?.(rerender);

	// omp repaints widget lines at the new width but never re-runs this
	// extension, so the line would stay sized for the old width until the
	// next event. SIGWINCH arrives in bursts while dragging; one trailing
	// rerender after the burst settles is enough (refresh() re-reads
	// stdout.columns, which is updated before the event fires).
	let resizeTimer: NodeJS.Timeout | undefined;
	process.stdout.on("resize", () => {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(rerender, RESIZE_DEBOUNCE_MS);
		resizeTimer.unref();
	});

	// cwd and repo state change inside OMP (startup, session switch, a turn
	// running shell commands), so event refreshes suffice; timed segments
	// bring their own timers.
	pi.on("session_start", onRefresh);
	pi.on("session_switch", onRefresh);
	pi.on("turn_end", onRefresh);
	pi.on("session_shutdown", (_event, ctx) => {
		clear(ctx);
		lastCtx = undefined;
	});
}
