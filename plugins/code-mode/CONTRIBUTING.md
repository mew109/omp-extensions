# Contributing to code-mode

English | [繁體中文](CONTRIBUTING-zh-tw.md)

Single-file extension. User-facing docs (install, keep-set, prewalk
interaction) are in [README.md](README.md).

## Layout

- `index.ts` — the whole extension: flag, command, widget, system-prompt
  hook
- `package.json` — declares the entry: `"omp": { "extensions":
  ["./index.ts"] }`

## Source map

- `KEEP_SET` — the direct tools while the mode is on: `eval`, `ask`,
  `read`, `write`. `activate()` snapshots the previous active set first;
  `deactivate()` restores it on `off`.
- `WIDGET_KEY` — widget key `"code-mode"`; one `⌨️ Code Mode` line below
  the editor while active.
- `HINT_BLOCK` — the constant `§ Code Mode` system-prompt block. Constant
  text keeps the effective prompt stable across turns within a mode state,
  so the provider prompt cache stays warm.
- Events:
  - `session_start` — snapshots the default tool set; activates when the
    `--code-mode` flag is set.
  - `turn_start` — reapplies the keep-set defensively if something resets
    the active set mid-session.
  - `before_agent_start` — appends `HINT_BLOCK` to the system prompt while
    active.
- `registerCommand("code-mode")` — `/code-mode [on|off]`; no argument
  shows the state.

## Verification

No tests and no tsconfig (the only import, `@oh-my-pi/pi-coding-agent`,
resolves from the installed plugin cache, not from this repo — see
AGENTS.md). Verify with the install smoke test from AGENTS.md:

```bash
omp plugin marketplace add <repo path>
omp plugin install code-mode@omp-extensions
omp --code-mode        # widget: ⌨️ Code Mode
# in-session: /code-mode  (state), /code-mode off  (tools restored)
omp plugin uninstall code-mode@omp-extensions
```

## Known traps

- `ask` is not in the tool registry; `setActiveTools` silently ignores
  unregistered names, so the effective active set is `eval`, `read`,
  `write`. Measured 2026-08-20 on omp v17.3.7 (details in the README
  keep-set note). Re-test before relying on `ask` in `KEEP_SET`.
- While code mode is on, prewalk handoff never fires: tool calls inside
  the eval bridge produce no tool-result messages, and prewalk only scans
  those. A direct `write` still triggers it. Background in the README
  ("Prewalk interaction").

## Release

The version lives in two places; bump both:

- `package.json`
- `../../.omp-plugin/marketplace.json` (repo root `.omp-plugin/`)
