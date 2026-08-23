import { createPoller, type Segment } from "../core";

// Weather segment. Open-Meteo, no API key. Edit WEATHER_LOCATION for your
// city (lat/lon from any coordinate source; API is timezone-aware).
// WEATHER_LANG picks the label language: "zh" → "🌦️ 15時: 陣雨 26°C 85%",
// "en" → "🌦️ showers 26°C 85% at 15:00".

const WEATHER_LOCATION = { name: "Taipei", lat: 25.033, lon: 121.565 } as const;
const WEATHER_LANG: WeatherLang = "zh";
const WEATHER_REFRESH_MS = 30 * 60 * 1000; // refetch period (>= 10min, << 1 day)
const WEATHER_MIN_ATTEMPT_MS = 10 * 60 * 1000; // floor between HTTP attempts
const WEATHER_TIMEOUT_MS = 15 * 1000; // bad routes to Open-Meteo can spend ~5s on TLS alone

export type WeatherLang = "zh" | "en";

// WMO weather interpretation codes (Open-Meteo docs), zh / en labels.
const WEATHER_CODES: Readonly<Record<number, { icon: string; zh: string; en: string }>> = {
	0: { icon: "☀️", zh: "晴", en: "clear" },
	1: { icon: "🌤️", zh: "大致晴", en: "mostly clear" },
	2: { icon: "⛅", zh: "局部多雲", en: "partly cloudy" },
	3: { icon: "☁️", zh: "陰", en: "overcast" },
	45: { icon: "🌫️", zh: "霧", en: "fog" },
	48: { icon: "🌫️", zh: "霧", en: "fog" },
	51: { icon: "🌦️", zh: "毛雨", en: "drizzle" },
	53: { icon: "🌦️", zh: "毛雨", en: "drizzle" },
	55: { icon: "🌦️", zh: "毛雨", en: "drizzle" },
	56: { icon: "🌧️", zh: "凍毛雨", en: "freezing drizzle" },
	57: { icon: "🌧️", zh: "凍毛雨", en: "freezing drizzle" },
	61: { icon: "🌦️", zh: "小雨", en: "light rain" },
	63: { icon: "🌧️", zh: "中雨", en: "rain" },
	65: { icon: "🌧️", zh: "大雨", en: "heavy rain" },
	66: { icon: "🌧️", zh: "大雨", en: "heavy rain" },
	67: { icon: "🌧️", zh: "大雨", en: "heavy rain" },
	71: { icon: "🌨️", zh: "小雪", en: "light snow" },
	73: { icon: "🌨️", zh: "中雪", en: "snow" },
	75: { icon: "❄️", zh: "大雪", en: "heavy snow" },
	77: { icon: "🌨️", zh: "雪粒", en: "snow grains" },
	80: { icon: "🌦️", zh: "陣雨", en: "showers" },
	81: { icon: "🌦️", zh: "陣雨", en: "showers" },
	82: { icon: "🌧️", zh: "強陣雨", en: "heavy showers" },
	85: { icon: "🌨️", zh: "陣雪", en: "snow showers" },
	86: { icon: "🌨️", zh: "陣雪", en: "snow showers" },
	95: { icon: "⛈️", zh: "雷雨", en: "thunderstorm" },
	96: { icon: "⛈️", zh: "雷雨冰雹", en: "hailstorm" },
	99: { icon: "⛈️", zh: "雷雨冰雹", en: "hailstorm" },
};

export interface WeatherSlot {
	/** Full local hour slot, e.g. "2026-08-23T23:00". */
	time: string;
	temp: number;
	code: number;
	/** Precipitation probability (0-100) for this hour; null when unavailable. */
	rain: number | null;
}

/** Parse Open-Meteo /v1/forecast hourly JSON into validated slots; null when none. */
export function parseOpenMeteo(json: string): WeatherSlot[] | null {
	let o: unknown;
	try {
		o = JSON.parse(json);
	} catch {
		return null;
	}
	if (typeof o !== "object" || o === null || !("hourly" in o)) return null;
	const hourly = o.hourly;
	if (typeof hourly !== "object" || hourly === null) return null;
	const times = "time" in hourly ? hourly.time : undefined;
	const temps = "temperature_2m" in hourly ? hourly.temperature_2m : undefined;
	const codes = "weather_code" in hourly ? hourly.weather_code : undefined;
	const probs = "precipitation_probability" in hourly ? hourly.precipitation_probability : undefined;
	if (!Array.isArray(times) || !Array.isArray(temps) || !Array.isArray(codes)) return null;
	const slots: WeatherSlot[] = [];
	for (let i = 0; i < times.length; i++) {
		const time = times[i];
		const temp = temps[i];
		const code = codes[i];
		if (typeof time !== "string" || !time.includes("T")) continue;
		if (typeof temp !== "number" || !Number.isFinite(temp)) continue;
		if (typeof code !== "number" || !Number.isInteger(code) || code < 0) continue;
		slots.push({ time, temp, code, rain: Array.isArray(probs) && typeof probs[i] === "number" ? probs[i] : null });
	}
	return slots.length > 0 ? slots : null;
}

/** First slot strictly after the current hour (the next full hour), local time. */
export function pickNextSlot(slots: WeatherSlot[]): WeatherSlot | null {
	const d = new Date();
	const hh = (n: number) => String(n).padStart(2, "0");
	const currentSlot = `${d.getFullYear()}-${hh(d.getMonth() + 1)}-${hh(d.getDate())}T${hh(d.getHours())}:00`;
	return slots.find((s) => s.time > currentSlot) ?? null;
}

/** Build the weather segment text; unknown WMO code drops the weather label. */
export function weatherText(w: WeatherSlot, lang: WeatherLang = "zh"): string {
	const c = WEATHER_CODES[w.code];
	const icon = c ? c.icon : "🌡️";
	const label = c ? (lang === "zh" ? c.zh : c.en) : null;
	const hour = Number(w.time.slice(11, 13));
	const tail = [`${Math.round(w.temp)}°C`];
	if (w.rain !== null) tail.push(`${Math.round(w.rain)}%`);
	if (lang === "zh") {
		const parts = [icon, `${hour}時:`];
		if (label) parts.push(label);
		return [...parts, ...tail].join(" ");
	}
	const parts = [icon];
	if (label) parts.push(label);
	return [...parts, ...tail, `at ${hour}:00`].join(" ");
}

interface WeatherData {
	slots: WeatherSlot[];
	fetchedAt: number;
}

const poller = createPoller<WeatherData>({
	label: `weather fetch failed (${WEATHER_LOCATION.name})`,
	refreshMs: WEATHER_REFRESH_MS,
	minAttemptMs: WEATHER_MIN_ATTEMPT_MS,
	async fetch() {
		const url = `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_LOCATION.lat}&longitude=${WEATHER_LOCATION.lon}&hourly=temperature_2m,weather_code,precipitation_probability&forecast_days=2&timezone=auto`;
		const res = await fetch(url, { signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS) });
		if (!res.ok) return null;
		const slots = parseOpenMeteo(await res.text());
		return slots ? { slots, fetchedAt: Date.now() } : null;
	},
});

export const weatherSegment: Segment = {
	id: "weather",
	max: 39,
	min: 20,
	render() {
		poller.maybeFetch();
		const slots = poller.data()?.slots ?? null;
		const slot = slots ? pickNextSlot(slots) : null;
		return slot ? { text: weatherText(slot, WEATHER_LANG) } : null;
	},
	start(rerender) {
		poller.start(rerender);
	},
};
