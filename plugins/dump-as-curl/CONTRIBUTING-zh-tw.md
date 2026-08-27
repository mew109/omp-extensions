# dump-as-curl 開發指南

[English](CONTRIBUTING.md) | 繁體中文

兩個原始檔。使用者取向的說明(安裝、參數、限制)見
[README-zh-tw.md](README-zh-tw.md)。

## 檔案結構

- `index.ts` —— omp 接線:fetch wrapper、註冊 command、輸出
- `core.ts` —— 純邏輯,不 import omp:參數解析、端點判斷、擷取、
  curl 生成
- `core.test.ts` —— `bun test` 對 `core.ts` 的單元測試
- `package.json` —— 宣告 entry:`"omp": { "extensions": ["./index.ts"] }`

## 原始碼導覽

- 擷取:`installCapture()`(index.ts)以
  `globalThis` 上的 `Symbol.for("omp.dump-as-curl")` 作防護,每行程只包
  一次 `globalThis.fetch`。URL 符合 `isLlmEndpoint` 的 POST 經
  `makeCapture` 變成 `Capture`,放進保留 8 筆的 ring(`pushCapture`)。
- Command:`/dump-as-curl`(`registerCommand`)解析參數(`parseArgs`)、
  選出擷取(`pickCapture`,1 = 最新)、生成 script(`renderCurlScript`;
  第四個參數 `redactAuth` 預設 true——`--no-redact` 保留 Bearer token)
  後寫檔(`resolveOutPath` → `Bun.write` → `chmodSync` 0700)。
- 輸出:TUI 用 `ctx.ui.notify`(與 `/dump` 同一顯示面);`hasUI` 為
  false 時寫 `process.stdout`。

## 驗證

```bash
bun install                      # 在 plugins/dump-as-curl
bun test plugins/dump-as-curl    # repo root 執行
bunx tsc@7.0.2 --noEmit -p plugins/dump-as-curl
```

再用 AGENTS.md 的安裝 smoke test:

```bash
omp plugin marketplace add <repo path>
omp plugin install dump-as-curl@omp-extensions
# session 內:先送一則訊息,再 /dump-as-curl;sh <file> 重放
omp plugin uninstall dump-as-curl@omp-extensions
```

## 已知陷阱

- `Bun.chmod` 在執行期不存在(Bun 1.3.14 實測);本 plugin 改用
  `fs.chmodSync`。
- fetch wrapper 必須轉發 `fetch.preconnect`——omp 的型別要求
  `typeof fetch` 帶有它。
- 端點判斷是 URL path 檢查,不是 provider 偵測;模式已挑過,無關的
  POST 不會撞上。

## 發版

版號存在兩處,bump 時兩邊都要改:

- `package.json`
- `../../.omp-plugin/marketplace.json`(repo root 的 `.omp-plugin/`)
