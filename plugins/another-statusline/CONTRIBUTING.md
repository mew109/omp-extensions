# another-statusline development

English | [繁體中文](CONTRIBUTING-zh-tw.md)

For maintainers and anyone changing the code: file layout, how to add a segment, source constants, tests, and redraw triggers. User-facing docs (install, display, configuration) are in [README.md](README.md).

## File layout

    index.ts            registry (SEGMENTS) + assembly (width allocation, truncation, hyperlink, OSC 8) + extension entry
    core.ts             Segment contract, width math (displayWidth / truncate*), allocator (allocate),
                        command runner (run), background poller (createPoller)
    core.test.ts        width / truncation / allocator tests
    segments/
      path.ts           path segment (rewritten from the built-in mpi renderer; environment-dependent: tmpdir, HOME — the only segment without tests)
      git.ts            git segment (rewritten from the built-in cpi renderer) + git.test.ts
      pr.ts             PR segment (rewritten from the built-in dpi renderer) + pr.test.ts
      weather.ts        weather segment + weather.test.ts
      stock.ts          stock segment + stock.test.ts

## Adding a segment

1. Create `segments/<id>.ts` exporting a `Segment` (defined in `core.ts`): `{ id, max, min, keep?, render(ctx), start?(rerender) }`.
   - `keep?`: truncation side — `"head"` (default, keeps the left part) or `"tail"` (keeps the right part; path uses it).
   - `render` returns `{ text, href? }`; return `null` to hide the segment. For background polling use `createPoller` (weather / stock are the templates).
2. In `index.ts`, add the import and put it in the `SEGMENTS` array — two lines.

`SEGMENTS` is the built-in default registry; user-side order and visibility are controlled by the config file (see "Configuration" in the README), so no source change is needed.

## Constants (by file)

| Constant | Location | Default | Purpose |
|---|---|---|---|
| `SEGMENTS` | index.ts | five-segment array | built-in default registry (the user side overrides order and widths via `another-statusline.yml`; see "Configuration" in the README) |
| `SEPARATOR` | index.ts | two spaces | divider between segments |
| `ERROR_LOG` | core.ts | `/tmp/another-statusline-errors.log` | error log location |
| `WEATHER_LOCATION` | segments/weather.ts | `{ name: "Taipei", lat: 25.033, lon: 121.565 }` | weather city; put your own city's lat/lon. Note: the "next full hour" is computed in local time while the API returns the location's timezone (`timezone=auto`); when the two differ, the wrong slot gets picked |
| `WEATHER_LANG` | segments/weather.ts | `"zh"` | weather label language: `"zh"` → `🌦️ 15時: 陣雨 26°C 85%`; `"en"` → `🌦️ showers 26°C 85% at 15:00` |
| `WEATHER_REFRESH_MS` | segments/weather.ts | 30 min | weather refetch interval |
| `WEATHER_MIN_ATTEMPT_MS` | segments/weather.ts | 10 min | minimum spacing between HTTP attempts |
| `WEATHER_TIMEOUT_MS` | segments/weather.ts | 15 s | single fetch timeout (the TLS handshake alone can exceed 5 s on slow routes) |
| `STOCK_INDEX` | segments/stock.ts | `{ symbol: "^TWII", name: "TAIEX" }` | stock index; `symbol` is the Yahoo ticker, `name` the display name |
| `STOCK_REFRESH_MS` | segments/stock.ts | 5 min | quote refetch interval |
| `STOCK_MIN_ATTEMPT_MS` | segments/stock.ts | 60 s | minimum spacing between HTTP attempts |
| `STOCK_TIMEOUT_MS` | segments/stock.ts | 10 s | single fetch timeout |
| `ABBREVIATE` / `STRIP_WORK_PREFIX` / icon constants | segments/path.ts etc. | see source | icon fallbacks; the theme's `theme.icon.*` wins when present |

git / gh queries time out at 5000 ms by default (the `timeoutMs` argument of `run`).

## Tests

    bun test plugins/another-statusline

All pure logic is tested: core (width / truncation / allocator) plus the parsers and text generators of weather / git / pr / stock. The path segment depends on `os.tmpdir()`, HOME, and similar environment state, so it is not tested; the fetch / timer layers are not tested either (covered by integration smoke outside `bun test`). Test files stay out of tsc (no bun types globally); bun test covers them by actually running. Typecheck: `bunx tsc --noEmit -p plugins/another-statusline`.

## Redraw triggers

Event-driven: `session_start` / `session_switch` / `turn_end` each trigger one redraw (cwd and repo state change inside OMP anyway; the events suffice). weather / stock each run their own unref'd timer (refresh interval) that refetches only its own data; a rerender redraws the whole line only when new data lands (git / pr update with it) — timers never needlessly rerun git / gh. Fetches never block rendering: the widget draws first (a segment stays hidden while its cache is empty) and redraws the moment data arrives. Every redraw picks the "next full hour" from the cached slots (weather holds about 48 hours), so the boundary rolls over on its own and past slots never show. A failed fetch keeps the old data (the segment hides if there is none); errors only append to `ERROR_LOG`, with no notification.

## Built-in behavior not replicated

Extensions cannot reach status-line-specific context, so these are not implemented: the worktree label, and activeRepo's `relativeRepoRoot` suffix.
