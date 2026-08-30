import { run } from "../core";
import type { IconHolder, Segment } from "../index";

// Git segment. Mirrors the built-in cpi renderer:
// `git status --porcelain=v1 --branch` -> "<branch-icon> <branch> *N +N ?N".

const BRANCH_ICON = "⑂";

export interface GitStatus {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
}

/** Parse `git status --porcelain=v1 --branch` output; null = nothing to show. */
export function parseGitStatus(porcelain: string): GitStatus | null {
	let branch: string | null = null;
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of porcelain.split("\n")) {
		if (line.startsWith("## ")) {
			let b = line.slice(3).split("...")[0];
			// unborn branch emits "## No commits yet on <name>" — keep the name
			if (b.startsWith("No commits yet on ")) b = b.slice("No commits yet on ".length);
			// detached HEAD emits "## HEAD (no branch)" — no branch to show
			if (b.endsWith(" (no branch)")) b = b.slice(0, -" (no branch)".length);
			branch = b === "" || b === "HEAD" ? null : b;
			continue;
		}
		if (line.length < 2) continue;
		const x = line[0];
		const y = line[1];
		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x !== " ") staged++;
		if (y !== " ") unstaged++;
	}
	if (branch === null && staged + unstaged + untracked === 0) return null;
	return { branch, staged, unstaged, untracked };
}

/** Build the git segment text (mirrors the built-in cpi renderer). */
export function gitText(g: GitStatus, theme: IconHolder): string | null {
	let r = "";
	if (g.branch) r = `${theme.icon?.branch ?? BRANCH_ICON} ${g.branch}`;
	const parts: string[] = [];
	if (g.unstaged > 0) parts.push(`*${g.unstaged}`);
	if (g.staged > 0) parts.push(`+${g.staged}`);
	if (g.untracked > 0) parts.push(`?${g.untracked}`);
	if (parts.length > 0) {
		const u = parts.join(" ");
		r += r ? ` ${u}` : u;
	}
	return r === "" ? null : r;
}

export const gitSegment: Segment = {
	id: "git",
	max: 36,
	min: 20,
	async render(ctx) {
		const out = await run("git", ["status", "--porcelain=v1", "--branch"], ctx.cwd);
		const g = out === null ? null : parseGitStatus(out);
		if (g === null) return null;
		const text = gitText(g, ctx.theme);
		return text === null ? null : { text };
	},
};
