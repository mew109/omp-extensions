# omp-herdr-tab-title

English | [繁體中文](README-zh-tw.md)

An omp extension that renames the current herdr tab to the omp session title, shortened to at most 15 display columns, with `…` appended when truncated (16 columns total). herdr tabs default to bare numbers, which are hard to tell apart; this mirrors the session name omp already generates onto the tab.

## What it does

- Inside herdr (detected by `HERDR_TAB_ID`), the extension renames the tab with `herdr tab rename <TAB_ID> <LABEL>`.
- Two triggers:
  - The first session title after the first turn (omp generates it in the background).
  - Resume: `omp --continue` / `--resume` at launch, or resume/fork through the session picker.
- Outside herdr the extension does nothing and registers no handlers.

## Semantics

- **First name wins.** Once a session has set the tab label, later renames of that session (replan title refresh, manual `/rename`) do not change the tab again.
- **Last writer wins** if several omp sessions share one herdr tab.
- Labels are width-aware: CJK chars count as 2 columns. Titles longer than 15 columns are cut to 15 and get `…` appended (16 columns total).
- If several events fire before the auto title exists, the extension retries at +2 s/+6 s/+12 s after the turn, then waits for the next event. It never polls forever.
- **Known issue:** the tab label does not follow the foreground process. `fg` sends no event into omp, so when several omp sessions share one tab and you switch between them in the shell, the tab keeps the label of the last session that wrote it.

## Environment

| Variable | Meaning |
|---|---|
| `HERDR_TAB_ID` | Tab to rename (e.g. `w4:t1`). Its presence is the herdr detection. |
| `HERDR_BIN_PATH` | herdr binary path. Defaults to `herdr` on `PATH`. |

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-herdr-tab-title@omp-extensions

## Update

1. Bump `version` in `.omp-plugin/marketplace.json` and the plugin's `package.json`.
2. `omp plugin marketplace update omp-extensions && omp plugin upgrade omp-herdr-tab-title@omp-extensions`

## License

MIT — see [LICENSE](../../LICENSE).
