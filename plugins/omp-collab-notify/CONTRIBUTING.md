# Contributing to omp-collab-notify

English | [繁體中文](CONTRIBUTING-zh-tw.md)

User-facing docs (config, bot setup, behavior) are in [README.md](README.md).

## Layout

- `index.ts` — the omp glue: `/collab` spec wrapper, loss poll, rehost loop
- `core.ts` — pure logic, no omp imports: config parsing, message
  building, Telegram send
- `core.test.ts` — `bun test` unit tests over `core.ts`
- `package.json` — declares the entry: `"omp": { "extensions":
  ["./index.ts"] }`

## Verification

```bash
bun install                        # in plugins/omp-collab-notify
bun test plugins/omp-collab-notify # from repo root
bunx tsc --noEmit -p plugins/omp-collab-notify
```

Then the install smoke test from AGENTS.md:

```bash
omp plugin marketplace add <repo path>
omp plugin install omp-collab-notify@omp-extensions
# in-session: /collab — check the Telegram message and ~/.omp agent dir logs
omp plugin uninstall omp-collab-notify@omp-extensions
```

## Known traps

- The plugin patches the shared `/collab` spec object from
  `BUILTIN_COLLABORATION_SLASH_COMMANDS`; a guard (`WeakSet`) keeps
  `/reload-plugins` from wrapping twice.
- Telegram `sendMessage` results (and errors) are appended to
  `/tmp/omp-collab-notify-errors.log` — bot-sent messages are invisible
  to `getUpdates`, so this log is the delivery record.
- The rehost path always opens a writable room, even if the lost room
  was view-only.

## Release

The version lives in two places; bump both:

- `package.json`
- `../../.omp-plugin/marketplace.json` (repo root `.omp-plugin/`)
