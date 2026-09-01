# another-statusline extension

English | [繁體中文](README-zh-tw.md)

Merges the built-in `path`, `git`, and `pr` statusline segments into one line (plus an Open-Meteo weather segment and a Yahoo stock segment). The render surface is configurable: `status` (default) renders below the built-in status bar, `widget` below the editor. The first three are **rewritten from the omp built-in renderers** (path = mpi, git = cpi, pr = dpi; format and truncation verified in 2026-08 against the installed @oh-my-pi/pi-coding-agent bundle); weather and stock are original to this extension.

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions

(For local development, use the repo path in `marketplace add`.)

## Display

A single space separates segments. The `segments` config key sets the order (without a config file, the `SEGMENTS` default in `index.ts` applies: `path` → `git` → `pr` → `weather` → `stock`; the rightmost segment shrinks first):

- **path**: folder icon + path.
  - Scratch paths (`os.tmpdir()`, `~/tmp`; on Windows also TEMP / TMP / SystemRoot\Temp): shown as a relative path with the scratch icon.
  - Work prefixes (`~/Projects`, `/work`): stripped.
  - Home shortened to `~` (whole path components only).
  - When too long, the tail (right end) is kept.
- **git**: `git status --porcelain=v1 --branch` → `<branch-icon> <branch> *N +N ?N` (N = unstaged / staged / untracked; zero counts are omitted; without a branch, only the counts remain).
- **pr**: `gh pr view --json number,url` → `<pr-icon> #<number>`, hyperlinked to the PR (links never actually emit under the current layout — see "Hyperlinks (OSC 8)").
- **weather**: Open-Meteo API (no key). Shows the forecast for the **next full hour**:
  - `weather.lang: zh` (default): `<emoji> <H>時: <天氣> <溫度>°C <降雨機率>%`
  - `weather.lang: en`: `<emoji> <weather> <temp>°C <rain>% at <H>:00` (hour moves to the end)
  - `H` is that hour in 24-hour form, unpadded; the rain probability is that slot's value, omitted when the API has none; unknown WMO codes drop the weather label.
  - English labels are longer, so the weather segment's max is widened to 39 cells to fit the longest combination (`freezing drizzle` + `100%`) without truncation.
- **stock**: Yahoo Finance chart API (no key):
  - Format `<emoji> <index> <value> <direction> <change> <pct>%`; emoji and direction follow the move (📈▲ / 📉▼ / ➖─).
  - Change and percent carry a sign, thousands separators, and two decimals; the baseline is the previous close, intraday values use the latest price.
  - Before the day's first trade in the exchange's timezone — weekends, holidays, or pre-market — only `💤 <index> <value>` shows, without change data (the last trade was not today).

A segment hides when its data is missing (not a git repo, no PR, no weather, no stock data); path always shows. When every segment hides, the line clears.

## Width

The whole line must fit one row. When too wide, segments shrink from the rightmost (`SEGMENTS` tail): first down to each segment's min, then below min (floor 1), moving left until the line fits. Cell budgets per segment (max / min live in each segment file):

The width budget depends on the render surface: on the `widget` surface, omp renders each `setWidget` line inside `Text(line, 1, 0)`, so the content area is `columns − 2` (`tui.tight` removes the padding; those users simply get 2 spare cells); on the `status` surface the line budgets the full `columns` and the host truncates it with an ellipsis. Widths are measured per grapheme cluster with `Bun.stringWidth`, the same engine the renderer wraps with: emoji + VS16 = 2 cells, `⛅`/`➖` = 2, tab = 3. This fixes undercounts that could wrap the line onto a second row on narrow terminals.

    path     max 40  min 24   (segments/path.ts, keeps the tail)
    git      max 36  min 20   (segments/git.ts)
    pr       max 30  min 10   (segments/pr.ts)
    weather  max 39  min 20   (segments/weather.ts)
    stock    max 38  min 20   (segments/stock.ts)

Hyperlinks are wrapped after shrinking completes, when OSC 8 actually emits: wrapped earlier, the width math would count escape bytes as visible cells and break the allocation.

## Hyperlinks (OSC 8)

