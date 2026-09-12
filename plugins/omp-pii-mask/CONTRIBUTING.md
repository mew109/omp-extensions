# Contributing to omp-pii-mask

English | [繁體中文](CONTRIBUTING-zh-tw.md)

Two source files. User-facing docs (install, patterns, settings,
limitations) are in [README.md](README.md).

## Layout

- `index.ts` — the omp glue: config loading, hook registration, the
  `/pii-map` command, output
- `core.ts` — pure logic, no omp imports: pattern list, mask/unmask
  engine, message transformers, settings parsing
- `core.test.ts` — `bun test` unit tests over `core.ts`
- `package.json` — declares the entry: `"omp": { "extensions":
  ["./index.ts"] }`

## Constants

| Name | Meaning |
|---|---|
| `PII_MASK_PHONE` | env override for phone-number masking |
| `CONFIG_PATH` | `$PI_CODING_AGENT_DIR/pii-mask.yml` |
| `PII_NOTICE` | system-prompt notice appended by `before_agent_start` |
| `ENV_PHONE` | core-side name of the `PII_MASK_PHONE` env key |
| `DEFAULT_SETTINGS` | `{ phone: false }` — the built-in fallback |

Settings precedence: env `PII_MASK_PHONE` > YAML `phone` > `false`.
Settings are read once per process at extension load; there is no reload
or error-log surface (missing/invalid config silently means defaults).

## Hook flow

- `context` → `maskMessages` (core) → `{ messages }`
- `tool_call` → `unmaskInPlace` on `event.input`
- `before_agent_start` → append `<!-- pi-pii-mask -->` + `PII_NOTICE` to
  the `systemPrompt` block array (skipped when the marker is present)
- `message_end` → in-place unmask of assistant text/thinking blocks
  (notification-only event on omp)
- `/pii-map` → `formatMap(redactor.entries())`, via `report()`:
  `ctx.ui.notify` in the TUI, stdout when headless

## Upstream sync

Upstream is a single file
([pi-pii-mask `index.ts`](https://github.com/TheRealStubbornDeveloper/pi-pii-mask/blob/main/index.ts));
our split is core (engine) / glue (hooks). Port upstream changes into
`core.ts` and keep the hook bodies in `index.ts` thin.

## Verification

```bash
bun install                      # in plugins/omp-pii-mask
bun test plugins/omp-pii-mask    # from repo root
bunx tsc --noEmit -p plugins/omp-pii-mask
```

Then the install smoke test from AGENTS.md:

```bash
omp plugin marketplace add <path-to-repo>
omp plugin install omp-pii-mask@omp-extensions
omp -p "reply: ok"    # check ~/.omp/logs/ for load errors
omp plugin uninstall omp-pii-mask@omp-extensions
```
