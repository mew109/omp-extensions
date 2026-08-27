# dump-as-curl extension

[English](README.md) | 繁體中文

把 omp 最後一次送給 LLM 的 request(URL、headers、原始 body)dump 成一個
可直接執行的 shell script,用 `curl` 重放。類似內建的 `/dump`,但輸出是
現成的 curl 指令檔:本機 llama.cpp / OpenAI 相容端點與遠端 provider 都適用。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install dump-as-curl@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 使用

    /dump-as-curl [--index N] [--filename FILE] [--help]

| 參數 | 說明 |
|---|---|
| `--index N` | 要 dump 第幾筆擷取:1 = 最新(預設 1;保留最後 8 筆) |
| `--filename FILE` | 輸出檔:純檔名放 OS tmp 目錄;含 `/` 的路徑以 cwd 解析 |
| `--help` | 顯示說明 |

範例:

- `/dump-as-curl` — 最新一筆 → OS tmp 目錄下的
  `omp-llm-request-curl-*.sh`
- `/dump-as-curl --index 3` — 第三新一筆
- `/dump-as-curl --filename req.sh` — `<tmp 目錄>/req.sh`
- `/dump-as-curl --filename ./req.sh` — `<cwd>/req.sh`

每次執行後,輸出路徑會顯示在狀態列(headless 模式:stdout)。檔案以
0700 權限寫入。

## 運作方式

extension 在行程內攔截 `globalThis.fetch`。凡 POST 的 URL 路徑符合 LLM
端點,就記錄(有序 headers、逐位元組 body)到一個保留最後 8 筆的
ring,單一 body 上限 16 MiB。端點模式:

- `/v1/messages` — Anthropic
- `/completion` — completions、chat/completions、llama.cpp `/completion`
- `/v1/responses` — OpenAI Responses
- `generatecontent` — Gemini 與 Vertex
- `/api/chat` — Ollama
- `/api/generate` — Ollama
- `/converse` — Bedrock

## 安全

script 內含 Authorization headers 與原始對話 context,請把檔案當 API
key 對待:維持 0700、重放完就刪除。ring 僅存於記憶體,存活整個行程。

## 限制

- 走 `providers.openaiWebsockets` 的 request 不會被擷取(WebSocket,
  不是 fetch)。
- 行程第一次 LLM 呼叫之前沒有任何擷取。
- 副產生的 request(標題生成、advisors、subagents、web-search LLM)與
  主對話共用 ring——用 `--index` 取較早的。
- ACP 客戶端可能不顯示狀態訊息;檔案仍會寫入——請查看 tmp 目錄。

## 移除

    omp plugin uninstall dump-as-curl@omp-extensions
