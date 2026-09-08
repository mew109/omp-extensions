import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ERROR_LOG,
	buildRehostFailedMessage,
	buildRoomMessage,
	loadConfig,
	parseCollabConfig,
	parseTelegramSettings,
	sendTelegramMessage,
	DEFAULT_CONFIG,
	type CollabNotifyConfig,
} from "./core";

const env = (vars: Record<string, string | undefined>) => ({
	...process.env,
	TELEGRAM_BOT_TOKEN: undefined,
	TELEGRAM_CHAT_ID: undefined,
	...vars,
});

describe("parseTelegramSettings", () => {
	test("env wins over YAML", () => {
		const s = parseTelegramSettings({ botToken: "yaml", chatId: "yaml" }, env({ TELEGRAM_BOT_TOKEN: "envtok", TELEGRAM_CHAT_ID: "envchat" }));
		expect(s).toEqual({ botToken: "envtok", chatId: "envchat" });
	});

	test("YAML only", () => {
		const s = parseTelegramSettings({ botToken: " yamltok ", chatId: " 42 " }, env({}));
		expect(s).toEqual({ botToken: "yamltok", chatId: "42" });
	});

	test("blank env value counts as unset", () => {
		const s = parseTelegramSettings({ botToken: "yamltok" }, env({ TELEGRAM_BOT_TOKEN: "   ", TELEGRAM_CHAT_ID: "" }));
		expect(s).toEqual({ botToken: "yamltok", chatId: undefined });
	});
});

describe("parseCollabConfig", () => {
	test("defaults with no telegram", () => {
		expect(parseCollabConfig(undefined, env({}))).toEqual({
			telegram: { botToken: undefined, chatId: undefined },
			notify: true,
			autoRehost: true,
			rehostRetries: 2,
			rehostDelayMs: 5000,
		});
	});

	test("rehostDelaySeconds converts to ms", () => {
		expect(parseCollabConfig({ collab: { rehostDelaySeconds: 10 } }, env({})).rehostDelayMs).toBe(10000);
	});

	test("invalid values fall back to defaults, unknown keys ignored", () => {
		const cfg = parseCollabConfig(
			{ collab: { notify: "yes", autoRehost: 1, rehostRetries: -3, rehostRetriesX: 9, junk: true }, other: {} },
			env({}),
		);
		expect(cfg.notify).toBe(true);
		expect(cfg.autoRehost).toBe(true);
		expect(cfg.rehostRetries).toBe(2);
	});


	test("explicit false honored", () => {
		const cfg = parseCollabConfig({ collab: { notify: false, autoRehost: false, rehostRetries: 0 } }, env({}));
		expect(cfg.notify).toBe(false);
		expect(cfg.autoRehost).toBe(false);
		expect(cfg.rehostRetries).toBe(0);
	});
});

describe("loadConfig", () => {
	const origPath = process.env.PI_CODING_AGENT_DIR;
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "collab-notify-test-"));
		process.env.PI_CODING_AGENT_DIR = dir;
	});
	afterEach(() => {
		if (origPath === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = origPath;
		rmSync(dir, { recursive: true, force: true });
	});

	test("missing file -> defaults", () => {
		expect(loadConfig(env({}))).toEqual(DEFAULT_CONFIG);
	});

	test("valid YAML parsed", () => {
		writeFileSync(
			join(dir, "omp-collab-notify.yml"),
			"telegram:\n  botToken: tok\n  chatId: \"7\"\ncollab:\n  notify: false\n  rehostDelaySeconds: 3\n",
		);
		const cfg = loadConfig(env({}));
		expect(cfg.telegram).toEqual({ botToken: "tok", chatId: "7" });
		expect(cfg.notify).toBe(false);
		expect(cfg.rehostDelayMs).toBe(3000);
	});
});

