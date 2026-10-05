# Contributing to omp-collab-notify

English | [繁體中文](CONTRIBUTING-zh-tw.md)

User-facing docs (config, bot setup, behavior) are in [README.md](README.md).

## Layout

- `index.ts` — the omp glue: `/collab` spec wrapper, loss poll, rehost loop
- `core.ts` — pure logic, no omp imports: config parsing, message
  building, Telegram send
- `core.test.ts` — `bun test` unit tests over `core.ts`
- `keepalive.ts` — the `/collab-keepalive` command line: collab link
  parsing, wire framing, detached ping daemon
- `keepalive.test.ts` — `bun test` unit tests over the protocol lib
- `package.json` — declares the entry: `"omp": { "extensions":
  ["./index.ts"] }`

## Verification

```bash
bun install                        # in plugins/omp-collab-notify
bun test plugins/omp-collab-notify # from repo root
bunx tsc --noEmit -p plugins/omp-collab-notify
# keepalive live e2e (needs a real room link)
bun plugins/omp-collab-notify/keepalive.ts start '<link>'    # expect "joined room …" within 10 s
sleep 130 && grep -c ' ping$' /tmp/omp-collab-keepalive-<roomId>.log  # ≥ 2
bun plugins/omp-collab-notify/keepalive.ts stop '<link>'
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
- `keepalive.ts` ports omp's collab wire protocol from the 18.4.9
  binary (proto 3, AES-GCM 12-byte IV, 4-byte big-endian peerId
  envelope, `/r/<roomId>?role=guest`). If joins fail with a
  `protocol mismatch` host error, re-extract the constants from the
  current omp binary.

## Release

The version lives in two places; bump both:

- `package.json`
- `../../.omp-plugin/marketplace.json` (repo root `.omp-plugin/`)
