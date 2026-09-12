import { describe, expect, test } from "bun:test";
import {
	createRedactor,
	DEFAULT_SETTINGS,
	formatMap,
	maskContent,
	maskMessages,
	piiSettings,
	PATTERNS,
	parseBool,
	unmaskContent,
	unmaskInPlace,
	type Redactor,
} from "./core";

const NO_PHONE = PATTERNS.filter((p) => p.name !== "PHONE");

function freshFull(): Redactor {
	return createRedactor(PATTERNS);
}

function freshNoPhone(): Redactor {
	return createRedactor(NO_PHONE);
}

describe("mask/unmask roundtrip", () => {
	test("masks and restores email, AWS key, JWT, conn string", () => {
		const r = freshFull();
		const secrets = [
			"test@example.com",
			"AKIAIOSFODNN7EXAMPLE",
			"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_-xyz",
			"mongodb+srv://user:hunter2@cluster.mongodb.net/db",
		];
		const input = `mail ${secrets[0]} key ${secrets[1]} tok ${secrets[2]} db ${secrets[3]}`;
		const masked = r.mask(input);
		for (const s of secrets) expect(masked).not.toContain(s);
		// EMAIL runs before CONN_STR upstream, so the password+host section
		// masks as EMAIL; the roundtrip restore is what matters.
		expect(masked).toContain("[EMAIL_");
		expect(masked).toContain("[AWS_KEY_");
		expect(masked).toContain("[JWT_");
		expect(r.unmask(masked)).toBe(input);
	});

	test("identical value reuses one placeholder", () => {
		const r = freshNoPhone();
		const masked = r.mask("a@x.com and a@x.com again");
		const placeholders = masked.match(/\[EMAIL_\d+\]/g) ?? [];
		expect(new Set(placeholders).size).toBe(1);
	});

	test("entries lists placeholder → original in insertion order", () => {
		const r = freshNoPhone();
		const masked = r.mask("mail a@x.com key AKIAIOSFODNN7EXAMPLE");
		const entries = r.entries();
		expect(entries.length).toBe(2);
		expect(entries[0][1]).toBe("a@x.com");
		expect(entries[1][1]).toBe("AKIAIOSFODNN7EXAMPLE");
		expect(r.unmask(masked)).toBe("mail a@x.com key AKIAIOSFODNN7EXAMPLE");
	});
});

describe("PHONE toggle", () => {
	test("default set leaves timestamps and 10-digit numbers alone", () => {
		const r = freshNoPhone();
		const input = "ref 1757659200 call 0912345678 mail a@x.com";
		const masked = r.mask(input);
		expect(masked).toContain("1757659200");
		expect(masked).toContain("0912345678");
		expect(masked).toContain("[EMAIL_");
	});

	test("full PATTERNS masks both as PHONE", () => {
		const r = freshFull();
		const masked = r.mask("ref 1757659200 call 0912345678");
		expect(masked).not.toContain("1757659200");
		expect(masked).not.toContain("0912345678");
		expect(masked).toContain("[PHONE_1]");
		expect(masked).toContain("[PHONE_2]");
	});
});

describe("maskMessages", () => {
	test("user string content is masked", () => {
		const r = freshNoPhone();
		const out = maskMessages([{ role: "user", content: "mail a@x.com" }], r);
		expect(out[0].content).toBe("mail [EMAIL_1]");
	});

	test("user block content: text and thinking fields masked", () => {
		const r = freshNoPhone();
		const content = [
			{ type: "text", text: "mail a@x.com" },
			{ type: "thinking", text: "about a@x.com" },
			{ type: "image", url: "x" },
		];
		const out = maskMessages([{ role: "user", content }], r);
		const blocks = out[0].content as { type: string; text?: string }[];
		expect(blocks[0].text).toBe("mail [EMAIL_1]");
		expect(blocks[1].text).toBe("about [EMAIL_1]");
		expect(blocks[2]).toEqual({ type: "image", url: "x" });
	});

	test("toolResult string content masked", () => {
		const r = freshNoPhone();
		const out = maskMessages([{ role: "toolResult", content: "key AKIAIOSFODNN7EXAMPLE" }], r);
		expect(out[0].content).not.toContain("AKIAIOSFODNN7EXAMPLE");
	});

	test("assistant: only thinking fields masked", () => {
		const r = freshNoPhone();
		const content = [
			{ type: "text", text: "reply with a@x.com" },
			{ type: "thinking", thinking: "saw a@x.com" },
		];
		const out = maskMessages([{ role: "assistant", content }], r);
		const blocks = out[0].content as { type: string; text?: string; thinking?: string }[];
		expect(blocks[0].text).toBe("reply with a@x.com");
		expect(blocks[1].thinking).toBe("saw [EMAIL_1]");
	});

	test("other roles untouched", () => {
		const r = freshNoPhone();
		const msg = { role: "system", content: "mail a@x.com" };
		expect(maskMessages([msg], r)[0]).toBe(msg);
	});

	test("input not mutated", () => {
		const r = freshNoPhone();
		const content = [{ type: "text", text: "mail a@x.com" }];
		const messages = [{ role: "user", content }];
		maskMessages(messages, r);
		expect(content[0].text).toBe("mail a@x.com");
	});
});

