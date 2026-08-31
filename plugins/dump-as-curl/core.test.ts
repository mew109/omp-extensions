import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
	BODY_CAP_BYTES,
	RING_CAP,
	defaultOutPath,
	extractModel,
	isLlmEndpoint,
	makeCapture,
	parseArgs,
	pickCapture,
	pushCapture,
	renderCurlScript,
	resolveOutPath,
	shellQuote,
	usageText,
	type Capture,
} from "./core";

function captureOf(over: Partial<Capture> = {}): Capture {
	return {
		ts: Date.UTC(2026, 7, 27, 12, 0, 0),
		url: "https://api.anthropic.com/v1/messages",
		method: "POST",
		headers: [
			["content-type", "application/json"],
			["x-api-key", "sk-ant-'quoted'"],
		],
		body: '{"model":"claude","messages":[]}',
		...over,
	};
}

function markerCapture(n: number): Capture {
	return captureOf({ body: `{"n":${n}}` });
}

describe("parseArgs", () => {
	test("empty args default to newest", () => {
		expect(parseArgs("")).toEqual({ index: 1, help: false, redact: true });
	});
	test("--index N and --index=N", () => {
		expect(parseArgs("--index 3").index).toBe(3);
		expect(parseArgs("--index=3").index).toBe(3);
		expect(parseArgs("-i 2").index).toBe(2);
		expect(parseArgs("-i=2").index).toBe(2);
	});
	test("--filename bare and quoted", () => {
		expect(parseArgs("--filename out.sh").filename).toBe("out.sh");
		expect(parseArgs('--filename "my file.sh"').filename).toBe("my file.sh");
		expect(parseArgs("--filename='a b.sh'").filename).toBe("a b.sh");
	});
	test("--help wins over later junk", () => {
		const parsed = parseArgs("--help --bogus");
		expect(parsed.help).toBe(true);
		expect(parsed.error).toBeUndefined();
	});
	test("--help short form", () => {
		expect(parseArgs("-h").help).toBe(true);
	});
	test("bad --index values error", () => {
		for (const args of ["--index 0", "--index x", "--index", "--index="]) {
			const parsed = parseArgs(args);
			expect(parsed.error).toContain("--index");
			expect(parsed.index).toBe(1);
		}
	});
	test("unknown option errors", () => {
		expect(parseArgs("--bogus").error).toBe("unknown option: --bogus");
	});
	test("bare argument errors", () => {
		expect(parseArgs("foo").error).toBe("unexpected argument: foo (options start with --)");
	});
	test("--filename without value errors", () => {
		expect(parseArgs("--filename").error).toContain("--filename");
		expect(parseArgs('--filename ""').error).toContain("--filename");
	});
	test("repeated flags: last wins", () => {
		expect(parseArgs("--index 1 --index 2").index).toBe(2);
		expect(parseArgs("--index 1 --index 2").error).toBeUndefined();
	});
	test("--no-redact disables redaction", () => {
		const parsed = parseArgs("--no-redact");
		expect(parsed.redact).toBe(false);
		expect(parsed.error).toBeUndefined();
	});
	test("--no-redact combines with other flags", () => {
		const parsed = parseArgs("--no-redact --index 2");
		expect(parsed.redact).toBe(false);
		expect(parsed.index).toBe(2);
	});
});

describe("usageText", () => {
	test("starts with usage line", () => {
		expect(usageText().startsWith("Usage: /dump-as-curl")).toBe(true);
	});
	test("documents --no-redact", () => {
		expect(usageText()).toContain("--no-redact");
	});
});

describe("isLlmEndpoint", () => {
	test("known LLM endpoints match", () => {
		const urls = [
			"https://api.anthropic.com/v1/messages?beta=true",
			"https://api.openai.com/v1/chat/completions",
			"https://api.openai.com/v1/completions",
			"https://api.openai.com/v1/responses",
			"http://127.0.0.1:8080/v1/chat/completions",
			"http://127.0.0.1:8080/completion",
			"http://host:11434/api/chat",
			"http://host:11434/api/generate",
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
			"https://bedrock-runtime.us-east-1.amazonaws.com/model/claude-3/converse",
		];
		for (const url of urls) {
			expect(isLlmEndpoint(url)).toBe(true);
		}
	});
	test("non-LLM urls do not match", () => {
		for (const url of [
			"https://api.openai.com/v1/models",
			"https://api.openai.com/v1/embeddings",
			"https://api.openai.com/v1/audio",
			"https://github.com/owner/repo",
			"not a url",
		]) {
			expect(isLlmEndpoint(url)).toBe(false);
		}
	});
});

