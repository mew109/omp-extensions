# Contributing to dump-as-curl

English | [繁體中文](CONTRIBUTING-zh-tw.md)

Two source files. User-facing docs (install, flags, limitations) are in
[README.md](README.md).

## Layout

- `index.ts` — the omp glue: fetch wrapper, command registration, output
- `core.ts` — pure logic, no omp imports: arg parsing, endpoint
  heuristic, capture, curl rendering
- `core.test.ts` — `bun test` unit tests over `core.ts`
- `package.json` — declares the entry: `"omp": { "extensions":
  ["./index.ts"] }`

## Source map

- Capture: `installCapture()` (index.ts) wraps `globalThis.fetch` once
  per process, guarded by `Symbol.for("omp.dump-as-curl")` on
  `globalThis`. A POST whose URL matches `isLlmEndpoint` becomes a
  `Capture` (`makeCapture`) and lands in an 8-slot ring (`pushCapture`).
- Command: `/dump-as-curl` (`registerCommand`) parses args (`parseArgs`),
  picks a capture (`pickCapture`, 1 = newest), renders the script
  (`renderCurlScript`) and writes it (`resolveOutPath` → `Bun.write` →
  `chmodSync` 0700).
- Output: `ctx.ui.notify` in the TUI (same surface `/dump` uses);
  `process.stdout` when `hasUI` is false.

## Verification

```bash
bun install                      # in plugins/dump-as-curl
bun test plugins/dump-as-curl    # from repo root
bunx tsc@7.0.2 --noEmit -p plugins/dump-as-curl
```

Then the install smoke test from AGENTS.md:

```bash
omp plugin marketplace add <repo path>
omp plugin install dump-as-curl@omp-extensions
# in-session: send a message, then /dump-as-curl; sh <file> replays it
omp plugin uninstall dump-as-curl@omp-extensions
```

## Known traps

- `Bun.chmod` does not exist at runtime (probed on Bun 1.3.14); the
  plugin uses `fs.chmodSync`.
- The fetch wrapper must delegate `fetch.preconnect` — the omp types
  require it on `typeof fetch`.
- The endpoint heuristic is a URL-path check, not provider detection;
  the patterns are chosen so unrelated POSTs do not collide.

## Release

The version lives in two places; bump both:

- `package.json`
- `../../.omp-plugin/marketplace.json` (repo root `.omp-plugin/`)
