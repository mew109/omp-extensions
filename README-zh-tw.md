# omp-extensions

[English](README.md) | 繁體中文

個人 omp plugin marketplace,名稱 `omp-extensions`。內含以下 plugins:

| Plugin | 用途 | 類型 |
|---|---|---|
| another-statusline | 將內建 path/git/pr 三個狀態列段合併成一個 widget,另加天氣與股市段 | extension |
| code-mode | PTC 式 code mode:模型只能呼叫 eval/ask/read/write,其他工具經 kernel tool bridge 使用 | extension |
| dump-as-curl | 把 omp 最後一次送給 LLM 的 request dump 成可直接執行的 curl 指令檔 | extension |
| omp-cc-user | 管理哪些個人 `~/.claude` 資源(skills、plugins、slash commands、mcp servers)在 omp 顯示 | skill + slash command |
| omp-herdr-tab-title | 把目前的 herdr 分頁改名為 omp session 標題(最多 15 顯示欄 + `…`);不在 herdr 環境時不做任何事 | extension |
| omp-segments-to-widgets | 把 OMP 狀態列段改成安全、寬度感知的 extension widgets 的程序 | skill |
| omp-collab-notify | 當 /collab 房間開啟時送出 Telegram 通知;可選:relay 中斷房間時自動重開並通知新連結 | extension |
| omp-pii-mask | 在資料送進 LLM 前遮罩 PII(email、API key、卡號等),並在工具呼叫與回覆中還原(/pii-map);電話號碼為選用 | extension |

Windows 支援仍屬實驗性:僅由 `check-windows` CI job 驗證,尚未在實機 Windows 上測試。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions
    omp plugin install code-mode@omp-extensions
    omp plugin install dump-as-curl@omp-extensions
    omp plugin install omp-cc-user@omp-extensions
    omp plugin install omp-herdr-tab-title@omp-extensions
    omp plugin install omp-collab-notify@omp-extensions
    omp plugin install omp-pii-mask@omp-extensions
    omp plugin install omp-segments-to-widgets@omp-extensions

本機開發時改用 repo 路徑:`omp plugin marketplace add <path-to-repo>`。

## 移除

    omp plugin uninstall <name>@omp-extensions

## 版本更新

1. 在 `.omp-plugin/marketplace.json`(與該 plugin 的 `package.json`)bump
   `version`。
2. `omp plugin marketplace update omp-extensions`
3. `omp plugin upgrade <name>@omp-extensions`

## 授權

MIT —— 見 [LICENSE](LICENSE)。