describe("unmaskInPlace", () => {
	test("restores nested tool args in place", () => {
		const r = freshNoPhone();
		const masked = r.mask("a@x.com");
		const args = { path: "/tmp/x", body: `mail ${masked}`, meta: { note: `${masked} twice ${masked}` } };
		unmaskInPlace(args as unknown as Record<string, unknown>, r);
		expect(args.body).toBe("mail a@x.com");
		expect(args.meta.note).toBe("a@x.com twice a@x.com");
	});
});

describe("unmaskContent", () => {
	test("restores text and thinking, passes other blocks through", () => {
		const r = freshNoPhone();
		const masked = r.mask("a@x.com");
		const blocks = [
			{ type: "text", text: masked },
			{ type: "thinking", thinking: masked },
			{ type: "image", url: "x" },
		];
		const out = unmaskContent(blocks, r);
		expect(out[0].text).toBe("a@x.com");
		expect(out[1].thinking).toBe("a@x.com");
		expect(out[2]).toEqual({ type: "image", url: "x" });
	});
});

describe("piiSettings", () => {
	test("default when no env and no YAML", () => {
		expect(piiSettings(null, {})).toEqual({ phone: false });
		expect(piiSettings(undefined, {})).toEqual(DEFAULT_SETTINGS);
	});

	test("YAML phone: true enables", () => {
		expect(piiSettings({ phone: true }, {})).toEqual({ phone: true });
	});

	test("env true overrides YAML false", () => {
		expect(piiSettings({ phone: false }, { PII_MASK_PHONE: "true" })).toEqual({ phone: true });
	});

	test("env false overrides YAML true", () => {
		expect(piiSettings({ phone: true }, { PII_MASK_PHONE: "false" })).toEqual({ phone: false });
	});

	test("invalid env values count as unset", () => {
		expect(piiSettings({ phone: true }, { PII_MASK_PHONE: "maybe" })).toEqual({ phone: true });
		expect(piiSettings(null, { PII_MASK_PHONE: "" })).toEqual({ phone: false });
	});

	test("YAML number counts as unset", () => {
		expect(piiSettings({ phone: 1 }, {})).toEqual({ phone: false });
	});
});

describe("parseBool", () => {
	test("truthy strings and booleans", () => {
		for (const v of [true, "true", "TRUE", "1", " yes ", "on", "On"]) {
			expect(parseBool(v)).toBe(true);
		}
	});

	test("falsy strings and booleans", () => {
		for (const v of [false, "false", "FALSE", "0", " no ", "off", "Off"]) {
			expect(parseBool(v)).toBe(false);
		}
	});

	test("unset inputs", () => {
		for (const v of [undefined, null, "", "maybe", 1, 0, {}, []]) {
			expect(parseBool(v)).toBeUndefined();
		}
	});
});

describe("formatMap", () => {
	test("empty entries", () => {
		expect(formatMap([])).toBe("No PII values redacted this session.");
	});

	test("non-empty entries joined by newline", () => {
		expect(formatMap([["[EMAIL_1]", "a@x.com"], ["[JWT_2]", "eyJ.a.b"]])).toBe(
			"[EMAIL_1] → a@x.com\n[JWT_2] → eyJ.a.b",
		);
	});
});
