import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pluginDir = import.meta.dir;
const scriptPath = join(
  pluginDir,
  "skills",
  "omp-cc-user",
  "scripts",
  "omp_cc_user.py",
);

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(path));
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

const docs = markdownFiles(pluginDir);

// External programs never see omp's virtual skill:// paths, so no tracked
// document may hand a bare skill:// URI to an interpreter. The supported
// form resolves the skill directory with realpath first.
const antiPattern = /python\d?\s+["']?skill:\/\//;

test("no document passes skill:// directly to an external interpreter", () => {
  const offenders = docs.filter((f) => antiPattern.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});

test("documents invoking the script resolve it through realpath of the skill URI", () => {
  const invokers = docs.filter((f) => {
    const t = readFileSync(f, "utf8");
    return t.includes("omp_cc_user.py") && t.includes("skill://");
  });
  expect(invokers.length).toBeGreaterThan(0);
  for (const f of invokers) {
    expect(readFileSync(f, "utf8")).toContain(
      "$(realpath skill://omp-cc-user)/scripts/omp_cc_user.py",
    );
  }
});

// The script needs PyYAML at import time and Windows runners name the
// interpreter differently; only exercise it where both are available.
const yamlAvailable =
  process.platform !== "win32" &&
  Bun.spawnSync(["python3", "-c", "import yaml"]).exitCode === 0;
const spawnTest = yamlAvailable ? test : test.skip;

spawnTest("script entrypoint prints usage on stdout", () => {
  const proc = Bun.spawnSync(["python3", scriptPath, "--help"]);
  // unknown args intentionally exit nonzero after printing the usage table
  expect(new TextDecoder().decode(proc.stdout)).toContain(
    "usage: omp_cc_user.py",
  );
  expect(new TextDecoder().decode(proc.stderr)).not.toContain("Traceback");
});
