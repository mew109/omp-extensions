import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Code mode: restrict the model's direct tools to the PTC keep-set
 * (eval, ask, read, write) so multi-tool work is orchestrated from `eval`
 * code that calls tools through the kernel tool bridge.
 *
 * - `--code-mode` CLI flag: start a session in code mode.
 * - `/code-mode [on|off]`: toggle at runtime; no arg shows state.
 * - a `⌨️ Code Mode` widget line renders below the editor while active
 *   (same surface as other extension widgets, so it aligns with them).
 * - while active, a `§ Code Mode` block is appended to the system prompt,
 *   steering the model to orchestrate multi-tool work as eval code.
 */

const KEEP_SET = ["eval", "ask", "read", "write"];
const WIDGET_KEY = "code-mode";

/**
 * System-prompt hint appended while active. Constant text keeps the effective
 * prompt stable across turns within a mode state, so the provider prompt cache
 * stays warm; it only changes when the mode toggles (which already rebuilds the
 * tool-inventory section).
 */
const HINT_BLOCK = [
	"§ Code Mode",
	"You are in code mode. For any task needing 2+ tool calls, write the work as code in eval and call tools from inside the code via tool.<name>(args) (e.g. tool.read({path,i}), tool.grep({pattern,path,i}), tool.write({path,content,i})). Keep intermediate results in the kernel instead of passing them through the model. Use a direct top-level tool only for a single action.",
].join("\n");

/** Structural type: both ExtensionContext and ExtensionCommandContext carry `ui`. */
interface UiHolder {
	ui: {
		setWidget(key: string, lines: string[] | undefined, opts?: { placement?: "aboveEditor" | "belowEditor" }): void;
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
}

export default function codeModeExtension(pi: ExtensionAPI) {
	let active = false;
	let defaultTools: string[] = [];

	const activate = async (ctx: UiHolder) => {
		if (defaultTools.length === 0) {
			defaultTools = pi.getActiveTools();
		}
		active = true;
		await pi.setActiveTools(KEEP_SET);
		ctx.ui.setWidget(WIDGET_KEY, ["⌨️ Code Mode"], { placement: "belowEditor" });
	};

	const deactivate = (ctx: UiHolder) => {
		if (!active) {
			return;
		}
		active = false;
		void pi.setActiveTools(defaultTools.length > 0 ? defaultTools : []);
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	};

	pi.registerFlag("code-mode", {
		description: "start the session in code mode (model tools limited to eval, ask, read, write)",
		type: "boolean",
		default: false,
	});

	pi.on("session_start", async (_event, ctx) => {
		defaultTools = pi.getActiveTools();
		if (pi.getFlag("code-mode") === true) {
			await activate(ctx);
		}
	});

	// Defensive: keep the keep-set applied if something resets the active set mid-session.
	pi.on("turn_start", async () => {
		if (active) {
			await pi.setActiveTools(KEEP_SET);
		}
	});

	// Append the Code Mode hint to the system prompt while active. Returning the
	// base blocks plus one constant block keeps the effective prompt stable
	// across turns (cache-friendly); it changes only when the mode toggles.
	pi.on("before_agent_start", (event) => {
		if (!active) {
			return;
		}
		return { systemPrompt: [...event.systemPrompt, HINT_BLOCK] };
	});

	pi.registerCommand("code-mode", {
		description: "toggle code mode (eval/ask/read/write only); usage: /code-mode [on|off]",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				await activate(ctx);
				ctx.ui.notify("code mode on: direct tools = eval, ask, read, write", "info");
			} else if (arg === "off") {
				deactivate(ctx);
				ctx.ui.notify("code mode off: default tools restored", "info");
			} else if (arg.length > 0) {
				ctx.ui.notify(`unknown argument: ${arg} (use on|off)`, "warning");
			} else {
				ctx.ui.notify(active ? "code mode: on — /code-mode off to exit" : "code mode: off — /code-mode on to enter", "info");
			}
		},
	});
}
