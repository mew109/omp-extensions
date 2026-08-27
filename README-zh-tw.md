# omp-extensions

[English](README.md) | 繁體中文

個人 omp plugin marketplace,名稱 `omp-extensions`。內含以下 plugins:

| Plugin | 用途 | 類型 |
|---|---|---|
| another-statusline | 將內建 path/git/pr 三個狀態列段合併成一個 widget,另加天氣與股市段 | extension |
| code-mode | PTC 式 code mode:模型只能呼叫 eval/ask/read/write,其他工具經 kernel tool bridge 使用 | extension |
| dump-as-curl | 把 omp 最後一次送給 LLM 的 request dump 成可直接執行的 curl 指令檔 | extension |
| omp-cc-user | 管理哪些個人 `~/.claude` 資源(skills、plugins、slash commands、mcp servers)在 omp 顯示 | skill + slash command |
| omp-segments-to-widgets | 把 OMP 狀態列段改成安全、寬度感知的 extension widgets 的程序 | skill |

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions
    omp plugin install code-mode@omp-extensions
    omp plugin install dump-as-curl@omp-extensions
    omp plugin install omp-cc-user@omp-extensions
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
