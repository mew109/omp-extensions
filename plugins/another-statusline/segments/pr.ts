import { run } from "../core";
import type { Segment } from "../index";

// PR segment: `gh pr view --json number,url` -> "<pr-icon> #<number>",
// hyperlinked to the PR. Mirrors the built-in dpi renderer.

const PR_ICON = "⤴";

/** Parse `gh pr view --json number,url` output; null = no PR / any failure. */
export function parsePr(json: string): { number: number; url: string } | null {
	try {
		const o = JSON.parse(json) as { number?: unknown; url?: unknown };
		if (typeof o.number === "number" && Number.isInteger(o.number) && typeof o.url === "string" && o.url !== "") {
			return { number: o.number, url: o.url };
		}
		return null;
	} catch {
		return null;
	}
}

export const prSegment: Segment = {
	id: "pr",
	max: 30,
	min: 10,
	async render(ctx) {
		const out = await run("gh", ["pr", "view", "--json", "number,url"], ctx.cwd);
		const pr = out === null ? null : parsePr(out);
		return pr ? { text: `${ctx.theme.icon?.pr ?? PR_ICON} #${pr.number}`, href: { kind: "url", target: pr.url } } : null;
	},
};
