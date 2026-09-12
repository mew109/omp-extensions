import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ToolCallEvent, BeforeAgentStartEvent } from "@oh-my-pi/pi-coding-agent";
import {
	createRedactor,
	type ContentBlock,
	formatMap,
	maskMessages,
	PII_NOTICE,
	piiSettings,
	PATTERNS,
	unmaskContent,
	unmaskInPlace,
} from "./core";
/**
 * omp-pii-mask: regex PII masking before traffic leaves the harness to the
 * LLM provider, with transparent restore in tool args and assistant replies.
 *
 * - `context`: mask user/toolResult content (and assistant thinking) on the
 *   way out; the provider never sees raw PII.
 * - `tool_call`: restore placeholders in tool args so tools run on real values.
 * - `before_agent_start`: append a system-prompt notice (marker-guarded, so
 *   it is added once).
 * - `message_end`: restore placeholders in assistant text/thinking the user sees.
 * - `/pii-map`: show the current placeholder → original mapping.
 *
 * Settings: `$PI_CODING_AGENT_DIR/pii-mask.yml` key `phone` (default false)
 * or env `PII_MASK_PHONE`; env > YAML. Read once per process — restart to
 * apply. The PHONE pattern is opt-in because it matches every 10-digit run
 * (timestamps, order numbers).
 */

const CONFIG_PATH = join(
	process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"),
	"pii-mask.yml",
);

function loadRawConfig(): Record<string, unknown> | null {
	let text: string;
	try {
		text = readFileSync(CONFIG_PATH, "utf8");
	} catch {
		return null;
	}
	if (typeof Bun === "undefined" || typeof Bun.YAML?.parse !== "function") return null;
	try {
		const raw: unknown = Bun.YAML.parse(text);
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
		return raw as Record<string, unknown>;
	} catch {
		return null;
	}
}

/** TUI: notify path. Headless: stdout. */
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

const settings = piiSettings(loadRawConfig(), process.env);
const patterns = settings.phone ? PATTERNS : PATTERNS.filter((p) => p.name !== "PHONE");
const redactor = createRedactor(patterns);

export default function piiMaskExtension(pi: ExtensionAPI): void {
	pi.on("context", (event) => {
		return { messages: maskMessages(event.messages, redactor) };
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent) => {
		const marker = "<!-- pi-pii-mask -->";
		if (event.systemPrompt.some((block) => block.includes(marker))) return undefined;
		return { systemPrompt: [...event.systemPrompt, `${marker}${PII_NOTICE}`] };
	});

	pi.on("message_end", (event) => {
		// Notification-only on omp: mutate the snapshot's text/thinking blocks
		// so the TUI renders restored values; provider context is untouched.
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const content = msg.content as ContentBlock[];
		for (let i = 0; i < content.length; i++) {
			const block = content[i];
			if (block.type === "text" && typeof block.text === "string") {
				content[i] = { ...block, text: redactor.unmask(block.text) };
			} else if (block.type === "thinking" && typeof block.thinking === "string") {
				content[i] = { ...block, thinking: redactor.unmask(block.thinking) };
			}
		}
	});

	pi.registerCommand("pii-map", {
		description: "Show current PII placeholder → original mapping",
		handler: async (_args, ctx) => {
			report(ctx as Pick<ExtensionCommandContext, "hasUI" | "ui">, formatMap(redactor.entries()), "info");
		},
	});
}
