# Contributing to omp-collab-notify

[English](CONTRIBUTING.md) | 繁體中文

使用者文件(設定、bot 建立、行為)在 [README-zh-tw.md](README-zh-tw.md)。

## 檔案結構

- `index.ts` — omp 接線:`/collab` spec 包裝、中斷輪詢、重開迴圈
- `core.ts` — 純邏輯,不 import omp:設定解析、訊息組字、Telegram 發送
- `core.test.ts` — `bun test` 對 `core.ts` 的單元測試
- `package.json` — 宣告進入點:`"omp": { "extensions":
  ["./index.ts"] }`

## 驗證

```bash
bun install                        # 在 plugins/omp-collab-notify
bun test plugins/omp-collab-notify # 自 repo 根目錄
bunx tsc --noEmit -p plugins/omp-collab-notify
```

再跑 AGENTS.md 的安裝煙霧測試:

```bash
omp plugin marketplace add <repo path>
omp plugin install omp-collab-notify@omp-extensions
# session 內:/collab — 檢查 Telegram 訊息與 omp agent 目錄 logs
omp plugin uninstall omp-collab-notify@omp-extensions
```

## 已知陷阱

- plugin 會改寫 `BUILTIN_COLLABORATION_SLASH_COMMANDS` 裡共用的
  `/collab` spec 物件;guard(`WeakSet`)避免 `/reload-plugins` 重複包裝。
- Telegram `sendMessage` 結果(與錯誤)會附加到
  `/tmp/omp-collab-notify-errors.log` — bot 發送的訊息無法從
  `getUpdates` 看到,這個 log 就是送達紀錄。
- 重開路徑一律開可寫入房間,即使中斷前是唯讀房間。

## 發版

版本存在兩處;兩處都要改:

- `package.json`
- `../../.omp-plugin/marketplace.json`(repo 根目錄 `.omp-plugin/`)
