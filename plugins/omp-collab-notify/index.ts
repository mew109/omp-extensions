import type { CollabHost } from "@oh-my-pi/pi-coding-agent/collab/host";
import { BUILTIN_COLLABORATION_SLASH_COMMANDS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-collaboration";
import type {
	ParsedSlashCommand,
	SlashCommandSpec,
	TuiSlashCommandRuntime,
} from "@oh-my-pi/pi-coding-agent/slash-commands/types";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { buildRehostFailedMessage, buildRoomMessage, ERROR_LOG, loadConfig, sendTelegramMessage } from "./core";

function parseSubcommand(args: string): { verb: string; rest: string } {
	const trimmed = args.trim();
	const space = trimmed.indexOf(" ");
	if (space === -1) return { verb: trimmed.toLowerCase(), rest: "" };
	return { verb: trimmed.slice(0, space).toLowerCase(), rest: trimmed.slice(space + 1).trim() };
}

function logError(message: string): void {
	try {
		appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] error: ${message}\n`);
	} catch {
		// logging must never throw
	}
}

const WARN_PREFIX = "omp-collab-notify: ";
const WARN_UNCONFIGURED = `${WARN_PREFIX}Telegram notification skipped — telegram.botToken / telegram.chatId are not set. Configure ~/.omp/agent/omp-collab-notify.yml or TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.`;

const wrappedHandlers = new WeakSet<object>();

interface NotifyState {
	runtime: TuiSlashCommandRuntime | undefined;
	startArgs: string;
	hosting: boolean;
	suppress: boolean;
	rehosting: boolean;
	reopened: boolean;
}

const state: NotifyState = {
	runtime: undefined,
	startArgs: "start",
	hosting: false,
	suppress: false,
	rehosting: false,
	reopened: false,
};

function verbOf(command: ParsedSlashCommand): string {
	return parseSubcommand(command.args).verb;
}

async function deliver(pi: ExtensionAPI, ctx: TuiSlashCommandRuntime["ctx"], text: string): Promise<void> {
	const cfg = loadConfig();
	const result = await sendTelegramMessage(cfg, text);
	if (result === "no-config") {
		ctx.showWarning(WARN_UNCONFIGURED);
		pi.logger.warn(WARN_UNCONFIGURED);
	}
}

async function announceRoom(pi: ExtensionAPI, host: CollabHost, kind: "opened" | "reopened", viewOnly: boolean): Promise<void> {
	const cfg = loadConfig();
	if (!cfg.notify) return;
	const text = buildRoomMessage(
		kind,
		{
			link: host.link,
			webLink: host.webLink,
			viewLink: host.viewLink,
			webViewLink: host.webViewLink,
			viewOnly,
		},
		state.runtime!.ctx.sessionName,
	);
	await deliver(pi, state.runtime!.ctx, text);
}

async function rehost(pi: ExtensionAPI, spec: SlashCommandSpec): Promise<void> {
	const runtime = state.runtime;
	if (!runtime) return;
	state.rehosting = true;
	state.reopened = true;
	try {
		const cfg = loadConfig();
		const attempts = 1 + cfg.rehostRetries;
		for (let attempt = 1; attempt <= attempts; attempt++) {
			if (state.suppress) return;
			await spec.handleTui?.({ name: "collab", args: state.startArgs, text: `/collab ${state.startArgs}` }, runtime);
			if (runtime.ctx.collabHost) {
				pi.logger.info(`omp-collab-notify: rehost succeeded on attempt ${attempt}`);
				return;
			}
			if (attempt < attempts) await Bun.sleep(cfg.rehostDelayMs);
		}
		if (state.suppress) return;
		const message = buildRehostFailedMessage(attempts, runtime.ctx.sessionName);
		if (loadConfig().notify) await deliver(pi, runtime.ctx, message);
		runtime.ctx.showWarning(message);
	} finally {
		state.rehosting = false;
	}
}

export default function ompCollabNotify(pi: ExtensionAPI): void {
	const spec = BUILTIN_COLLABORATION_SLASH_COMMANDS.find(s => s.name === "collab");
	if (!spec?.handleTui) throw new Error("omp-collab-notify: built-in /collab spec not found");
	if (!wrappedHandlers.has(spec)) {
		const original = spec.handleTui.bind(spec);
		const wrapped = async (command: ParsedSlashCommand, runtime: TuiSlashCommandRuntime) => {
			const verb = verbOf(command);
			try {
				await original(command, runtime);
			} finally {
				if (verb === "stop") {
					state.hosting = false;
					return;
				}
				const host = runtime.ctx.collabHost;
				if (host) {
					state.startArgs = command.args.trim() || "start";
					state.runtime = runtime;
					state.hosting = true;
					state.suppress = false;
					const viewOnly = verbOf(command) === "view";
					void announceRoom(pi, host, state.reopened ? "reopened" : "opened", viewOnly).then(() => {
						state.reopened = false;
					});
				}
			}
		};
		spec.handleTui = wrapped;
		wrappedHandlers.add(spec);
	}

	pi.on("session_start", (_event, ctx) => {
		ctx.setInterval(() => {
			if (!state.runtime || !state.hosting || state.suppress || state.rehosting) return;
			if (state.runtime.ctx.collabHost) return;
			state.hosting = false;
			if (loadConfig().autoRehost) {
				void rehost(pi, spec).catch(err => logError(`rehost failed: ${err}`));
			}
		}, 3000);
	});

	pi.on("session_switch", () => {
		state.suppress = true;
		state.hosting = false;
	});
}
