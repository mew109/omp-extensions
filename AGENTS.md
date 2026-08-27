# AGENTS.md

Rules for coding agents working in this repo.

## What this repo is

A personal omp plugin marketplace (`omp-extensions`). Five plugins live under `plugins/`:

- **another-statusline** (extension): statusline widget — path/git/pr merged into one segment row, plus weather and stock. TypeScript, tested with `bun test`.
- **code-mode** (extension): PTC-style code mode (tool set limited to eval/ask/read/write).
- **dump-as-curl** (extension): `/dump-as-curl [--index N] [--filename FILE] [--help]` writes a captured LLM request (in-process `globalThis.fetch` interception) as an executable curl script.
- **omp-cc-user** (skill + slash command): manages which `~/.claude` resources are visible in omp.
- **omp-segments-to-widgets** (skill): procedure for turning statusline segments into widgets.

`.omp-plugin/marketplace.json` is the marketplace manifest and the source of truth for plugin versions. The root README is the front page.

## Plugin packaging rules

- An extension plugin must declare its entry in its `package.json`: `"omp": { "extensions": ["./index.ts"] }`. Without it, the installed plugin loads nothing.
- Skills are found at `plugins/<name>/skills/<name>/SKILL.md`, slash commands at `plugins/<name>/commands/*.md`. They need no manifest entry.
- Bump a plugin's version in BOTH `.omp-plugin/marketplace.json` and that plugin's `package.json`, keeping the two equal.
- Users see a new version only after `omp plugin marketplace update omp-extensions` and `omp plugin upgrade <name>@omp-extensions`.
- `@oh-my-pi/*` imports inside plugin code resolve from the installed plugin cache (the host rewrites them), not from this repo.
- Dependencies are dev-only: a marketplace install is a plain directory copy (`fs.cp` in omp's `marketplace/cache.ts`), never a package install, and a git marketplace clone ships no `node_modules`. Runtime imports must be limited to Node/Bun builtins and `@oh-my-pi/*` (host-rewritten) — `dependencies` would never be installed, so never add that key; typecheck/test packages go in `devDependencies`. End users must never need anything beyond omp.
- Keep each plugin's `bun.lock` tracked (CI installs with `--frozen-lockfile`); `node_modules/` stays ignored — the root `.gitignore` already covers it at any depth.

## Docs

- Root README and the three doc'd plugins (another-statusline, code-mode, omp-cc-user): `README.md` / `CONTRIBUTING.md` English with a Chinese counterpart `README-zh-tw.md` / `CONTRIBUTING-zh-tw.md` (lowercase, uniform). omp-segments-to-widgets ships no README.
- Every doc with a language pair (root README included) keeps the two versions in sync — edit both in one change.
- No machine-local paths in any tracked file (docs, tsconfig, scripts — e.g. `/home/...`). Use the GitHub URL, a `<placeholder>`, or local devDependencies. For tsconfig this means resolving types via `node_modules`, never via absolute `typeRoots`/`paths`.

## Verification

- Tests: `bun test plugins/<name>`; typecheck: `bunx tsc --noEmit -p plugins/<name>` (both from repo root).
- Install smoke test: `omp plugin marketplace add <repo path>`, `omp plugin install <name>@omp-extensions`, run `omp -p "reply: ok"`, check `~/.omp/logs/` for errors — then uninstall the plugin again so the machine stays clean.

## Git

- Stage explicit paths only — never `git add -A` / `git add .`.
- Commit subject: Conventional Commits (`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` …), short, lowercase. Body states why, not what.
- Push only when asked.

## Known traps (another-statusline)

- Widget string lines render inside `Text(line, 1, 0)` (content width `columns − 2`; `tui.tight` removes it), so width math must budget `WIDGET_HPAD` and measure with the host engine (`Bun.stringWidth` per grapheme cluster).
- OSC 8 hyperlinks never emit under the current omp layout: the extension's `config/settings` instance is not the one the host initializes, so `isHyperlinkEnabled()` stays false. Measured 2026-08-22 on omp v17.4.2; documented in the README. Do not try to fix this without re-testing on a newer omp.
- `WEATHER_LOCATION`, `STOCK_INDEX`, and the other constants are personal defaults — describe them, don't change them.
- The weather "next full hour" is computed in local time while the API returns the location's timezone; when they differ, the wrong slot gets picked. Keep this in mind when touching `segments/weather.ts`.
