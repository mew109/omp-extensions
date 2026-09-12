# Contributing to omp-pii-mask

[English](CONTRIBUTING.md) | 繁體中文

兩個原始碼檔案。使用者文件(安裝、遮罩樣式、設定、範圍)在
[README.md](README.md)。

## 檔案結構

- `index.ts` — omp 黏著層:設定檔載入、hook 註冊、`/pii-map` 指令、輸出
- `core.ts` — 純邏輯、無 omp import:樣式表、遮罩/還原引擎、訊息轉換、
  設定解析
- `core.test.ts` — `bun test` 對 `core.ts` 的單元測試
- `package.json` — 宣告進入點:`"omp": { "extensions":
  ["./index.ts"] }`

## 常數

| 名稱 | 意義 |
|---|---|
| `PII_MASK_PHONE` | 電話遮罩的環境變數覆蓋 |
| `CONFIG_PATH` | `$PI_CODING_AGENT_DIR/pii-mask.yml` |
| `PII_NOTICE` | `before_agent_start` 附加的系統提示通知 |
| `ENV_PHONE` | core 端的 `PII_MASK_PHONE` 環境變數名稱 |
| `DEFAULT_SETTINGS` | `{ phone: false }` — 內建預設 |

設定優先序:環境變數 `PII_MASK_PHONE` > YAML `phone` > `false`。設定在
extension 載入時每個 process 讀取一次;沒有重新載入或錯誤記錄機制
(設定檔不存在或格式錯誤時安靜使用預設值)。

## Hook 流程

- `context` → `maskMessages`(core)→ `{ messages }`
- `tool_call` → 對 `event.input` 執行 `unmaskInPlace`
- `before_agent_start` → 在 `systemPrompt` 區塊陣列附加
  `<!-- pi-pii-mask -->` + `PII_NOTICE`(已有 marker 則跳過)
- `message_end` → 就地還原 assistant text/thinking 區塊(omp 上此事件僅
  為通知)
- `/pii-map` → `formatMap(redactor.entries())`,經 `report()`:TUI 用
  `ctx.ui.notify`,無頭模式用 stdout

## 上游同步

Upstream 是單一檔案
([pi-pii-mask `index.ts`](https://github.com/TheRealStubbornDeveloper/pi-pii-mask/blob/main/index.ts));
我們的拆分是 core(引擎)/ glue(hook)。upstream 的修改改植進
`core.ts`,`index.ts` 的 hook 主體保持精簡。

## 驗證

```bash
bun install                      # 在 plugins/omp-pii-mask
bun test plugins/omp-pii-mask    # 於 repo root
bunx tsc --noEmit -p plugins/omp-pii-mask
```

接著跑 AGENTS.md 的安裝煙霧測試:

```bash
omp plugin marketplace add <path-to-repo>
omp plugin install omp-pii-mask@omp-extensions
omp -p "reply: ok"    # 檢查 ~/.omp/logs/ 是否有載入錯誤
omp plugin uninstall omp-pii-mask@omp-extensions
```
