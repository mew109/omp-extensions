# omp-pii-mask extension

[English](README.md) | 繁體中文

在資料離開 omp、送往 LLM provider 之前遮罩個人資料(PII),並在工具參數與
assistant 回覆中透明還原。模型只看到 `[EMAIL_1]` 這類 placeholder,真實值
不會出現在送往 provider 的流量中。改植自
[pi-pii-mask](https://github.com/TheRealStubbornDeveloper/pi-pii-mask)
(作者 alfrancisgabriel,MIT)。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-pii-mask@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 會遮罩的內容

| 樣式 | 符合 | 預設 |
|---|---|---|
| EMAIL | email 地址 | 開 |
| PHONE | 電話號碼(3-3-4 位數字,可有分隔符與國碼) | **關** |
| SSN | `123-45-6789` | 開 |
| CC | 16 位卡號 | 開 |
| PRIVATE_IP | RFC 1918 IPv4 位址 | 開 |
| API_KEY_SK | `sk-…`、`sk-ant-…`、`sk-or-v1-…` 金鑰 | 開 |
| API_KEY_GH | `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` token | 開 |
| API_KEY_AI | `AIza…` Google API 金鑰 | 開 |
| API_KEY_CF | Cloudflare API token | 開 |
| JWT | JSON Web Token(`eyJ…`) | 開 |
| AWS_KEY | `AKIA…` access key ID | 開 |
| CONN_STR | mongodb / postgres / mysql 連線字串中的密碼 | 開 |

PHONE 預設關閉:它的 regex 會命中所有 10 位連續數字——Unix 時間戳、訂單
編號等都是。確定流量中有真實電話號碼再開。

## 運作方式

```
 使用者輸入 ──▶ context hook ──▶ 遮罩後 ──▶ LLM provider
                  │                          │
                  ▼                          ▼
   before_agent_start:系統提示通知           │
                  │                          ▼
 tool_call hook ◀─ 工具參數中的 placeholder   │
   (還原真實值)                             │
                  │                         ▼
           message_end hook ◀── assistant 回覆 ──▶ 對使用者還原
                  │
                  ▼
            /pii-map(placeholder → 原值對照)
```

- `context` — 送往 provider 前,遮罩 user 與 tool-result 內容(以及
  assistant thinking)。
- `tool_call` — 還原工具參數中的 placeholder,工具拿到真實值執行。
- `before_agent_start` — 在系統提示附加通知,告訴模型原樣使用 placeholder
  (有 marker 防護,只加一次)。
- `message_end` — 還原 assistant 文字/thinking 中的 placeholder,讓你看到
  真實值。
- `/pii-map` — 顯示目前 placeholder → 原值對照。TUI 用狀態列通知;無頭
  模式印到 stdout。

遮罩只在記憶體、只屬於該 process,不會寫進磁碟。

## 設定

設定在啟動時讀取一次——改完要重啟 omp。設定檔不存在或格式錯誤時安靜使用
預設值。

優先序:環境變數 > YAML > 預設值。

| 設定 | 環境變數 | YAML key | 預設 |
|---|---|---|---|
| 電話號碼遮罩 | `PII_MASK_PHONE` | `phone` | `false` |

`$PI_CODING_AGENT_DIR/pii-mask.yml`(預設 `~/.omp/agent/pii-mask.yml`):

```yaml
phone: true
```

環境變數:`PII_MASK_PHONE=true|false|1|0|yes|no|on|off`(空白或其他值視為
未設定)。

## 與 upstream 的差異

- PHONE 樣式改為設定項,預設關閉(upstream 恆開)。
- `/pii-map` 改用 omp 的狀態列通知 / stdout,而非 pi 的 `ctx.ui.showText`。
- 改植到 omp extension API(omp 的 `systemPrompt` 是區塊陣列;
  `message_end` 僅為通知事件,還原改為就地修改訊息快照)。

## 範圍

只遮罩送往 provider 的流量。終端機畫面、session 檔案、磁碟上的工具輸出
仍包含工具實際產生的內容。

## 授權

MIT — upstream © alfrancisgabriel;本移植依 repo LICENSE 授權。