describe("makeCapture", () => {
	test("plain-object headers become ordered pairs", () => {
		const c = makeCapture("https://x/v1/messages", "POST", { "content-type": "application/json", "x-a": "1" }, "{}");
		expect(c?.headers).toEqual([
			["content-type", "application/json"],
			["x-a", "1"],
		]);
		expect(c?.method).toBe("POST");
		expect(c?.body).toBe("{}");
		expect(c?.bodyOmitted).toBeUndefined();
	});
	test("Headers instance becomes pairs", () => {
		const h = new Headers({ "x-b": "2" });
		const c = makeCapture("https://x/v1/messages", "POST", h, "");
		expect(c?.headers).toEqual([["x-b", "2"]]);
	});
	test("string body passes through", () => {
		const c = makeCapture("https://x/v1/messages", "POST", {}, '{"a":1}');
		expect(c?.body).toBe('{"a":1}');
	});
	test("Uint8Array body is decoded", () => {
		const c = makeCapture("https://x/v1/messages", "POST", {}, new TextEncoder().encode('{"u":1}'));
		expect(c?.body).toBe('{"u":1}');
	});
	test("body over cap is omitted", () => {
		const c = makeCapture("https://x/v1/messages", "POST", {}, "0123456789abcdefghij", 10);
		expect(c?.body).toBe("");
		expect(c?.bodyOmitted).toBe(true);
	});
	test("non-text body is omitted", () => {
		const c = makeCapture("https://x/v1/messages", "POST", {}, {});
		expect(c?.body).toBe("");
		expect(c?.bodyOmitted).toBe(true);
	});
	test("absent body is empty, not omitted", () => {
		const c = makeCapture("https://x/v1/messages", "POST", {}, undefined);
		expect(c?.body).toBe("");
		expect(c?.bodyOmitted).toBeUndefined();
	});
	test("default cap is 16 MiB", () => {
		expect(BODY_CAP_BYTES).toBe(16 * 1024 * 1024);
	});
	test("non-ByteString header value yields null instead of throwing", () => {
		expect(makeCapture("https://x/v1/messages", "POST", { bad: "\u1234" }, "")).toBeNull();
	});
});

describe("ring", () => {
	test("pushCapture keeps at most RING_CAP, dropping oldest", () => {
		const ring: Capture[] = [];
		for (let n = 1; n <= RING_CAP + 3; n++) {
			pushCapture(ring, markerCapture(n));
		}
		expect(ring.length).toBe(RING_CAP);
		expect(pickCapture(ring, 1)?.body).toBe(`{"n":${RING_CAP + 3}}`);
		expect(pickCapture(ring, RING_CAP)?.body).toBe('{"n":4}');
	});
	test("pickCapture out of range is undefined", () => {
		const ring: Capture[] = [markerCapture(1)];
		expect(pickCapture(ring, 2)).toBeUndefined();
	});
});

