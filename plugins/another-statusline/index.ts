import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { fileHyperlink, urlHyperlink } from "@oh-my-pi/pi-coding-agent/tui";

import { buildStatusLine, parseStatuslineConfig, resolveBounds, resolveSegments, type IconHolder, type Segment, type SegmentCtx, type SegmentView, type StatuslineConfig } from "./core";
import { pathSegment } from "./segments/path";
import { gitSegment } from "./segments/git";
import { prSegment } from "./segments/pr";
import { weatherSegment } from "./segments/weather";
import { stockSegment } from "./segments/stock";

/**
 * Another statusline: renders the registered segments as one widget line
 * below the editor. Replaces the built-in `path`, `git` and `pr` status-line
 * segments (remove those from `statusLine.leftSegments`).
 *
 * Layout: segment order and per-segment max/min widths are configurable via
 * `$PI_CODING_AGENT_DIR/another-statusline.yml` (see README); without a
 * config file the built-in defaults apply. The rightmost entry shrinks
 * first when the line is too wide. Two spaces between segments. The line
 * must fit one terminal row: segments shrink rightmost first, down to their
 * min width, then below min (floor 1), until it fits. The budget reserves
 * 2 cells for omp's per-line widget padding (WIDGET_HPAD).
 *
 * Hyperlinks: segments may return an href (file path or URL); index.ts wraps
 * the truncated text with the first-party fileHyperlink/urlHyperlink helpers
 * (wrapped after truncation so width allocation sees plain text only).
 *
 * Not replicated (status-line-only context unavailable to extensions): the
 * worktree label, the activeRepo " relativeRepoRoot" suffix.
 */

const WIDGET_KEY = "another-statusline";
const ERROR_LOG = "/tmp/another-statusline-errors.log";
const SEPARATOR = "  ";
const RESIZE_DEBOUNCE_MS = 300;

// Segment registry. Add a segment: drop segments/<id>.ts exporting a
// `Segment`, import it here, add it to this list. Order = display order;
// the rightmost entry (list tail) is the first to shrink.
const SEGMENTS: Segment[] = [pathSegment, gitSegment, prSegment, weatherSegment, stockSegment];

// User config: segment order + per-segment max/min. Re-read on every refresh
// so saving the file takes effect without a restart; missing file = defaults.
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

	const loadConfig = (): StatuslineConfig | null => {
		let text: string;
		try {
			text = readFileSync(CONFIG_PATH, "utf8");
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "ENOENT") logConfigError(err);
			return null;
		}
		const cfg = parseStatuslineConfig(text);
		if (cfg === null) logConfigError(new Error(`invalid config: ${CONFIG_PATH}`));
		return cfg;
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
			const cfg = loadConfig();
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
