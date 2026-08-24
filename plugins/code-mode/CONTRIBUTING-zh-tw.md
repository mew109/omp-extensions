# code-mode 開發指南

[English](CONTRIBUTING.md) | 繁體中文

單檔 extension。使用者取向的說明(安裝、keep-set、與 prewalk 的互動)
見 [README-zh-tw.md](README-zh-tw.md)。

## 檔案結構

- `index.ts` —— 整個 extension:flag、command、widget、system prompt hook
- `package.json` —— 宣告 entry:`"omp": { "extensions": ["./index.ts"] }`

## 原始碼導覽

- `KEEP_SET` —— mode 開啟時的直接工具:`eval`、`ask`、`read`、`write`。
  `activate()` 先快照啟用前的 active 集;`deactivate()` 在 `off` 時還原。
- `WIDGET_KEY` —— widget key `"code-mode"`;啟用時在編輯器下方顯示一行
  `⌨️ Code Mode`。
- `HINT_BLOCK` —— 固定的 `§ Code Mode` system prompt block。同一 mode
  狀態下每個 turn 文字不變,effective prompt 穩定,provider 的 prompt
  cache 維持。
- 事件:
  - `session_start` —— 快照預設工具集;`--code-mode` flag 有設時啟用。
  - `turn_start` —— 防禦性重套 keep-set,避免 session 中途有人重設
    active 集。
  - `before_agent_start` —— 啟用時把 `HINT_BLOCK` 追加到 system prompt。
- `registerCommand("code-mode")` —— `/code-mode [on|off]`;不帶參數顯示
  狀態。

## 驗證

無測試、無 tsconfig(唯一 import `@oh-my-pi/pi-coding-agent` 從已安裝的
plugin cache 解析,不在本 repo —— 見 AGENTS.md)。用 AGENTS.md 的安裝
smoke test 驗證:

```bash
omp plugin marketplace add <repo path>
omp plugin install code-mode@omp-extensions
omp --code-mode        # widget:⌨️ Code Mode
# session 內:/code-mode(狀態)、/code-mode off(工具還原)
omp plugin uninstall code-mode@omp-extensions
```

## 已知陷阱

- `ask` 不在 tool registry;`setActiveTools` 對未註冊名稱靜默忽略,故
  實際 active 集是 `eval`、`read`、`write`。2026-08-20 於 omp v17.3.7
  實測(細節見 README keep-set 註記)。依賴 `KEEP_SET` 裡的 `ask` 前先
  重測。
- code mode 啟用期間 prewalk handoff 不會觸發:eval bridge 內的工具呼叫
  不產生工具結果訊息,而 prewalk 只掃描那些。直接 `write` 仍會觸發。背景
  見 README(「與 prewalk 的相容性」)。

## 發版

版號存在兩處,bump 時兩邊都要改:

- `package.json`
- `../../.omp-plugin/marketplace.json`(repo root 的 `.omp-plugin/`)