describe("extractModel", () => {
	test("model from JSON body", () => {
		expect(extractModel(captureOf({ body: '{"model":"qwen3","messages":[]}' }))).toBe("qwen3");
	});
	test("model from bedrock-style URL", () => {
		expect(extractModel(captureOf({ url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/claude-3/converse", body: "{}" }))).toBe(
			"claude-3",
		);
	});
	test("model from gemini-style URL", () => {
		expect(
			extractModel(
				captureOf({
					url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent",
					body: "",
				}),
			),
		).toBe("gemini-2.0-flash");
	});
	test("unknown when nothing matches", () => {
		expect(extractModel(captureOf({ url: "https://x/v1/messages", body: "not json" }))).toBe("unknown");
	});
});

describe("shellQuote", () => {
	test("plain word is wrapped", () => {
		expect(shellQuote("abc")).toBe("'abc'");
	});
	test("single quote is escaped", () => {
		expect(shellQuote("a'b")).toBe("'a'\\''b'");
	});
});

describe("renderCurlScript", () => {
	test("full script shape", () => {
		const c = captureOf({
			headers: [
				["content-type", "application/json"],
				["x-api-key", "sk-ant-'quoted'"],
				["content-length", "30"],
				["host", "api.anthropic.com"],
			],
		});
		const script = renderCurlScript(c, 1, 3);
		const lines = script.split("\n");
		expect(lines[0]).toBe("#!/bin/sh");
		expect(lines[1]).toBe("# omp dump-as-curl — captured 2026-08-27T12:00:00.000Z (capture 1/3)");
		expect(lines[2]).toBe(`# POST ${c.url}`);
		expect(lines[3]).toBe(`# model: claude   body: ${Buffer.byteLength(c.body)} bytes`);
		expect(lines[4]).toBe("# WARNING: may contain API keys in headers. File is 0700; delete after use.");
		expect(lines[5]).toBe("set -e");
		expect(lines[6]).toBe(`curl -sS -N -X POST ${shellQuote(c.url)} \\`);
		expect(script).toContain("  -H 'content-type: application/json' \\");
		expect(script).toContain(`  -H ${shellQuote("x-api-key: sk-ant-'quoted'")} \\`);
		expect(script).not.toMatch(/content-length/i);
		expect(script).not.toMatch(/^host:/m);
		const delim = `omp_dump_as_curl_EOF_${c.ts.toString(36)}`;
		expect(script).toContain(`  --data-binary @- <<'${delim}'`);
		const bodyLine = lines.indexOf(c.body);
		expect(lines[bodyLine + 1]).toBe(delim);
		expect(script.endsWith(`${delim}\n`)).toBe(true);
	});
	test("omitted body renders comment, no heredoc", () => {
		const script = renderCurlScript(captureOf({ body: "", bodyOmitted: true }), 1, 1);
		expect(script).toContain("# body omitted (>16 MiB or non-text body); attach it manually");
		expect(script).not.toContain("--data-binary");
		expect(script).not.toContain("<<'omp_dump_as_curl_EOF_");
	});
	test("empty body renders no heredoc and no comment", () => {
		const script = renderCurlScript(captureOf({ body: "" }), 1, 1);
		expect(script).not.toContain("--data-binary");
		expect(script).not.toContain("body omitted");
	});
	test("redacts bearer token by default", () => {
		const c = captureOf({ headers: [["authorization", "Bearer sk-secret-123"]] });
		const script = renderCurlScript(c, 1, 1);
		expect(script).toContain("-H 'authorization: Bearer <REDACTED>' \\");
		expect(script).not.toContain("sk-secret-123");
	});
	test("--no-redact keeps the original bearer token", () => {
		const c = captureOf({ headers: [["authorization", "Bearer sk-secret-123"]] });
		const script = renderCurlScript(c, 1, 1, false);
		expect(script).toContain("Bearer sk-secret-123");
	});
	test("non-bearer authorization stays verbatim", () => {
		const c = captureOf({ headers: [["authorization", "Basic dXNlcjpwYXNz"]] });
		expect(renderCurlScript(c, 1, 1)).toContain("Basic dXNlcjpwYXNz");
	});
	test("lowercase bearer scheme is redacted", () => {
		const c = captureOf({ headers: [["authorization", "bearer sk-x"]] });
		expect(renderCurlScript(c, 1, 1)).toContain("Bearer <REDACTED>");
	});
});

describe("resolveOutPath", () => {
	test("undefined yields default tmp name", () => {
		const out = resolveOutPath(undefined, "/tmp");
		expect(out.startsWith(tmpdir())).toBe(true);
		expect(basename(out).startsWith("omp-llm-request-curl-")).toBe(true);
		expect(basename(out).endsWith(".sh")).toBe(true);
	});
	test("bare name lands in tmp dir", () => {
		expect(resolveOutPath("out.sh", "/tmp")).toBe(join(tmpdir(), "out.sh"));
	});
	test("cwd-relative path resolves against cwd", () => {
		expect(resolveOutPath("./out.sh", "/work")).toBe(resolve("/work", "./out.sh"));
	});
	test("absolute path passes through", () => {
		expect(resolveOutPath("/tmp/x/out.sh", "/work")).toBe(resolve("/work", "/tmp/x/out.sh"));
	});
	test("windows drive path: cwd on win32, tmp dir elsewhere", () => {
		expect(resolveOutPath("C:\\tmp\\out.sh", "/work")).toBe(
			process.platform === "win32" ? resolve("/work", "C:\\tmp\\out.sh") : join(tmpdir(), "C:\\tmp\\out.sh"),
		);
	});
	test("backslash relative name: cwd on win32, tmp dir elsewhere", () => {
		expect(resolveOutPath("sub\\out.sh", "/work")).toBe(
			process.platform === "win32" ? resolve("/work", "sub\\out.sh") : join(tmpdir(), "sub\\out.sh"),
		);
	});
});

describe("defaultOutPath", () => {
	test("tmp dir with omp prefix", () => {
		const out = defaultOutPath();
		expect(out.startsWith(tmpdir())).toBe(true);
		expect(basename(out).startsWith("omp-llm-request-curl-")).toBe(true);
	});
});