The path segment uses the official `fileHyperlink`; pr and stock use `urlHyperlink` (handled centrally in index.ts; segments only report `href`). Whether OSC 8 actually emits is decided by `isHyperlinkEnabled()`: the `tui.hyperlinks` setting (default auto), terminal detection (kitty / ghostty / wezterm / iTerm / vscode / alacritty, or tmux ≥ 3.4 with a supporting outer terminal), and `NO_COLOR`.

Measured (2026-08-22, omp v17.4.2, global bun install): the `config/settings` instance inside the extension import graph (package source) is not the one inlined into the cli.js bundle, so the host's `Settings.init()` never initializes it, `isSettingsInitialized()` stays false, and the gate stays closed — **under this layout the widget line is always plain text**, even with `tui.hyperlinks: always` or `PI_FORCE_HYPERLINKS=1`. The TUI renderer itself supports OSC 8 (ANSI-aware width math, per-line link close); if the runtime ever shares the host module registry with extensions (a compiled binary does), links start working with no code change.

## Configuration

### another-statusline.yml (this extension)

Reorder, hide, resize segments, and set the weather / stock targets without touching source. Config file:

    $PI_CODING_AGENT_DIR/another-statusline.yml
    (without the env var: ~/.omp/agent/another-statusline.yml)

YAML (JSON also valid), schema modeled on omp's built-in `statusLine`; the values below are the built-in defaults:

    segments: [path, git, pr, weather, stock]   # order = display order (tail shrinks first)
    surface: status                             # render surface: status (below the built-in status bar) / widget (below the editor)
    segmentOptions:                             # per-segment width bounds, cells
      path:    { max: 40, min: 24 }
      git:     { max: 36, min: 20 }
      pr:      { max: 30, min: 10 }
      weather: { max: 39, min: 20 }
      stock:   { max: 38, min: 20 }
    weather: { location: Tokyo, lang: zh }      # place name (geocoded) / label language zh or en
    stock:   { symbol: "^TWII", name: TAIEX }   # Yahoo ticker / display name

Semantics:

- `segments`: **replaces the whole list** — only the listed ids show, in the given order; unlisted ids hide (this is how you turn a segment off); unknown ids are ignored and logged; an empty array or a missing `segments` falls back to the built-in default list. The ids are the five segments from "Display": `path` / `git` / `pr` / `weather` / `stock`.
- `surface`: the render surface, `status` or `widget` (default `status`); matched case-insensitively after trimming — a blank or unknown value falls back to the default. The `ANOTHER_SURFACE` environment variable overrides.
- Surface behavior — `status`: one line per extension key, ordered alphabetically by key (stable across updates), rendered below the built-in status bar; the host strips ANSI/OSC escapes, collapses whitespace runs, and truncates with an ellipsis at terminal width; the line repaints at the next host render, so a background poller update can appear one keypress late. `widget`: rendered between editor and status bar (`belowEditor` placement), repaints immediately; with several widget extensions the order follows update recency.
- `segmentOptions.<id>.max` / `min`: per-segment width bounds in cells; every segment id (`path` / `git` / `pr` / `weather` / `stock`) accepts them. Positive integers (≥1), min ≤ max after the merge; an invalid single field is dropped and the built-in value applies; min > max drops both fields for that segment (falls back to the built-ins). Keys without a matching segment are ignored.
- `weather.location`: the weather city as a **place name** (default `Taipei`). Names are geocoded to coordinates via Open-Meteo's geocoding API — same provider as the forecast, no key — with `count=1`, so the geocoder's first match wins; one result per name is cached for the process lifetime, and the default city ships built-in coordinates, so it never calls the geocoder. A geocoding failure (unknown name, network error) hides the segment and logs one error line.
- `weather.lang`: label language, `zh` or `en` (default `zh`); matched case-insensitively after trimming — any other value is dropped and falls back.
- `stock.symbol` / `stock.name`: the Yahoo ticker and its display name (default `^TWII` / `TAIEX`). With a custom symbol but no `name`, the symbol labels itself (e.g. `7203.T`); the default keeps `TAIEX`.
- Environment variables override the file per key, and the file overrides the built-ins (**env > YAML > built-in**): `ANOTHER_WEATHER_LOCATION`, `ANOTHER_WEATHER_LANG`, `ANOTHER_STOCK_SYMBOL`, `ANOTHER_STOCK_NAME`, `ANOTHER_SURFACE`. Blank values count as unset; values are trimmed.
- **Saving applies immediately**: every redraw (session_start / session_switch / turn_end / terminal resize / background data landing) re-reads the file; no restart. A changed location / symbol drops the cached data, so the segment hides until the new target's data lands (never the old city / index); a refetch right after a failed attempt still respects the attempt floor (weather 10 min, stock 60 s).
- Missing file → defaults, silently. Read failure (other than missing) or parse failure → defaults + one line in the error log under the OS tmp dir (`os.tmpdir()`), `another-statusline-errors.log`, + one error notification per process.
- The weather / stock background pollers ignore the `segments` filter: all of them stay started, so data stays cached and re-enabling is instant.

