import os from "node:os";
import path from "node:path";

import type { Segment } from "../core";

// Path segment. Mirrors the built-in mpi renderer: scratch roots collapse to
// the trailing relative path with a scratch icon, work prefixes strip, home
// abbreviates to ~. Environment-dependent (tmpdir, HOME) — untested.

const ABBREVIATE = true;
const STRIP_WORK_PREFIX = true;
const FOLDER_ICON = "▸";
const SCRATCH_FOLDER_ICON = "○";

function scratchRoots(): string[] {
	const roots = [os.tmpdir(), path.join(os.homedir(), "tmp")];
	if (process.platform === "win32") {
		const { TEMP, TMP, SystemRoot } = process.env;
		if (TEMP) roots.push(TEMP);
		if (TMP) roots.push(TMP);
		if (SystemRoot) roots.push(path.join(SystemRoot, "Temp"));
	}
	return roots;
}

/** True when `candidate` equals or is strictly inside `prefix` (path-relative check). */
function insideOrEqual(prefix: string, candidate: string): boolean {
	if (!prefix) return false;
	const rel = path.relative(prefix, candidate);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Path policy only (no truncation — the allocator caps the width). */
function renderPath(cwd: string): { scratch: boolean; text: string } {
	let text = cwd;
	let scratch = false;

	if (STRIP_WORK_PREFIX) {
		for (const root of scratchRoots()) {
			if (insideOrEqual(root, cwd)) {
				scratch = true;
				const rel = path.relative(root, cwd);
				if (rel) text = rel;
				break;
			}
		}
		if (!scratch) {
			for (const prefix of [path.join(os.homedir(), "Projects"), "/work"]) {
				if (insideOrEqual(prefix, cwd)) {
					const rel = path.relative(prefix, cwd);
					if (rel) text = rel;
					break;
				}
			}
		}
	}

	if (ABBREVIATE) {
		const home = os.homedir();
		if (text.startsWith(home)) {
			const rest = text.slice(home.length);
			if (rest === "" || rest.startsWith(path.sep)) text = `~${rest}`;
		}
	}

	return { scratch, text };
}

export const pathSegment: Segment = {
	id: "path",
	max: 40,
	min: 24,
	keep: "tail",
	render(ctx) {
		const p = renderPath(ctx.cwd);
		const icon = p.scratch ? (ctx.theme.icon?.scratchFolder ?? SCRATCH_FOLDER_ICON) : (ctx.theme.icon?.folder ?? FOLDER_ICON);
		return { text: `${icon} ${p.text}`, href: { kind: "file", target: ctx.cwd } };
	},
};
