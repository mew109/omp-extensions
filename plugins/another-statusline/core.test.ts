import { describe, expect, test } from "bun:test";
import { allocate, buildStatusLine, createPoller, displayWidth, truncate, truncateLeft, truncateRight, type LineSeg } from "./core";

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
	test("status surface (hpad 0): joined width fits the full 60 columns", () => {
		const parts = buildStatusLine(segs, 60, "  ", 0);
		expect(displayWidth(parts.join("  "))).toBeLessThanOrEqual(60);
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


describe("createPoller", () => {
	test("invalidate drops the cache and the next maybeFetch refetches", async () => {
		let calls = 0;
		const poller = createPoller<{ fetchedAt: number }>({
			label: "test poller",
			refreshMs: 60_000,
			minAttemptMs: 0,
			fetch: () => {
				calls++;
				return Promise.resolve({ fetchedAt: Date.now() });
			},
		});
	// maybeFetch is fire-and-forget and exposes no promise, so one zero-ms
	// macrotask tick (not a fake-timer guess) deterministically drains the
	// fetch chain: every microtask queued before it runs first.
	const settle = async () => {
		const { promise, resolve } = Promise.withResolvers<void>();
		setTimeout(resolve, 0);
		await promise;
	};
		expect(poller.data()).toBeNull();
		poller.maybeFetch();
		await settle();
		expect(poller.data()).not.toBeNull();
		poller.maybeFetch(); // fresh inside refreshMs: no refetch
		await settle();
		expect(calls).toBe(1);
		poller.invalidate();
		expect(poller.data()).toBeNull();
		poller.maybeFetch();
		await settle();
		expect(calls).toBe(2);
		expect(poller.data()).not.toBeNull();
	});
});
