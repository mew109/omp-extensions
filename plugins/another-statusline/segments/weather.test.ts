import { describe, expect, test } from "bun:test";
import { parseOpenMeteo, pickNextSlot, weatherText, type WeatherSlot } from "./weather";

const hourly = (times: unknown[], temps: unknown[], codes: unknown[], probs?: unknown[]): string =>
	JSON.stringify({ hourly: { time: times, temperature_2m: temps, weather_code: codes, ...(probs ? { precipitation_probability: probs } : {}) } });

describe("parseOpenMeteo", () => {
	test("validates slots and maps rain probability", () => {
		const slots = parseOpenMeteo(hourly(["2026-08-24T15:00", "2026-08-24T16:00"], [26.4, 27], [80, 2], [85, 40]));
		expect(slots).toEqual([
			{ time: "2026-08-24T15:00", temp: 26.4, code: 80, rain: 85 },
			{ time: "2026-08-24T16:00", temp: 27, code: 2, rain: 40 },
		]);
	});
	test("rain is null when the API has no probability data", () => {
		const slots = parseOpenMeteo(hourly(["2026-08-24T15:00"], [26], [80]));
		expect(slots?.[0].rain).toBeNull();
	});
	test("skips slots with bad time, temp or code, keeps valid ones", () => {
		const slots = parseOpenMeteo(hourly(["not-a-slot", "2026-08-24T15:00", "2026-08-24T16:00"], ["x", 26, Number.NaN], [1, 80, -3]));
		// Slot 0 has no "T"; slot 2 has NaN temp and a negative code; only slot 1 survives.
		expect(slots).toEqual([{ time: "2026-08-24T15:00", temp: 26, code: 80, rain: null }]);
	});
	test("null on bad JSON, missing hourly, or no valid slots", () => {
		expect(parseOpenMeteo("{")).toBeNull();
		expect(parseOpenMeteo("{}")).toBeNull();
		expect(parseOpenMeteo(hourly([], [], []))).toBeNull();
	});
});

describe("pickNextSlot", () => {
	test("returns the first slot strictly after the current hour", () => {
		const hh = (n: number) => String(n).padStart(2, "0");
		const d = new Date();
		const stamp = (dt: Date) => `${dt.getFullYear()}-${hh(dt.getMonth() + 1)}-${hh(dt.getDate())}T${hh(dt.getHours())}:00`;
		const current: WeatherSlot = { time: stamp(d), temp: 20, code: 0, rain: null };
		const next: WeatherSlot = { time: stamp(new Date(d.getTime() + 3600_000)), temp: 21, code: 1, rain: null };
		expect(pickNextSlot([current, next])?.time).toBe(next.time);
	});
	test("null when every slot is in the past", () => {
		expect(pickNextSlot([{ time: "2000-01-01T00:00", temp: 20, code: 0, rain: null }])).toBeNull();
	});
});

describe("weatherText", () => {
	test("zh (default): icon, hour, label, temp, rain", () => {
		expect(weatherText({ time: "2026-08-24T15:00", temp: 26.4, code: 80, rain: 85 })).toBe("🌦️ 15時: 陣雨 26°C 85%");
	});
	test("en: label then values, hour moves to the tail", () => {
		expect(weatherText({ time: "2026-08-24T15:00", temp: 26.4, code: 80, rain: 85 }, "en")).toBe("🌦️ showers 26°C 85% at 15:00");
	});
	test("en single-digit hour is not zero-padded", () => {
		expect(weatherText({ time: "2026-08-24T03:00", temp: 18, code: 2, rain: null }, "en")).toBe("⛅ partly cloudy 18°C at 3:00");
	});
	test("unknown WMO code drops the label in both languages", () => {
		expect(weatherText({ time: "2026-08-24T15:00", temp: 12, code: 42, rain: 10 })).toBe("🌡️ 15時: 12°C 10%");
		expect(weatherText({ time: "2026-08-24T15:00", temp: 12, code: 42, rain: 10 }, "en")).toBe("🌡️ 12°C 10% at 15:00");
	});
	test("null rain omits the percentage", () => {
		expect(weatherText({ time: "2026-08-24T15:00", temp: 26, code: 80, rain: null })).toBe("🌦️ 15時: 陣雨 26°C");
	});
});
