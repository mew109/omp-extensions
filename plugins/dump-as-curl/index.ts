import { chmodSync, existsSync, statSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import {
	extractModel,
	isLlmEndpoint,
	makeCapture,
	parseArgs,
	pickCapture,
	pushCapture,
	renderCurlScript,
	resolveOutPath,
	usageText,
	type Capture,
} from "./core";

/**
 * dump-as-curl: capture LLM requests at the `globalThis.fetch` seam and
 * re-emit one as an executable curl script.
 *
 * - `/dump-as-curl [--index N] [--filename FILE] [--help]`: write the
 *   newest (or Nth-newest) captured request — URL, headers, verbatim body —
 *   as a `sh` script that replays it with curl. Output path is shown via
 *   the same status surface `/dump` uses (stdout headless).
 * - Capture wraps `globalThis.fetch` once per process (guarded via
 *   `Symbol.for("omp.dump-as-curl")`), so every provider is covered and
 *   subagent calls in the same process land in the same ring.
 */

interface DumpAsCurlState {
	installed: boolean;
	ring: Capture[];
}

const STATE_KEY = Symbol.for("omp.dump-as-curl");

function state(): DumpAsCurlState {
	const g = globalThis as unknown as Record<symbol, DumpAsCurlState | undefined>;
	if (!g[STATE_KEY]) {
		g[STATE_KEY] = { installed: false, ring: [] };
	}
	return g[STATE_KEY];
}

/** Idempotently wrap globalThis.fetch; POSTs to LLM endpoints land in the ring. */
function installCapture(): void {
	const s = state();
	if (s.installed) {
		return;
	}
	s.installed = true;
	const orig = globalThis.fetch;
	const wrapper: typeof fetch = (input, init) => {
		try {
			const req = typeof input === "object" && input !== null ? (input as Request) : undefined;
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : (req?.url ?? "");
			const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
			if (method === "POST" && isLlmEndpoint(url)) {
				const cap = makeCapture(url, method, init?.headers ?? req?.headers, init?.body);
				if (cap) {
					pushCapture(s.ring, cap);
				}
			}
		} catch {
			// never break the request
		}
		return orig(input, init);
	};
	wrapper.preconnect = orig.preconnect;
	globalThis.fetch = wrapper;
}

/** TUI: same notify path /dump uses (info → status, warning/error → warnings). Headless: stdout. */
function report(
	ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
	msg: string,
	level: "info" | "warning" | "error",
): void {
	if (ctx.hasUI) {
		ctx.ui.notify(msg, level);
	} else {
		process.stdout.write(msg + "\n");
	}
}

const NO_CAPTURE = "dump-as-curl: no LLM request captured yet — send a message first, then run /dump-as-curl";

export default function dumpAsCurlExtension(pi: ExtensionAPI) {
	installCapture();
	pi.registerCommand("dump-as-curl", {
		description: "Write the last captured LLM request as an executable curl script",
		handler: async (args, ctx) => {
			const parsed = parseArgs(args);
			if (parsed.help) {
				report(ctx, usageText(), "info");
				return;
			}
			if (parsed.error) {
				report(ctx, `dump-as-curl: ${parsed.error}\n\n${usageText()}`, "warning");
				return;
			}
			const { ring } = state();
			if (ring.length === 0) {
				report(ctx, NO_CAPTURE, "warning");
				return;
			}
			if (parsed.index > ring.length) {
				report(ctx, `dump-as-curl: --index out of range (1..${ring.length} available)`, "warning");
				return;
			}
			const c = pickCapture(ring, parsed.index);
			if (!c) {
				report(ctx, `dump-as-curl: --index out of range (1..${ring.length} available)`, "warning");
				return;
			}
			const out = resolveOutPath(parsed.filename, ctx.cwd);
			try {
				if (existsSync(out) && statSync(out).isDirectory()) {
					report(ctx, `dump-as-curl: --filename points at a directory: ${out}`, "warning");
					return;
				}
				await Bun.write(out, renderCurlScript(c, parsed.index, ring.length));
				chmodSync(out, 0o700);
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				report(ctx, `dump-as-curl: failed to write ${out}: ${message}`, "error");
				return;
			}
			report(
				ctx,
				[
					`dump-as-curl: capture ${parsed.index}/${ring.length}, model ${extractModel(c)}, ${Buffer.byteLength(c.body)} bytes`,
					`LLM request curl: ${out}`,
					"This file persists on disk and may contain API keys — treat accordingly.",
				].join("\n"),
				"info",
			);
		},
	});
}
