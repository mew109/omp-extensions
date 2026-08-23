import { describe, expect, test } from "bun:test";
import { gitText, parseGitStatus } from "./git";

describe("parseGitStatus", () => {
	test("counts staged, unstaged and untracked; reads the branch", () => {
		const porcelain = "## main...origin/main\n M a.ts\nM  b.ts\n?? c\n?? d";
		expect(parseGitStatus(porcelain)).toEqual({ branch: "main", staged: 1, unstaged: 1, untracked: 2 });
	});
	test("empty output means nothing to show", () => {
		expect(parseGitStatus("")).toBeNull();
	});
	test("branch line alone is enough to render", () => {
		expect(parseGitStatus("## main...origin/main")).toEqual({ branch: "main", staged: 0, unstaged: 0, untracked: 0 });
	});
	test("detached HEAD has no branch to show", () => {
		expect(parseGitStatus("## HEAD (no branch)\n M x")).toEqual({ branch: null, staged: 0, unstaged: 1, untracked: 0 });
	});
	test("unborn branch keeps its name", () => {
		expect(parseGitStatus("## No commits yet on main")).toEqual({ branch: "main", staged: 0, unstaged: 0, untracked: 0 });
	});
});

describe("gitText", () => {
	test("branch icon, branch, then counts in unstaged/staged/untracked order", () => {
		expect(gitText({ branch: "main", staged: 1, unstaged: 2, untracked: 3 }, {})).toBe("⑂ main *2 +1 ?3");
	});
	test("zero counts are omitted", () => {
		expect(gitText({ branch: "main", staged: 0, unstaged: 0, untracked: 0 }, {})).toBe("⑂ main");
	});
	test("no branch leaves bare counts", () => {
		expect(gitText({ branch: null, staged: 0, unstaged: 2, untracked: 0 }, {})).toBe("*2");
	});
	test("empty status hides the segment", () => {
		expect(gitText({ branch: null, staged: 0, unstaged: 0, untracked: 0 }, {})).toBeNull();
	});
	test("theme branch icon wins over the fallback", () => {
		expect(gitText({ branch: "main", staged: 0, unstaged: 0, untracked: 0 }, { icon: { branch: "⎇" } })).toBe("⎇ main");
	});
});
