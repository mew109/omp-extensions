import { createPoller, type Segment } from "../core";

// Stock segment. Yahoo Finance chart API, no key. Edit STOCK_INDEX for your
// index: symbol is the Yahoo ticker (finance.yahoo.com URL), name is the
// label shown in the widget.

const STOCK_INDEX = { symbol: "^TWII", name: "TAIEX" } as const;
const STOCK_REFRESH_MS = 5 * 60 * 1000; // refetch period
const STOCK_MIN_ATTEMPT_MS = 60 * 1000; // floor between HTTP attempts
const STOCK_TIMEOUT_MS = 10 * 1000; // generous for slow routes

export interface StockQuote {
	price: number;
	prevClose: number;
	/** Exchange gmtoffset in seconds (meta.gmtoffset). */
	gmtoffset: number;
	/** Exchange-local YYYY-MM-DD of the last trade; null when unknown. */
	tradeDate: string | null;
}

/** Exchange-local calendar date (YYYY-MM-DD) of a UTC epoch-seconds stamp. */
export function exchangeDate(tsSec: number, gmtoffsetSec: number): string {
	return new Date((tsSec + gmtoffsetSec) * 1000).toISOString().slice(0, 10);
}

/** Parse Yahoo /v8/finance/chart meta into a quote; null when unusable. */
export function parseYahooChart(json: string): StockQuote | null {
	let o: unknown;
	try {
		o = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof o !== "object" || o === null || !("chart" in o)) return null;
	const chart = o.chart;
	if (typeof chart !== "object" || chart === null || !("result" in chart)) return null;
	const result = chart.result;
	if (!Array.isArray(result) || result.length === 0) return null;
	const first = result[0];
	if (typeof first !== "object" || first === null || !("meta" in first)) return null;
	const meta = first.meta;
	if (typeof meta !== "object" || meta === null) return null;
	const price = "regularMarketPrice" in meta ? meta.regularMarketPrice : undefined;
	const prev =
		"previousClose" in meta && typeof meta.previousClose === "number"
			? meta.previousClose
			: "chartPreviousClose" in meta
				? meta.chartPreviousClose
				: undefined;
	const rmt = "regularMarketTime" in meta ? meta.regularMarketTime : undefined;
	const off = "gmtoffset" in meta ? meta.gmtoffset : undefined;
	if (typeof price !== "number" || !Number.isFinite(price)) return null;
	if (typeof prev !== "number" || !Number.isFinite(prev) || prev <= 0) return null;
	return {
		price,
		prevClose: prev,
		gmtoffset: typeof off === "number" && Number.isFinite(off) ? off : 0,
		tradeDate: typeof rmt === "number" && Number.isFinite(rmt) && typeof off === "number" && Number.isFinite(off) ? exchangeDate(rmt, off) : null,
	};
}

const STOCK_NUM = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Build the stock segment text: emoji, name, price, arrow, change, pct. */
export function stockText(q: StockQuote): string {
	// No trade today (weekend / holiday / pre-open, exchange timezone):
	// the last session's move is not today's, so only the price shows.
	if (q.tradeDate !== null && q.tradeDate !== exchangeDate(Date.now() / 1000, q.gmtoffset)) {
		return ["💤", STOCK_INDEX.name, STOCK_NUM.format(q.price)].join(" ");
	}
	const chg = q.price - q.prevClose;
	const pct = (chg / q.prevClose) * 100;
	const signed = (n: number) => (n >= 0 ? "+" : "") + STOCK_NUM.format(n);
	const [emoji, dir] = chg > 0 ? ["📈", "▲"] : chg < 0 ? ["📉", "▼"] : ["➖", "─"];
	return [emoji, STOCK_INDEX.name, STOCK_NUM.format(q.price), dir, signed(chg), `${signed(pct)}%`].join(" ");
}

interface StockData {
	quote: StockQuote;
	fetchedAt: number;
}

const poller = createPoller<StockData>({
	label: `stock fetch failed (${STOCK_INDEX.symbol})`,
	refreshMs: STOCK_REFRESH_MS,
	minAttemptMs: STOCK_MIN_ATTEMPT_MS,
	async fetch() {
		const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(STOCK_INDEX.symbol)}?range=1d&interval=1d`;
		// Browser UA: Yahoo intermittently rejects bare non-browser clients.
		const res = await fetch(url, { signal: AbortSignal.timeout(STOCK_TIMEOUT_MS), headers: { "user-agent": "Mozilla/5.0" } });
		if (!res.ok) return null;
		const quote = parseYahooChart(await res.text());
		return quote ? { quote, fetchedAt: Date.now() } : null;
	},
});

export const stockSegment: Segment = {
	id: "stock",
	max: 38,
	min: 20,
	render() {
		poller.maybeFetch();
		const data = poller.data();
		return data ? { text: stockText(data.quote), href: { kind: "url", target: `https://finance.yahoo.com/quote/${encodeURIComponent(STOCK_INDEX.symbol)}` } } : null;
	},
	start(rerender) {
		poller.start(rerender);
	},
};
