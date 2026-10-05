/**
 * keepalive.ts — keep an omp collab room alive on demand.
 *
 * `start` spawns a detached daemon that joins the room as a read-only
 * guest (writeToken never sent) and pings the relay every interval ±
 * jitter, so the relay / Cloudflare idle timeout never closes the room.
 *
 * Protocol constants ported from omp 18.4.9: proto 3, AES-GCM with a
 * 12-byte random IV, 4-byte big-endian peerId envelope, ?role=guest.
 * If joins fail with "protocol mismatch", re-extract from the current
 * omp binary (see CONTRIBUTING.md, Known traps).
 *
 * Standalone: bun keepalive.ts start '<room link>'
 * In-session: /collab-keepalive start|stop|status <link|id|all>
 */
import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ------------------------------------------------------------- protocol lib

export const PROTO = 3;
export const DEFAULT_RELAY = "wss://my.omp.sh";
export const KEY_BYTES = 32;
export const WRITE_TOKEN_BYTES = 16;
export const IV_BYTES = 12;
export const PEER_HEADER_BYTES = 4;

const BARE_RE = /^([A-Za-z0-9_-]{10,64})[#.]([A-Za-z0-9_-]+)$/;
const PATH_RE = /^\/r\/([A-Za-z0-9_-]{10,64})(?:\.([A-Za-z0-9_-]+))?$/;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const ROOM_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
const LOCALHOST: Record<string, true> = {
	localhost: true,
	"127.0.0.1": true,
	"::1": true,
	"[::1]": true,
};

export interface RoomLink {
	wsUrl: string;
	roomId: string;
	key: Uint8Array;
	writeToken?: Uint8Array;
}
export type ParseLinkResult = RoomLink | { error: string };

/** Narrow unknown parsed-JSON input to a string-keyed record, or null. */
function recordOf(v: unknown): Record<string, unknown> | null {
	return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function pickString(v: unknown): string | undefined {
	return typeof v === "string" && v !== "" ? v : undefined;
}

/** Normalize a relay origin; plain ws is only allowed for localhost. */
function relayOrigin(origin: string): { origin: string } | { error: string } {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return { error: `Invalid relay URL: ${origin}` };
	}
	let scheme: string;
	switch (url.protocol) {
		case "wss:":
		case "https:":
			scheme = "wss:";
			break;
		case "ws:":
		case "http:":
			scheme = "ws:";
			break;
		default:
			return { error: `Unsupported relay URL scheme: ${url.protocol}` };
	}
	if (scheme === "ws:" && LOCALHOST[url.hostname] !== true) {
		return { error: "relay link must be wss:// (plain ws:// is only allowed for localhost)" };
	}
	const port = url.port ? `:${url.port}` : "";
	return { origin: `${scheme}//${url.hostname}${port}` };
}

/** Port of omp's collab link parser (dist `RK`), same shapes and errors. */
export function parseLink(raw: string): ParseLinkResult {
	const trimmed = raw.trim().replace(/%23/gi, "#");
	const bare = BARE_RE.exec(trimmed);
	let urlStr = bare ? `${DEFAULT_RELAY}/r/${bare[1]}.${bare[2]}` : trimmed;
	if (!urlStr.includes("://")) urlStr = `wss://${urlStr}`;
	let url: URL;
	try {
		url = new URL(urlStr);
	} catch {
		return { error: `Invalid collab link: ${raw}` };
	}
	if ((url.protocol === "http:" || url.protocol === "https:") && url.hash) {
		const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
		const viaHash = parseLink(hash);
		if (!("error" in viaHash)) return viaHash;
	}
	const origin = relayOrigin(url.origin);
	if ("error" in origin) return origin;
	const path = PATH_RE.exec(url.pathname);
	if (!path) {
		const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
		if (hash && url.protocol !== "http:" && url.protocol !== "https:") return parseLink(hash);
		return { error: "Collab link must contain a /r/<roomId> path" };
	}
	const roomId = path[1];
	const keyStr = path[2] ?? (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
	if (!keyStr) return { error: "Collab link is missing the <key> part" };
	const bytes = B64URL_RE.test(keyStr) ? new Uint8Array(Buffer.from(keyStr, "base64url")) : null;
	if (!bytes || (bytes.byteLength !== KEY_BYTES && bytes.byteLength !== KEY_BYTES + WRITE_TOKEN_BYTES)) {
		return { error: "Collab link key must be 32 (view) or 48 (full) base64url bytes" };
	}
	const key = bytes.subarray(0, KEY_BYTES);
	const writeToken = bytes.byteLength > KEY_BYTES ? bytes.subarray(KEY_BYTES) : undefined;
	return { wsUrl: `${origin.origin}/r/${roomId}`, roomId, key, writeToken };
}

export function guestUrl(wsUrl: string): string {
	return `${wsUrl}?role=guest`;
}

/** 4-byte big-endian peerId + sealed payload, as one binary WS message. */
export function encodeEnvelope(peerId: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(PEER_HEADER_BYTES + payload.byteLength);
	new DataView(out.buffer).setUint32(0, peerId, false);
	out.set(payload, PEER_HEADER_BYTES);
	return out;
}

export function parseEnvelope(buf: ArrayBuffer | Uint8Array): { peerId: number; payload: Uint8Array } | null {
	const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	if (b.byteLength < PEER_HEADER_BYTES) return null;
	const peerId = new DataView(b.buffer, b.byteOffset, PEER_HEADER_BYTES).getUint32(0, false);
	return { peerId, payload: b.subarray(PEER_HEADER_BYTES) };
}

export async function importRoomKey(key: Uint8Array): Promise<CryptoKey> {
	if (key.byteLength !== KEY_BYTES) {
		throw new Error(`Room key must be ${KEY_BYTES} bytes, got ${key.byteLength}`);
	}
	return crypto.subtle.importKey("raw", key.slice(), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** AES-GCM seal: 12-byte random IV prepended to ciphertext+tag. */
export async function seal(key: CryptoKey, msg: unknown): Promise<Uint8Array> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const plain = new TextEncoder().encode(JSON.stringify(msg));
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
	const out = new Uint8Array(IV_BYTES + ct.byteLength);
	out.set(iv, 0);
	out.set(ct, IV_BYTES);
	return out;
}

export async function openFrame(key: CryptoKey, sealed: Uint8Array): Promise<unknown> {
	if (sealed.byteLength <= IV_BYTES) throw new Error("Sealed frame too short");
	const iv = sealed.slice(0, IV_BYTES);
	const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed.slice(IV_BYTES));
	return JSON.parse(new TextDecoder().decode(plain));
}

// -------------------------------------------------------------------- CLI

const USAGE = `usage:
  keepalive.ts start <link> [--interval ms] [--jitter ms] [--name s]
  keepalive.ts stop <link|roomId|all>
  keepalive.ts status [link|roomId]
  keepalive.ts help

<link> accepts the web link (https://my.omp.sh/#<id>.<key>), my.omp.sh/#<id>.<key>,
a bare <id>.<key>, or a ws(s):// relay URL; stop/status also take a bare <roomId>.
Pid/log files: ${tmpdir()}/omp-collab-keepalive-<roomId>.{pid,log}`;

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_JITTER_MS = 10_000;
const DEFAULT_NAME = "keepalive";
const PID_PREFIX = "omp-collab-keepalive-";

const ENV = {
	link: "OMP_COLLAB_KEEPALIVE_LINK",
	interval: "OMP_COLLAB_KEEPALIVE_INTERVAL",
	jitter: "OMP_COLLAB_KEEPALIVE_JITTER",
	name: "OMP_COLLAB_KEEPALIVE_NAME",
	log: "OMP_COLLAB_KEEPALIVE_LOG",
	bun: "OMP_COLLAB_KEEPALIVE_BUN",
} as const;

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

function pidPath(roomId: string): string {
	return join(tmpdir(), `${PID_PREFIX}${roomId}.pid`);
}

function logPath(roomId: string): string {
	return join(tmpdir(), `${PID_PREFIX}${roomId}.log`);
}

function readPid(file: string): number | null {
	try {
		const n = Number(readFileSync(file, "utf8").trim());
		return Number.isInteger(n) && n > 0 ? n : null;
	} catch {
		return null;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err instanceof Error && "code" in err && err.code === "EPERM";
	}
}

function unlinkQuiet(file: string): void {
	try {
		unlinkSync(file);
	} catch {
		// best effort
	}
}

function logTail(text: string, lines: number): string {
	const all = text.split("\n").filter((l) => l !== "");
	return all.slice(-lines).join("\n") || "(empty log)";
}

function lastSeenLine(roomId: string): string | null {
	const file = logPath(roomId);
	if (!existsSync(file)) return null;
	const hits = readFileSync(file, "utf8")
		.split("\n")
		.filter((l) => /\bjoined room\b/.test(l) || /\bping$/.test(l));
	const last = hits.at(-1);
	return last === undefined ? null : last;
}

function knownRoomIds(): string[] {
	return readdirSync(tmpdir())
		.filter((n) => n.startsWith(PID_PREFIX) && n.endsWith(".pid"))
		.map((n) => n.slice(PID_PREFIX.length, -".pid".length));
}

function roomIdsFromArg(arg: string): string[] | { error: string } {
	const a = arg.trim();
	if (a === "" || a === "all") return knownRoomIds();
	const parsed = parseLink(a);
	if (!("error" in parsed)) return [parsed.roomId];
	if (ROOM_ID_RE.test(a)) return [a];
	return { error: `cannot resolve a room id from "${a}": ${parsed.error}` };
}

interface StartOpts {
	link: string;
	interval: number;
	jitter: number;
	name: string;
}

function parseStartOpts(tokens: string[]): StartOpts | { error: string } {
	let link = "";
	let interval = DEFAULT_INTERVAL_MS;
	let jitter = DEFAULT_JITTER_MS;
	let name = DEFAULT_NAME;
	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens.at(i);
		if (tok === undefined) continue;
		if (tok === "--interval" || tok === "--jitter" || tok === "--name") {
			const raw = tokens.at(i + 1);
			if (raw === undefined) return { error: `${tok} requires a value` };
			if (tok === "--name") {
				name = raw;
				continue;
			}
			const n = Number(raw);
			if (!Number.isFinite(n) || n < 0) return { error: `${tok} requires a non-negative number of ms` };
			if (tok === "--interval") interval = Math.max(1_000, Math.round(n));
			else jitter = Math.round(n);
			continue;
		}
		link = link === "" ? tok : `${link} ${tok}`;
	}
	if (link === "") return { error: "missing <link>" };
	return { link, interval, jitter, name };
}

/** Poll the daemon log until it joins, exits, or 10 s pass. */
async function awaitJoin(pid: number, exited: Promise<number>, roomId: string, logFile: string): Promise<number> {
	let exitCode: number | null = null;
	void exited.then((code) => {
		exitCode = code;
	});
	const pidFile = pidPath(roomId);
	const deadline = Date.now() + 10_000;
	for (;;) {
		const text = existsSync(logFile) ? readFileSync(logFile, "utf8") : "";
		if (text.includes("joined room")) {
			console.log(`keepalive joined room ${roomId} (pid ${pid}, log ${logFile})`);
			return 0;
		}
		if (exitCode !== null) {
			unlinkQuiet(pidFile);
			console.error(`start: daemon exited with code ${exitCode}`);
			console.error(logTail(text, 15));
			return 1;
		}
		if (Date.now() >= deadline) {
			console.error(`start: no join confirmation within 10 s (pid ${pid}, still connecting — check ${logFile})`);
			return 1;
		}
		await sleep(200);
	}
}

async function cmdStart(tokens: string[]): Promise<number> {
	if (tokens.includes("--help") || tokens.includes("-h")) {
		console.log(USAGE);
		return 0;
	}
	const opts = parseStartOpts(tokens);
	if ("error" in opts) {
		console.error(`start: ${opts.error}`);
		console.error(USAGE);
		return 1;
	}
	const parsed = parseLink(opts.link);
	if ("error" in parsed) {
		console.error(parsed.error);
		return 1;
	}
	const roomId = parsed.roomId;
	const pidFile = pidPath(roomId);
	const running = readPid(pidFile);
	if (running !== null && pidAlive(running)) {
		console.log(`already running (pid ${running})`);
		return 0;
	}
	const logFile = logPath(roomId);
	let child;
	try {
		// the link travels via env, never argv — argv is world-readable
		child = Bun.spawn([process.env[ENV.bun] ?? "bun", import.meta.path, "run"], {
			env: {
				...process.env,
				[ENV.link]: opts.link,
				[ENV.interval]: String(opts.interval),
				[ENV.jitter]: String(opts.jitter),
				[ENV.name]: opts.name,
				[ENV.log]: logFile,
			},
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
	} catch (err) {
		console.error(`start: cannot spawn daemon (${err instanceof Error ? err.message : String(err)})`);
		console.error(`set ${ENV.bun} to the bun binary path`);
		return 1;
	}
	child.unref();
	try {
		writeFileSync(pidFile, `${child.pid}\n`, { mode: 0o600 });
	} catch (err) {
		try {
			process.kill(child.pid, "SIGTERM");
		} catch {
			// already gone
		}
		console.error(`start: cannot write ${pidFile}: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	return awaitJoin(child.pid, child.exited, roomId, logFile);
}

async function cmdStop(arg: string): Promise<number> {
	const ids = roomIdsFromArg(arg);
	if ("error" in ids) {
		console.error(ids.error);
		return 1;
	}
	if (ids.length === 0) {
		console.log("no keepers running");
		return 0;
	}
	let rc = 0;
	for (const roomId of ids) {
		const pidFile = pidPath(roomId);
		const pid = readPid(pidFile);
		if (pid === null) {
			console.log(`room ${roomId}: no pidfile`);
			continue;
		}
		if (!pidAlive(pid)) {
			unlinkQuiet(pidFile);
			console.log(`room ${roomId}: pid ${pid} not running (stale pidfile removed)`);
			continue;
		}
		try {
			process.kill(pid, "SIGTERM");
		} catch (err) {
			console.error(`room ${roomId}: cannot signal pid ${pid}: ${err instanceof Error ? err.message : String(err)}`);
			rc = 1;
			continue;
		}
		let gone = false;
		const deadline = Date.now() + 3_000;
		while (Date.now() < deadline) {
			await sleep(100);
			if (!pidAlive(pid)) {
				gone = true;
				break;
			}
		}
		if (!gone) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// already gone
			}
		}
		unlinkQuiet(pidFile);
		console.log(`room ${roomId}: stopped keeper (pid ${pid}${gone ? "" : ", force-killed"})`);
	}
	return rc;
}

function cmdStatus(arg: string): number {
	let filter: string | null = null;
	if (arg.trim() !== "") {
		const ids = roomIdsFromArg(arg);
		if ("error" in ids) {
			console.error(ids.error);
			return 1;
		}
		filter = ids.at(0) ?? null;
	}
	const roomIds = knownRoomIds();
	if (filter !== null && !roomIds.includes(filter)) {
		console.log(`no keeper for room ${filter}`);
		return 0;
	}
	const shown = filter !== null ? [filter] : roomIds;
	if (shown.length === 0) {
		console.log("no keepers running");
		return 0;
	}
	for (const roomId of shown) {
		const pid = readPid(pidPath(roomId));
		const alive = pid !== null && pidAlive(pid);
		const state = pid === null ? "no pidfile" : alive ? "alive" : "dead";
		console.log(`room ${roomId}  pid ${pid ?? "?"}  ${state}`);
		console.log(`  last: ${lastSeenLine(roomId) ?? "(nothing logged yet)"}`);
	}
	return 0;
}

// ----------------------------------------------------------------- daemon

function clampInt(raw: string | undefined, fallback: number, min: number): number {
	const n = Number(raw);
	return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
}

async function runDaemon(): Promise<void> {
	const logFile = process.env[ENV.log] ?? "";
	const fd = logFile === "" ? null : openSync(logFile, "a");
	const write = (line: string): void => {
		if (fd === null) return;
		try {
			writeSync(fd, `${new Date().toISOString()} ${line}\n`);
		} catch {
			// logging must never throw
		}
	};
	write(`--- started pid ${process.pid} ---`);
	const parsed = parseLink(process.env[ENV.link] ?? "");
	if ("error" in parsed) {
		write(`error: ${parsed.error}`);
		if (fd !== null) closeSync(fd);
		process.exit(1);
	}
	const interval = clampInt(process.env[ENV.interval], DEFAULT_INTERVAL_MS, 1_000);
	const jitter = clampInt(process.env[ENV.jitter], DEFAULT_JITTER_MS, 0);
	const name = (process.env[ENV.name] ?? DEFAULT_NAME).trim().slice(0, 64) || DEFAULT_NAME;
	const cryptoKey = await importRoomKey(parsed.key);

	let attempt = 0;
	let notFound = 0;
	let stopped = false;
	let ws: WebSocket | null = null;
	let cancelPing: (() => void) | null = null;

	const clearPing = (): void => {
		cancelPing?.();
		cancelPing = null;
	};
	const clearPidfile = (): void => {
		const file = pidPath(parsed.roomId);
		try {
			if (readPid(file) === process.pid) unlinkSync(file);
		} catch {
			// best effort
		}
	};
	const finish = (code: number, line: string): void => {
		write(line);
		clearPing();
		try {
			ws?.close(1000);
		} catch {
			// already closed
		}
		ws = null;
		clearPidfile();
		if (fd !== null) closeSync(fd);
		process.exit(code);
	};
	const shutdown = (): void => {
		if (stopped) return;
		stopped = true;
		finish(0, "stopping");
	};
	const schedulePing = (): void => {
		clearPing();
		const delay = Math.max(1_000, interval + Math.round((Math.random() * 2 - 1) * jitter));
		const timer = setTimeout(() => {
			const sock = ws;
			if (sock === null) return;
			// @types/web WebSocket lacks Bun's ping(); the runtime has it
			const pinger = sock as unknown as { ping?: () => void };
			try {
				pinger.ping?.();
				write("ping");
			} catch {
				// socket dying; the close handler drives reconnect
			}
			schedulePing();
		}, delay);
		cancelPing = () => clearTimeout(timer);
	};
	const reconnect = (): void => {
		const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
		const delay = Math.round(base * (0.5 + Math.random() * 0.5));
		attempt += 1;
		write(`reconnecting in ${delay} ms`);
		setTimeout(connect, delay);
	};
	const onClose = (code: number, reason: string): void => {
		write(`closed code=${code} reason=${reason}`);
		if (stopped) return;
		if (code === 4001) {
			finish(0, "room closed by host — exiting");
			return;
		}
		if (code === 4009) {
			finish(1, "host already connected — exiting");
			return;
		}
		if (code === 4004) {
			notFound += 1;
			if (notFound > 5) {
				finish(1, "no such room — giving up");
				return;
			}
		}
		reconnect();
	};
	const handleData = async (data: string | ArrayBuffer): Promise<void> => {
		try {
			if (typeof data === "string") {
				let t = data;
				try {
					t = pickString(recordOf(JSON.parse(data))?.t) ?? data;
				} catch {
					// not JSON: log raw control text below
				}
				write(`[control] ${t}`);
				return;
			}
			const frame = parseEnvelope(new Uint8Array(data));
			if (frame === null) return;
			let msg: Record<string, unknown> | null;
			try {
				msg = recordOf(await openFrame(cryptoKey, frame.payload));
			} catch {
				write("bad frame (key mismatch?) — reconnecting");
				try {
					ws?.close(1000);
				} catch {
					// already closed
				}
				return;
			}
			if (msg === null) return;
			if (msg.t === "welcome") {
				attempt = 0;
				notFound = 0;
				const session =
					pickString(recordOf(msg.state)?.sessionName) ?? pickString(recordOf(msg.header)?.title) ?? "?";
				write(`joined room ${parsed.roomId} — host session "${session}"`);
			} else if (msg.t === "error") {
				const message = pickString(msg.message) ?? "";
				write(`host error: ${message}`);
				if (message.includes("protocol mismatch")) {
					finish(1, "protocol mismatch — exiting (re-extract constants from the current omp binary)");
				}
			}
			// snapshot-chunk / state / … : a joined guest only needs to ping
		} catch (err) {
			write(`handler error: ${err instanceof Error ? err.message : String(err)}`);
		}
	};
	const connect = (): void => {
		const sock: WebSocket = new WebSocket(guestUrl(parsed.wsUrl));
		sock.binaryType = "arraybuffer";
		ws = sock;
		sock.onopen = () => {
			if (ws !== sock) return;
			void (async () => {
				try {
					// writeToken is omitted on purpose: read-only spectator
					const sealed = await seal(cryptoKey, { t: "hello", proto: PROTO, name });
					sock.send(encodeEnvelope(0, sealed));
					schedulePing();
				} catch (err) {
					write(`hello failed: ${err instanceof Error ? err.message : String(err)}`);
					try {
						sock.close(1000);
					} catch {
						// already closed
					}
				}
			})();
		};
		sock.onmessage = (ev) => {
			// binaryType "arraybuffer" ⇒ non-string frames arrive as ArrayBuffer
			const data = ev.data as string | ArrayBuffer;
			void handleData(data);
		};
		sock.onerror = () => {
			// onclose follows with the close code
		};
		sock.onclose = (ev) => {
			if (ws !== sock) return;
			ws = null;
			clearPing();
			onClose(ev.code, ev.reason ?? "");
		};
	};
	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
	process.on("uncaughtException", (err) => {
		write(`uncaught: ${err.message}`);
		finish(1, "exiting after uncaught exception");
	});
	connect();
}

// ------------------------------------------------------------------ entry

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const cmd = argv.at(0);
	switch (cmd) {
		case "start":
			process.exitCode = await cmdStart(argv.slice(1));
			break;
		case "stop":
			process.exitCode = await cmdStop(argv.slice(1).join(" "));
			break;
		case "status":
			process.exitCode = cmdStatus(argv.slice(1).join(" "));
			break;
		case "run":
			await runDaemon();
			break;
		case "help":
		case "--help":
		case "-h":
		case undefined:
			console.log(USAGE);
			break;
		default:
			console.error(`unknown command: ${cmd}`);
			console.log(USAGE);
			process.exitCode = 1;
			break;
	}
}

if (import.meta.main) {
	void main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
	});
}