The "next full hour" is computed in local time while the API returns the location's timezone (`timezone=auto`); for a city outside the local timezone the wrong slot can be picked.

Default widths per segment are in the table under "Width"; `segmentOptions` overrides them.

### config.yml: built-in statusline

After installing this extension, remove `path` / `git` / `pr` from the built-in statusline's `leftSegments` so they do not duplicate the widget (the only step that concerns this extension).

What follows is general configuration for omp's built-in statusline, **unrelated to this extension** — kept as a reference for tuning the built-in line. The `statusLine` block of `~/.omp/agent/config.yml`:

- `preset`: built-in layout — `default` / `minimal` / `compact` / `full` / `nerd` / `ascii` / `custom`. `leftSegments` / `rightSegments` take effect only under `custom` (other presets ignore user arrays and use preset values).
- `leftSegments` / `rightSegments`: **array order is display order**; dropping an id hides that segment; unknown ids are silently ignored. `preset: custom` without arrays falls back to the `custom` preset defaults (`model,mode,path,git,pr` / `session_name,token_total,cost,context_pct`).
- `segmentOptions`: per-segment tuning (options in the table below); segments without options use built-in defaults.
- `separator`: segment divider — `powerline-thin` (default) / `powerline` / `slash` / `pipe` / `block` / `none` / `ascii`.

Valid ids (24, either side):

| id | Shows |
|---|---|
| `pi` | omp logo + mode badge (plan / vibe / goal / loop / prewalk / worktree) |
| `model` | model name; adds the thinking level when `segmentOptions.model.showThinkingLevel: true` |
| `mode` | current mode |
| `path` | project path; options `abbreviate` (default true) / `maxLength` (default 40) / `stripWorkPrefix` (default true) |
| `git` | branch + `*N +N ?N` (unstaged / staged / untracked); options `showBranch` / `showStaged` / `showUnstaged` / `showUntracked` |
| `pr` | current PR number (hidden without a PR) |
| `subagents` | running subagent count (hidden at 0) |
| `token_in` / `token_out` / `token_total` | session input / output / total tokens |
| `token_rate` | live tokens/s |
| `cost` | session spend ($) |
| `context_pct` | context usage % |
| `context_total` | context window capacity |
| `time_spent` | active session time (hidden below 1s) |
| `time` | current time; options `format` (`12h` / `24h`) / `showSeconds` |
| `session` | first 8 chars of the session id |
| `session_name` | session name |
| `hostname` | hostname (no domain) |
| `cache_read` / `cache_write` | cache read / write tokens |
| `cache_hit` | cache hit rate % (hidden at 0) |
| `usage` | provider quota usage (5h / 7d / monthly; hidden without quota data) |
| `collab` | collab role + participant count (hidden outside collab) |

Example (current setup: left `pi → model → mode → collab → context_pct → cost → usage`, right `session_name`, thinking level on the model segment; `path` / `git` / `pr` removed — the widget shows those three):

    statusLine:
      preset: custom
      leftSegments:
        - pi
        - model
        - mode
        - collab
        - context_pct
        - cost
        - usage
      rightSegments:
        - session_name
      segmentOptions:
        model:
          showThinkingLevel: true

Reorder by moving array entries (e.g. `cost` before `context_pct`); delete a segment by dropping its line (e.g. remove `- usage`); add one by inserting an id (e.g. `hostname` on the left, `time_spent` on the right).

## Uninstall

    omp plugin uninstall another-statusline@omp-extensions

If needed, add `path` / `git` / `pr` back to `statusLine.leftSegments`.

## Development

File layout, adding segments, source constants, tests, and redraw triggers are in [CONTRIBUTING.md](CONTRIBUTING.md).
