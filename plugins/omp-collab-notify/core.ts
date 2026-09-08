import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const ENV_BOT_TOKEN = "TELEGRAM_BOT_TOKEN";
export const ENV_CHAT_ID = "TELEGRAM_CHAT_ID";
export const ERROR_LOG = join(tmpdir(), "omp-collab-notify-errors.log");
export function configPath(env: Record<string, string | undefined> = process.env): string {
	return join(env.PI_CODING_AGENT_DIR ?? join(homedir(), ".omp", "agent"), "omp-collab-notify.yml");
}
export const CONFIG_PATH = configPath();

export interface TelegramSettings {
	botToken: string | undefined;
	chatId: string | undefined;
}

export interface CollabNotifyConfig {
	telegram: TelegramSettings;
	notify: boolean;
	autoRehost: boolean;
	rehostRetries: number;
	rehostDelayMs: number;
}

export const DEFAULT_CONFIG: CollabNotifyConfig = {
	telegram: { botToken: undefined, chatId: undefined },
	notify: true,
	autoRehost: true,
	rehostRetries: 2,
	rehostDelayMs: 5000,
};

function cleanString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
}

function cleanInt(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fallback;
	return value;
}

export function parseTelegramSettings(raw: unknown, env: Record<string, string | undefined>): TelegramSettings {
	const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	return {
		botToken: cleanString(env[ENV_BOT_TOKEN]) ?? cleanString(obj.botToken),
		chatId: cleanString(env[ENV_CHAT_ID]) ?? cleanString(obj.chatId),
	};
}

export function parseCollabConfig(raw: unknown, env: Record<string, string | undefined>): CollabNotifyConfig {
	if (!raw || typeof raw !== "object") return { ...DEFAULT_CONFIG, telegram: parseTelegramSettings(undefined, env) };
	const root = raw as Record<string, unknown>;
	const collabRaw = (root.collab && typeof root.collab === "object" ? root.collab : {}) as Record<string, unknown>;
	const delaySeconds = cleanInt(collabRaw.rehostDelaySeconds, DEFAULT_CONFIG.rehostDelayMs / 1000);
	const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
	return {
		telegram: parseTelegramSettings(root.telegram, env),
		notify: bool(collabRaw.notify, DEFAULT_CONFIG.notify),
		autoRehost: bool(collabRaw.autoRehost, DEFAULT_CONFIG.autoRehost),
		rehostRetries: cleanInt(collabRaw.rehostRetries, DEFAULT_CONFIG.rehostRetries),
		rehostDelayMs: delaySeconds * 1000,
	};
}

export function loadConfig(env: Record<string, string | undefined> = process.env): CollabNotifyConfig {
	let raw: unknown;
	try {
		const path = configPath(env);
		if (existsSync(path)) raw = Bun.YAML.parse(readFileSync(path, "utf8"));
	} catch {
		return parseCollabConfig(undefined, env);
	}
	return parseCollabConfig(raw, env);
}

export function buildRoomMessage(
	kind: "opened" | "reopened",
	links: { link: string; webLink: string; viewLink?: string; webViewLink?: string; viewOnly: boolean },
	sessionName?: string,
): string {
	const head = sessionName ? `Session: ${sessionName}\n` : "";
	if (kind === "reopened") {
		return `${head}Collab room interrupted by relay — new room ready\nWeb: ${links.webLink}\nTerminal: ${links.link}`;
	}
	if (links.viewOnly) {
		return `${head}Collab room ready (view-only)\nWeb: ${links.webViewLink}\nTerminal: ${links.viewLink}`;
	}
	return `${head}Collab room ready\nWeb: ${links.webLink}\nTerminal: ${links.link}`;
}

export function buildRehostFailedMessage(attempts: number, sessionName?: string): string {
	const head = sessionName ? `Session: ${sessionName}\n` : "";
	return `${head}Collab room was interrupted and auto-restart failed after ${attempts} attempts. Run /collab to share manually.`;
}

interface TelegramResponse {
	ok?: boolean;
	description?: string;
	result?: { message_id?: number };
}

export async function sendTelegramMessage(
	cfg: CollabNotifyConfig,
	text: string,
	fetchImpl: typeof fetch = fetch,
): Promise<"sent" | "no-config" | "error"> {
	const { botToken, chatId } = cfg.telegram;
	if (!botToken || !chatId) return "no-config";
	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
	const body = JSON.stringify({ chat_id: chatId, text });
	const doPost = (): Promise<Response> =>
		fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
			signal: AbortSignal.timeout(10_000),
		});
	// one retry on HTTP >= 500 / 429 / thrown network error
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await doPost();
			const json = (await res.json().catch(() => undefined)) as TelegramResponse | undefined;
			const retryable = res.status >= 500 || res.status === 429;
			if (retryable && attempt === 0) {
				await Bun.sleep(1000);
				continue;
			}
			if (json?.ok) {
				await logLine(`sent chat_id=${chatId} message_id=${json.result?.message_id}: ${text.split("\n")[0]}`);
				return "sent";
			}
			await logLine(`error: telegram sendMessage failed: ${json?.description ?? `HTTP ${res.status}`}`);
			return "error";
		} catch (err) {
			if (attempt === 0) {
				await Bun.sleep(1000);
				continue;
			}
			await logLine(`error: telegram sendMessage threw twice: ${err}`);
			return "error";
		}
	}
	await logLine("error: telegram sendMessage exhausted retries");
	return "error";
}

async function logLine(line: string): Promise<void> {
	try {
		appendFileSync(ERROR_LOG, `[${new Date().toISOString()}] ${line}\n`);
	} catch {
		// logging must never throw
	}
}
