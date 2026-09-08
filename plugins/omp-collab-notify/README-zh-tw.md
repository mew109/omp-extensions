# omp-collab-notify

[English](README.md) | 繁體中文

當 `/collab` 房間開啟時,以 Telegram 訊息送出新房間連結。可選:當 relay 中斷目前房間時自動重開新房間,並通知新連結。

僅限 TUI。需要設定 `collab.relayUrl`(或在 `/collab` 後面帶上)。本 plugin 依賴 omp 目前的 `/collab` 內部實作,omp 大版本更新時可能需要調整。

## 設定

將以下內容複製到 `~/.omp/agent/omp-collab-notify.yml`(或 `$PI_CODING_AGENT_DIR/omp-collab-notify.yml`):

```yaml
telegram:
  botToken: ""           # e.g. "123456789:AA..." — from @BotFather
  chatId: ""             # e.g. "123456789" (negative number for group chats)
collab:
  notify: true           # send Telegram notifications for new rooms
  autoRehost: true       # re-open a fresh room when the relay kills the current one
  rehostRetries: 2       # extra start attempts after the first rehost try
  rehostDelaySeconds: 5  # pause between rehost attempts
```

環境變數 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` 優先於 YAML。omp 會自動載入 `~/.omp/agent/.env`,適合放這兩個變數。空字串(環境變數或 YAML)視為未設定。設定檔修改後立即生效,不需重啟。

| 選項 | 預設 | 說明 |
|---|---|---|
| `collab.notify` | `true` | 通知開關。`false` 時關閉所有 Telegram 發送與未設定警告。 |
| `collab.autoRehost` | `true` | relay 中斷房間時自動重開新房間。與 `notify` 互相獨立。 |
| `collab.rehostRetries` | `2` | 第一次重試之後的額外嘗試次數。 |
| `collab.rehostDelaySeconds` | `5` | 重試之間的間隔秒數。 |

## Telegram bot 建立

1. 在 Telegram 私訊 `@BotFather`,執行 `/newbot`,照提示操作,複製 token(`123456789:AA...`)。
2. 對你的新 bot 傳任意訊息(或按 Start)。使用者若從未傳過訊息,bot 無法透過 `getUpdates` 看到對方。
3. 取得 chat ID:

       curl "https://api.telegram.org/bot<TOKEN>/getUpdates"

   讀取 `result[].message.chat.id`。群組聊天:把 bot 加進群組、在群組發一次言,使用負數的群組 id。也可用 `@userinfobot`。

## 行為

- 房間開啟時(`/collab`、`/collab start`、`/collab view`)送出含 web + terminal 連結的 Telegram 訊息。唯讀房間使用唯讀連結。
- 該通知時若 `telegram.botToken` / `telegram.chatId` 未設定,TUI 會出警告提醒設定。
- 自動重開:relay 在非使用者操作下中斷房間(fatal 關閉——host 衝突、房間關閉/已滿/不存在)時,plugin 重開一間新的可寫入房間(新連結)並以 Telegram 通知新連結。`1 + rehostRetries` 次都失敗後改送失敗訊息。`/collab stop`、切換 session、結束程式都不會觸發。
- 訪客模式(`/join`)不會通知。

## Session 進行中切換功能

沒有 session 內的 slash command。設定檔在每次通知與每次中斷輪詢時都會重新讀取,所以直接改檔即可在下一個事件生效——不需重啟:

    # 在另一個終端,session 繼續執行時
    ${EDITOR:-vi} ~/.omp/agent/omp-collab-notify.yml

- `collab.notify: false` — 下一次房間開啟(或重開)不會送 Telegram 訊息,也不會出未設定警告。改回 `true` 即恢復。
- `collab.autoRehost: false` — relay 中斷房間時不再自動重開;通知功能照常運作。
- 環境變數(`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`)在程式啟動時讀取;修改後需重啟 omp。

## 安裝

    omp plugin install omp-collab-notify@omp-extensions
