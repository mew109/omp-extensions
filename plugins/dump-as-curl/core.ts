import { tmpdir } from "node:os";
import { join as pathJoin, resolve as pathResolve } from "node:path";

/** One intercepted LLM request. */
export interface Capture {
	/** Date.now() at fetch time. */
	ts: number;
	/** Full URL string. */
	url: string;
	/** Upper-case method, e.g. "POST". */
	method: string;
	/** Ordered header name/value pairs. */
	headers: [string, string][];
	/** Verbatim wire body; "" when absent. */
	body: string;
	/** Body present but not extractable or above the cap. */
	bodyOmitted?: boolean;
}

/** Captures kept per process (newest last). */
export const RING_CAP = 8;
/** Bodies above this size are not stored. */
export const BODY_CAP_BYTES = 16 * 1024 * 1024;

export interface DumpAsCurlArgs {
	/** 1 = newest capture. */
	index: number;
	/** Raw --filename value, unresolved. */
	filename?: string;
	help: boolean;
	/** Human-readable parse error. */
	error?: string;
}

function tokenize(args: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let quote: string | null = null;
	for (const ch of args) {
		if (quote !== null) {
			if (ch === quote) {
				quote = null;
			} else {
				cur += ch;
			}
		} else if (ch === "'" || ch === '"') {
			quote = ch;
		} else if (ch === " " || ch === "\t" || ch === "\n") {
			if (cur !== "") {
				tokens.push(cur);
				cur = "";
			}
		} else {
			cur += ch;
		}
	}
	if (cur !== "") tokens.push(cur);
	return tokens;
}

export function parseArgs(args: string): DumpAsCurlArgs {
	const tokens = tokenize(args);
	let index = 1;
	let filename: string | undefined;
	const err = (error: string): DumpAsCurlArgs => ({ index: 1, help: false, error });
	let i = 0;
	while (i < tokens.length) {
		const tok = tokens[i++];
		const eq = tok.indexOf("=");
		const name = eq === -1 ? tok : tok.slice(0, eq);
		const inline = eq === -1 ? undefined : tok.slice(eq + 1);
		if (name === "--help" || name === "-h") {
			return { index: 1, help: true };
		}
		if (name === "--index" || name === "-i") {
			const v = inline !== undefined ? inline : tokens[i++];
			if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) {
				return err("--index expects a positive integer (1 = newest)");
			}
			index = Number(v);
		} else if (name === "--filename" || name === "-f") {
			const v = inline !== undefined ? inline : tokens[i++];
			if (v === undefined || v === "") {
				return err("--filename expects a file name");
			}
			filename = v;
		} else if (name.startsWith("-")) {
			return err(`unknown option: ${name}`);
		} else {
			return err(`unexpected argument: ${tok} (options start with --)`);
		}
	}
	return { index, filename, help: false };
}

export function usageText(): string {
	return [
		"Usage: /dump-as-curl [--index N] [--filename FILE] [--help]",
		"",
		"Writes the newest captured LLM request as an executable curl script",
		"(POST url + headers + verbatim body, from in-process fetch interception).",
		"",
		"  --index N        which capture to dump: 1 = newest (default 1; 8 kept)",
		'  --filename FILE  output file: bare name -> OS tmp dir; a path with "/"',
		"                   resolves against the cwd",
		"  --help           show this help",
	].join("\n");
}

const ENDPOINT_PATTERNS = [
	"/v1/messages",
	"/completion",
	"/v1/responses",
	"generatecontent",
	"/api/chat",
	"/api/generate",
	"/converse",
];

export function isLlmEndpoint(url: string): boolean {
	try {
		const path = new URL(url).pathname.toLowerCase();
		return ENDPOINT_PATTERNS.some((pat) => path.includes(pat));
	} catch {
		return false;
	}
}

export function makeCapture(
	url: string,
	method: string,
	headers: unknown,
	body: unknown,
	cap: number = BODY_CAP_BYTES,
): Capture | null {
	try {
		const pairs: [string, string][] = [];
		for (const [name, value] of new Headers(headers as HeadersInit | undefined).entries()) {
			pairs.push([name, value]);
		}
		let text = "";
		let omitted = false;
		if (typeof body === "string") {
			text = body;
		} else if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
			text = new TextDecoder().decode(body);
		} else if (body != null) {
			omitted = true;
		}
		if (text.length > cap) {
			text = "";
			omitted = true;
		}
		const capture: Capture = { ts: Date.now(), url, method: method.toUpperCase(), headers: pairs, body: text };
		if (omitted) capture.bodyOmitted = true;
		return capture;
	} catch {
		return null;
	}
}

export function pushCapture(ring: Capture[], c: Capture): void {
	ring.push(c);
	while (ring.length > RING_CAP) ring.shift();
}

export function pickCapture(ring: Capture[], oneBasedIndexFromNewest: number): Capture | undefined {
	return ring[ring.length - oneBasedIndexFromNewest];
}

export function extractModel(c: Capture): string {
	try {
		const model = (JSON.parse(c.body) as { model?: unknown }).model;
		if (typeof model === "string" && model !== "") return model;
	} catch {
		// not JSON
	}
	const byModel = /\/model\/([^/?#:]+)/.exec(c.url);
	if (byModel) return byModel[1];
	const byModels = /\/models\/([^/:]+):/.exec(c.url);
	if (byModels) return byModels[1];
	return "unknown";
}

const SKIPPED_HEADERS: Record<string, true> = {
	"content-length": true,
	host: true,
	"transfer-encoding": true,
	connection: true,
};

export function shellQuote(s: string): string {
	return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function renderCurlScript(c: Capture, index: number, total: number): string {
	const delim = `omp_dump_as_curl_EOF_${c.ts.toString(36)}`;
	const lines: string[] = [
		"#!/bin/sh",
		`# omp dump-as-curl — captured ${new Date(c.ts).toISOString()} (capture ${index}/${total})`,
		`# POST ${c.url}`,
		`# model: ${extractModel(c)}   body: ${Buffer.byteLength(c.body)} bytes`,
		"# WARNING: may contain API keys in headers. File is 0700; delete after use.",
		"set -e",
		`curl -sS -N -X ${c.method} ${shellQuote(c.url)} \\`,
	];
	for (const [name, value] of c.headers) {
		if (SKIPPED_HEADERS[name.toLowerCase()]) continue;
		lines.push(`  -H ${shellQuote(`${name}: ${value}`)} \\`);
	}
	if (c.bodyOmitted) {
		lines.push("  # body omitted (>16 MiB or non-text body); attach it manually");
	} else if (c.body !== "") {
		lines.push(`  --data-binary @- <<'${delim}'`);
		lines.push(c.body);
		lines.push(delim);
	}
	return lines.join("\n") + "\n";
}

export function defaultOutPath(): string {
	return pathJoin(tmpdir(), "omp-llm-request-curl-" + Date.now().toString(36) + ".sh");
}

export function resolveOutPath(filename: string | undefined, cwd: string): string {
	if (filename === undefined) return defaultOutPath();
	if (filename.includes("/")) return pathResolve(cwd, filename);
	return pathJoin(tmpdir(), filename);
}
