import { describe, expect, test } from "bun:test";
import { abbreviateSessionName, herdrSpawnTarget } from "./core";

describe("abbreviateSessionName", () => {
	test("pure ASCII long name is cut to 15 columns with ellipsis", () => {
		const out = abbreviateSessionName("Fix the login page render bug");
		expect(out).toBe("Fix the login p…");
		expect(Bun.stringWidth(out)).toBe(16);
	});

	test("CJK name is cut to 15 columns with ellipsis", () => {
		const out = abbreviateSessionName("重構狀態列寬度處理");
		expect(out).toBe("重構狀態列寬度…");
		expect(Bun.stringWidth(out)).toBe(15);
		expect(Bun.stringWidth(out)).toBeLessThanOrEqual(16);
	});

	test("mixed CJK and ASCII stays within 16 columns", () => {
		const out = abbreviateSessionName("fix 重構狀態列 width bug");
		expect(Bun.stringWidth(out)).toBeLessThanOrEqual(16);
	});

	test("short title passes through without ellipsis", () => {
		expect(abbreviateSessionName("Fix the login")).toBe("Fix the login");
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
		// 7 CJK chars = 14 columns; the 8th would land at 16.
		const out = abbreviateSessionName("一二三四五六七八");
		expect(Bun.stringWidth(out)).toBe(15);
		expect(out).toBe("一二三四五六七…");
	});

	test("all control/whitespace returns empty string", () => {
		expect(abbreviateSessionName(" \t \u0003 ")).toBe("");
	});

	test("custom maxColumns", () => {
		expect(abbreviateSessionName("abcdefghij", 4)).toBe("abcd…");
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
