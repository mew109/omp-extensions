import { describe, expect, test } from "bun:test";
import { applyStockSettings, DEFAULT_STOCK, exchangeDate, parseYahooChart, stockSettings, stockText, type StockQuote } from "./stock";

describe("exchangeDate", () => {
	test("UTC epoch zero is 1970-01-01", () => {
		expect(exchangeDate(0, 0)).toBe("1970-01-01");
	});
	test("positive gmtoffset can push the stamp across midnight", () => {
		const ts = Date.UTC(2026, 7, 24, 16, 0, 0) / 1000; // 2026-08-24T16:00Z
		expect(exchangeDate(ts, 8 * 3600)).toBe("2026-08-25");
	});
});

describe("parseYahooChart", () => {
	const chart = (meta: Record<string, unknown>): string => JSON.stringify({ chart: { result: [{ meta }] } });

	test("valid meta yields a quote with the exchange-local trade date", () => {
		const q = parseYahooChart(chart({ regularMarketPrice: 25123.456, previousClose: 25000, regularMarketTime: 1_000_000_000, gmtoffset: 0 }));
		expect(q).toEqual({ price: 25123.456, prevClose: 25000, gmtoffset: 0, tradeDate: "2001-09-09" });
	});
	test("falls back to chartPreviousClose when previousClose is absent", () => {
		const q = parseYahooChart(chart({ regularMarketPrice: 100, chartPreviousClose: 99 }));
		expect(q).toEqual({ price: 100, prevClose: 99, gmtoffset: 0, tradeDate: null });
	});
	test("null on non-positive prevClose, missing meta, or bad JSON", () => {
		expect(parseYahooChart(chart({ regularMarketPrice: 100, previousClose: 0 }))).toBeNull();
		expect(parseYahooChart('{"chart":{"result":[]}}')).toBeNull();
		expect(parseYahooChart("{")).toBeNull();
	});
});

describe("stockText", () => {
	const live = (price: number, prevClose: number, gmtoffset = 0): StockQuote => ({
		price,
		prevClose,
		gmtoffset,
		tradeDate: exchangeDate(Date.now() / 1000, gmtoffset),
	});

	test("traded today, up: 📈 ▲ signed change and percent", () => {
		expect(stockText(live(25123.456, 25000))).toBe("📈 TAIEX 25,123.46 ▲ +123.46 +0.49%");
	});
	test("traded today, down: 📉 ▼ negative change and percent", () => {
		expect(stockText(live(24900, 25000))).toBe("📉 TAIEX 24,900.00 ▼ -100.00 -0.40%");
	});
	test("traded today, flat: ➖ ─ zeros", () => {
		expect(stockText(live(25000, 25000))).toBe("➖ TAIEX 25,000.00 ─ +0.00 +0.00%");
	});
	test("no trade today: 💤 and price only — the last session's move is not today's", () => {
		expect(stockText({ price: 25123.456, prevClose: 25000, gmtoffset: 0, tradeDate: "2000-01-01" })).toBe("💤 TAIEX 25,123.46");
	});
	test("null tradeDate renders as a live session", () => {
		expect(stockText({ price: 100, prevClose: 99, gmtoffset: 0, tradeDate: null })).toBe("📈 TAIEX 100.00 ▲ +1.00 +1.01%");
	});
});

describe("stockSettings", () => {
	test("no raw, no env -> ^TWII / TAIEX", () => {
		expect(stockSettings(undefined, {})).toEqual({ symbol: "^TWII", name: "TAIEX" });
	});
	test("YAML overrides both keys", () => {
		expect(stockSettings({ symbol: "^IXIC", name: "NASDAQ" }, {})).toEqual({ symbol: "^IXIC", name: "NASDAQ" });
	});
	test("env overrides YAML per key", () => {
		expect(stockSettings({ symbol: "^IXIC", name: "NASDAQ" }, { ANOTHER_STOCK_SYMBOL: "7203.T" })).toEqual({ symbol: "7203.T", name: "NASDAQ" });
	});
	test("blank env string counts as unset", () => {
		expect(stockSettings({ symbol: "^IXIC" }, { ANOTHER_STOCK_SYMBOL: " " })).toEqual({ symbol: "^IXIC", name: "^IXIC" });
	});
	test("non-object raw or bad values -> defaults", () => {
		expect(stockSettings("x", {})).toEqual(DEFAULT_STOCK);
		expect(stockSettings({ symbol: 1, name: [] }, {})).toEqual(DEFAULT_STOCK);
	});
	test("unset name falls back to the resolved symbol", () => {
		expect(stockSettings({ symbol: "7203.T" }, {})).toEqual({ symbol: "7203.T", name: "7203.T" });
		expect(stockSettings({}, { ANOTHER_STOCK_SYMBOL: "AAPL" })).toEqual({ symbol: "AAPL", name: "AAPL" });
	});
	test("env name overrides YAML name", () => {
		expect(stockSettings({ symbol: "7203.T", name: "Toyota" }, { ANOTHER_STOCK_NAME: "TM" })).toEqual({ symbol: "7203.T", name: "TM" });
	});
});

describe("applyStockSettings", () => {
	test("applied settings show in stockText; module state restored after", () => {
		try {
			applyStockSettings({ symbol: "7203.T", name: "Toyota" });
			const q: StockQuote = { price: 25123.456, prevClose: 25000, gmtoffset: 0, tradeDate: "2000-01-01" };
			expect(stockText(q)).toBe("💤 Toyota 25,123.46");
		} finally {
			applyStockSettings(DEFAULT_STOCK);
		}
	});
});
