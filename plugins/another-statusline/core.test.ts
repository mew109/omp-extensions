import { describe, expect, test } from "bun:test";
import { allocate, displayWidth, truncate, truncateLeft, truncateRight } from "./core";

describe("displayWidth", () => {
	test("narrow chars are 1 cell each", () => {
		expect(displayWidth("abc")).toBe(3);
	});
	test("CJK chars are 2 cells", () => {
		expect(displayWidth("陣雨")).toBe(4);
	});
	test("emoji counts 2 cells plus 1 for the variation selector", () => {
		// U+1F326 + FE0F: the allocator's currency counts the selector too.
		expect(displayWidth("🌦️")).toBe(3);
	});
	test("mixed text sums per character", () => {
		expect(displayWidth("🌦️ showers")).toBe(11);
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