describe("buildRoomMessage", () => {
	const writable = { link: "ws://t", webLink: "https://w", viewOnly: false };
	const viewOnly = { link: "ws://t", webLink: "https://w", viewLink: "ws://v", webViewLink: "https://vw", viewOnly: true };

	test("opened writable includes both links", () => {
		const msg = buildRoomMessage("opened", writable);
		expect(msg).toContain("Collab room ready");
		expect(msg).toContain("https://w");
		expect(msg).toContain("ws://t");
		expect(msg).not.toContain("view-only");
	});

	test("session name prepended when given", () => {
		const msg = buildRoomMessage("opened", writable, "Fix login page");
		expect(msg).toStartWith("Session: Fix login page\n");
		const noName = buildRoomMessage("reopened", writable, "Fix login page");
		expect(noName).toStartWith("Session: Fix login page\n");
		expect(buildRehostFailedMessage(3, "Fix login page")).toContain("Session: Fix login page");
	});

	test("opened view-only uses view links", () => {
		const msg = buildRoomMessage("opened", viewOnly);
		expect(msg).toContain("(view-only)");
		expect(msg).toContain("https://vw");
		expect(msg).toContain("ws://v");
	});
	test("reopened always writable", () => {
		expect(buildRehostFailedMessage(3)).toContain("after 3 attempts");
	});
});

function cfgWith(token: string | undefined, chatId: string | undefined): CollabNotifyConfig {
	return { ...DEFAULT_CONFIG, telegram: { botToken: token, chatId } };
}

function fetchJson(status: number, body: unknown) {
	return Object.assign(async () => new Response(JSON.stringify(body), { status }), {});
}

describe("sendTelegramMessage", () => {
	let logBackup: string | undefined;
	beforeEach(() => {
		logBackup = existsSync(ERROR_LOG) ? readFileSync(ERROR_LOG, "utf8") : undefined;
		rmSync(ERROR_LOG, { force: true });
	});
	afterEach(() => {
		if (logBackup === undefined) rmSync(ERROR_LOG, { force: true });
		else writeFileSync(ERROR_LOG, logBackup);
	});

	const log = () => (existsSync(ERROR_LOG) ? readFileSync(ERROR_LOG, "utf8") : "");

	test("no-config short circuit", async () => {
		expect(await sendTelegramMessage(cfgWith(undefined, "7"), "hi")).toBe("no-config");
		expect(await sendTelegramMessage(cfgWith("tok", undefined), "hi")).toBe("no-config");
		expect(log()).toBe("");
	});

	test("success posts exact URL and body, logs sent line", async () => {
		let calledUrl = "";
		let calledBody = "";
		const impl = Object.assign(async (_url: string, init: RequestInit) => {
			calledUrl = _url as string;
			calledBody = String(init.body);
			return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), { status: 200 });
		}, {});
		const result = await sendTelegramMessage(cfgWith("tok", "77"), "line1\nline2", impl as typeof fetch);
		expect(result).toBe("sent");
		expect(calledUrl).toBe("https://api.telegram.org/bottok/sendMessage");
		expect(JSON.parse(calledBody)).toEqual({ chat_id: "77", text: "line1\nline2" });
		expect(log()).toContain("sent chat_id=77 message_id=99: line1");
	});

	test("one retry after HTTP 500 then success", async () => {
		let calls = 0;
		const impl = async (): Promise<Response> => {
			calls++;
			if (calls === 1) return new Response("boom", { status: 500 });
			return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
		};
		const result = await sendTelegramMessage(cfgWith("tok", "7"), "m", impl as typeof fetch);
		expect(result).toBe("sent");
		expect(calls).toBe(2);
	});

	test("gives up after second failure", async () => {
		let calls = 0;
		const impl = async (): Promise<Response> => {
			calls++;
			return new Response("boom", { status: 500 });
		};
		expect(await sendTelegramMessage(cfgWith("tok", "7"), "m", impl as typeof fetch)).toBe("error");
		expect(calls).toBe(2);
		expect(log()).toContain("error:");
	});

	test("ok:false body -> error", async () => {
		const impl = fetchJson(200, { ok: false, description: "chat not found" }) as typeof fetch;
		expect(await sendTelegramMessage(cfgWith("tok", "7"), "m", impl)).toBe("error");
		expect(log()).toContain("chat not found");
	});
});
