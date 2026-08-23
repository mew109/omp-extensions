import { appendFileSync } from "node:fs";

import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { fileHyperlink, urlHyperlink } from "@oh-my-pi/pi-coding-agent/tui";

import { allocate, displayWidth, truncate, type IconHolder, type Segment, type SegmentCtx, type SegmentView } from "./core";
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
 * Layout: segments appear in SEGMENTS order (edit the list to reorder; the
 * rightmost entry shrinks first when the line is too wide). Two spaces
 * between segments. The line must fit one terminal row: segments shrink
 * rightmost first, down to their min width, then below min (floor 1), until
 * it fits.
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

// Segment registry. Add a segment: drop segments/<id>.ts exporting a
// `Segment`, import it here, add it to this list. Order = display order;
// the rightmost entry (list tail) is the first to shrink.
const SEGMENTS: Segment[] = [pathSegment, gitSegment, prSegment, weatherSegment, stockSegment];

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
			const views = await Promise.all(SEGMENTS.map((s) => Promise.resolve(s.render(sctx))));

			const active: { seg: Segment; text: string; href: SegmentView["href"] }[] = [];
			for (let i = 0; i < SEGMENTS.length; i++) {
				const v = views[i];
				if (v) active.push({ seg: SEGMENTS[i], text: v.text, href: v.href });
			}
			if (active.length === 0) {
				clear(ctx);
				return;
			}
			const budget = (process.stdout.columns ?? 80) - (active.length - 1) * SEPARATOR.length;
			const widths = allocate(
				budget,
				active.map((a) => ({ desired: Math.min(displayWidth(a.text), a.seg.max), min: a.seg.min })),
			);
			const line = active
				.map((a, i) => {
					const t = truncate(a.text, a.seg.keep ?? "head", widths[i]);
					// Wrap after truncation: width allocation must see plain text only.
					if (!a.href) return t;
					return a.href.kind === "file" ? fileHyperlink(a.href.target, t) : urlHyperlink(a.href.target, t);
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
