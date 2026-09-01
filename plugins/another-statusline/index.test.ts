import { describe, expect, test } from "bun:test";
import { parseLoaderConfig, resolveBounds, resolveSegments, surfaceSettings, type Segment } from "./index";

const seg = (id: string): Segment => ({ id, max: 30, min: 8, render: () => null });
const all = ["path", "git", "pr"].map(seg);

describe("parseLoaderConfig", () => {
	test("keeps a valid segments list and segment options", () => {
		const cfg = parseLoaderConfig({ segments: ["path", "git"], segmentOptions: { git: { max: 20, min: 5 } } });
		expect(cfg).toEqual({ segments: ["path", "git"], segmentOptions: { git: { max: 20, min: 5 } } });
	});
	test("non-string segments array is dropped", () => {
		expect(parseLoaderConfig({ segments: ["path", 3] })).toEqual({});
	});
	test("non-positive-integer option fields are dropped", () => {
		const cfg = parseLoaderConfig({ segmentOptions: { git: { max: 2.5, min: -1 }, path: { max: 20 } } });
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

describe("surfaceSettings", () => {
	test("no YAML, no env -> status", () => {
		expect(surfaceSettings(undefined, {})).toBe("status");
	});
	test("YAML surface alone is honored", () => {
		expect(surfaceSettings("widget", {})).toBe("widget");
	});
	test("env overrides YAML", () => {
		expect(surfaceSettings("widget", { ANOTHER_SURFACE: "status" })).toBe("status");
	});
	test("blank env counts as unset", () => {
		expect(surfaceSettings("widget", { ANOTHER_SURFACE: "  " })).toBe("widget");
	});
	test("matches case-insensitively after trimming", () => {
		expect(surfaceSettings(undefined, { ANOTHER_SURFACE: " Widget " })).toBe("widget");
	});
	test("unknown value falls back to the default", () => {
		expect(surfaceSettings("sidebar", {})).toBe("status");
	});
	test("non-string YAML value falls back to the default", () => {
		expect(surfaceSettings(42, {})).toBe("status");
	});
});
