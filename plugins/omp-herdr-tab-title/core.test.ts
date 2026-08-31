import { describe, expect, test } from "bun:test";
import { abbreviateSessionName, herdrSpawnTarget } from "./core";

describe("abbreviateSessionName", () => {
	test("pure ASCII long name is cut to 12 columns", () => {
		const out = abbreviateSessionName("Fix the login page render bug");
		expect(out).toBe("Fix the logi");
		expect(Bun.stringWidth(out)).toBe(12);
	});

	test("CJK name yields fewer than 12 chars", () => {
		const out = abbreviateSessionName("重構狀態列寬度處理");
		expect(Bun.stringWidth(out)).toBeLessThanOrEqual(12);
		expect(out.length).toBeLessThan(12);
		expect("重構狀態列".startsWith(out.slice(0, -1))).toBe(true);
	});

	test("mixed CJK and ASCII stays within 12 columns", () => {
		const out = abbreviateSessionName("fix 重構狀態列 width bug");
		expect(Bun.stringWidth(out)).toBeLessThanOrEqual(12);
	});

	test("collapses whitespace", () => {
		expect(abbreviateSessionName("  a\t b\n\n c  ")).toBe("a b c");
	});

	test("strips control chars", () => {
		expect(abbreviateSessionName("\u0001\u0002abc\u0007def")).toBe("abcdef");
	});

	test("keeps emoji cluster whole", () => {
		const out = abbreviateSessionName("👨‍👩‍👧‍👦 family work");
		expect(out.startsWith("👨‍👩‍👧‍👦")).toBe(true);
	});

	test("excludes a wide cluster that would exceed the limit", () => {
		// 5 CJK chars = 10 columns; a 6th would land at 12... 7th would be 14.
		const out = abbreviateSessionName("一二三四五六七");
		expect(Bun.stringWidth(out)).toBe(12);
		expect(out).toBe("一二三四五六");
	});

	test("all control/whitespace returns empty string", () => {
		expect(abbreviateSessionName(" \t \u0003 ")).toBe("");
	});

	test("custom maxColumns", () => {
		expect(abbreviateSessionName("abcdefghij", 4)).toBe("abcd");
	});
});

describe("herdrSpawnTarget", () => {
	test("missing HERDR_TAB_ID returns undefined", () => {
		expect(herdrSpawnTarget({})).toBeUndefined();
	});

	test("empty HERDR_TAB_ID returns undefined", () => {
		expect(herdrSpawnTarget({ HERDR_TAB_ID: "" })).toBeUndefined();
		expect(herdrSpawnTarget({ HERDR_TAB_ID: "  " })).toBeUndefined();
	});

	test("tab id present, default bin", () => {
		expect(herdrSpawnTarget({ HERDR_TAB_ID: "w4:t1" })).toEqual({
			tabId: "w4:t1",
			bin: "herdr",
		});
	});

	test("HERDR_BIN_PATH override respected", () => {
		expect(
			herdrSpawnTarget({ HERDR_TAB_ID: "w4:t1", HERDR_BIN_PATH: "/usr/local/bin/herdr" }),
		).toEqual({ tabId: "w4:t1", bin: "/usr/local/bin/herdr" });
	});
});
