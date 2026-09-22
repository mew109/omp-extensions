import { describe, expect, test } from "bun:test";
import { fileHyperlink, initHyperlinks, urlHyperlink } from "./hyperlinks";

describe("initHyperlinks", () => {
	test("delegates to the first module exposing both helpers", async () => {
		await initHyperlinks(async () => ({
			fileHyperlink: (p: string, t: string) => `F[${p}]${t}`,
			urlHyperlink: (u: string, t: string) => `U[${u}]${t}`,
		}));
		expect(fileHyperlink("a", "b")).toBe("F[a]b");
		expect(urlHyperlink("u", "b")).toBe("U[u]b");
	});

	test("falls back to plain text when every loader throws", async () => {
		await initHyperlinks(async () => {
			throw new Error("unresolvable");
		});
		expect(fileHyperlink("a", "b")).toBe("b");
		expect(urlHyperlink("u", "b")).toBe("b");
	});

	test("skips a candidate lacking the exports and moves down the chain", async () => {
		const fake = {
			fileHyperlink: (p: string, t: string) => `F[${p}]${t}`,
			urlHyperlink: (u: string, t: string) => `U[${u}]${t}`,
		};
		await initHyperlinks(async (spec: string) => {
			if (spec === "./hyperlink-render.ts") throw new Error("no ./render on this omp");
			return fake;
		});
		expect(fileHyperlink("a", "b")).toBe("F[a]b");
		expect(urlHyperlink("u", "b")).toBe("U[u]b");
	});
});
