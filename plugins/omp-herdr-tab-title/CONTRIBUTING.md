# Contributing: omp-herdr-tab-title

English | [繁體中文](CONTRIBUTING-zh-tw.md)

## Dev loop

From the repo root:

    bun install --cwd plugins/omp-herdr-tab-title
    bun test plugins/omp-herdr-tab-title
    bunx tsc --noEmit -p plugins/omp-herdr-tab-title

- `core.ts` holds the pure helpers (`abbreviateSessionName`, `herdrSpawnTarget`) and their tests; `index.ts` is the extension glue and has no tests of its own.
- Dependencies are dev-only (`package.json` has no `dependencies` key). A marketplace install is a plain directory copy, so runtime imports must stay within Node/Bun builtins and `@oh-my-pi/*`.
- `bun.lock` is tracked; CI runs `bun install --frozen-lockfile`. If `bun install` does not print "Saved lockfile" after adding a package, run it again.

## e2e smoke test

1. Register the repo as a marketplace and install: `omp plugin marketplace add <path-to-repo> && omp plugin install omp-herdr-tab-title@omp-extensions`.
2. Inside a herdr tab, run `omp` in a scratch dir, send one prompt, and wait for the turn to end. The auto title appears within ~15 s; check with `herdr tab get $HERDR_TAB_ID` that `label` equals the ≤15-column prefix of the session title, plus `…` when the title was longer.
3. Quit, run `omp --continue` in the same tab: the label is set at startup, before any prompt.
4. Outside herdr (`env -u HERDR_TAB_ID`), confirm nothing happens: no `omp-herdr-tab-title` lines in `~/.omp/logs/`.
5. Uninstall afterwards so the machine stays clean.

## Versions

Bump `version` in both `.omp-plugin/marketplace.json` and this plugin's `package.json`, keeping the two equal. CI checks parity.
