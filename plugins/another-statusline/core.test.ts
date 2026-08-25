import { describe, expect, test } from "bun:test";
import { allocate, buildStatusLine, displayWidth, parseStatuslineConfig, resolveBounds, resolveSegments, truncate, truncateLeft, truncateRight, type LineSeg, type Segment } from "./core";

const seg = (id: string): Segment => ({ id, max: 30, min: 8, render: () => null });
const all = ["path", "git", "pr"].map(seg);

describe("displayWidth", () => {
	test("narrow chars are 1 cell each", () => {
		expect(displayWidth("abc")).toBe(3);
	});
	test("CJK chars are 2 cells", () => {
		expect(displayWidth("陣雨")).toBe(4);
	});
	test("emoji+VS16 as one cluster counts 2 cells", () => {
		expect(displayWidth("🌦️")).toBe(2);
	});
	test("mixed text sums per cluster", () => {
		expect(displayWidth("🌦️ showers")).toBe(10);
	});
	test("⛅ counts 2 cells (U+26C5 undercount regression)", () => {
		expect(displayWidth("⛅ 局部多雲 26°C 85%")).toBe(20);
	});
	test("a tab counts 3 cells", () => {
		expect(displayWidth("a\tb")).toBe(5);
	});
});

describe("truncation", () => {
	test("truncateLeft keeps the head behind an ellipsis", () => {
		expect(truncateLeft("abcdefghij", 5)).toBe("abcd…");
	});
	test("truncateRight keeps the tail behind an ellipsis", () => {
		expect(truncateRight("abcdefghij", 5)).toBe("…ghij");
	});
	test("within-width text passes through unchanged", () => {
		expect(truncateLeft("abc", 5)).toBe("abc");
		expect(truncateRight("abc", 5)).toBe("abc");
	});
	test("wide chars never straddle the cut", () => {
		expect(truncateLeft("陣雨showers", 6)).toBe("陣雨s…");
	});
	test("policy helper picks the kept side", () => {
		expect(truncate("abcdefghij", "head", 5)).toBe("abcd…");
		expect(truncate("abcdefghij", "tail", 5)).toBe("…ghij");
	});
	test("truncateLeft on 2-cell emoji never splits a cluster", () => {
		expect(truncateLeft("⛅⛅⛅", 5)).toBe("⛅⛅…");
	});
});

describe("buildStatusLine", () => {
	const segs: LineSeg[] = [
		{ text: "▸ ~/src/omp-extensions", keep: "tail", max: 40, min: 24 },
		{ text: "⑂ feature/statusline-width", keep: "head", max: 36, min: 20 },
		{ text: "⤴ #123", keep: "head", max: 30, min: 10 },
		{ text: "⛅ 局部多雲 26°C 85%", keep: "head", max: 39, min: 20 },
		{ text: "📈 TAIEX 22,650.12 ▲ +112.34 +0.50%", keep: "head", max: 38, min: 20 },
	];
	test("60-col terminal: joined width fits the 58-cell content area", () => {
		const parts = buildStatusLine(segs, 60);
		expect(displayWidth(parts.join("  "))).toBeLessThanOrEqual(58);
	});
	test("30-col terminal: still one row", () => {
		const parts = buildStatusLine(segs, 30);
		expect(displayWidth(parts.join("  "))).toBeLessThanOrEqual(28);
	});
	test("wide terminal: no truncation", () => {
		const parts = buildStatusLine(segs, 200);
		expect(parts).toEqual(segs.map((s) => s.text));
	});
});

describe("allocate", () => {
	test("under budget keeps desired widths", () => {
		expect(allocate(100, [{ desired: 10, min: 5 }, { desired: 6, min: 5 }])).toEqual([10, 6]);
	});
	test("shrinks the rightmost to its min before touching the left", () => {
		expect(allocate(12, [{ desired: 10, min: 5 }, { desired: 10, min: 5 }])).toEqual([7, 5]);
	});
	test("spills below min on the right when mins exceed the budget", () => {
		expect(allocate(8, [{ desired: 10, min: 5 }, { desired: 10, min: 5 }])).toEqual([5, 3]);
	});
	test("floors every segment at 1 cell", () => {
		expect(allocate(3, [{ desired: 10, min: 2 }, { desired: 10, min: 2 }])).toEqual([2, 1]);
	});
});

describe("parseStatuslineConfig", () => {
	test("parses YAML with both keys", () => {
		const cfg = parseStatuslineConfig("segments: [path, git]\nsegmentOptions:\n  git: { max: 20, min: 5 }\n");
		expect(cfg).toEqual({ segments: ["path", "git"], segmentOptions: { git: { max: 20, min: 5 } } });
	});
	test("accepts JSON (valid YAML)", () => {
		expect(parseStatuslineConfig('{"segments":["git"]}')).toEqual({ segments: ["git"] });
	});
	test("bad YAML returns null", () => {
		expect(parseStatuslineConfig("segments: [path,,")).toBe(null);
	});
	test("array top level returns null", () => {
		expect(parseStatuslineConfig("[1, 2]")).toBe(null);
	});
	test("non-string segments array is dropped", () => {
		expect(parseStatuslineConfig("segments: [path, 3]")).toEqual({});
	});
	test("non-positive-integer option fields are dropped", () => {
		const cfg = parseStatuslineConfig("segmentOptions:\n  git: { max: 2.5, min: -1 }\n  path: { max: 20 }");
		expect(cfg).toEqual({ segmentOptions: { git: {}, path: { max: 20 } } });
	});
});

describe("resolveSegments", () => {
	test("null config keeps built-in order and all segments", () => {
		expect(resolveSegments(all, null).map((s) => s.id)).toEqual(["path", "git", "pr"]);
	});
	test("reorders and filters to the listed ids", () => {
		expect(resolveSegments(all, { segments: ["pr", "path"] }).map((s) => s.id)).toEqual(["pr", "path"]);
	});
	test("omitted ids are hidden", () => {
		expect(resolveSegments(all, { segments: ["git"] }).map((s) => s.id)).toEqual(["git"]);
	});
	test("unknown ids are excluded", () => {
		expect(resolveSegments(all, { segments: ["git", "nope"] }).map((s) => s.id)).toEqual(["git"]);
	});
	test("empty segments list falls back to all", () => {
		expect(resolveSegments(all, { segments: [] }).map((s) => s.id)).toEqual(["path", "git", "pr"]);
	});
});

describe("resolveBounds", () => {
	test("applies valid max and min", () => {
		expect(resolveBounds(seg("git"), { max: 20, min: 5 })).toEqual({ max: 20, min: 5 });
	});
	test("undefined option keeps built-in bounds", () => {
		expect(resolveBounds(seg("git"), undefined)).toEqual({ max: 30, min: 8 });
	});
	test("missing fields fall back per-field", () => {
		expect(resolveBounds(seg("git"), { min: 5 })).toEqual({ max: 30, min: 5 });
	});
	test("min > max falls back to both built-ins", () => {
		expect(resolveBounds(seg("git"), { max: 5, min: 40 })).toEqual({ max: 30, min: 8 });
	});
});
