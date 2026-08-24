# omp-cc-user

[English](README.md) | 繁體中文

控制 omp 顯示哪些個人 `~/.claude` 資源:個人 skills、使用者 plugins、
slash commands 與 MCP servers。`list` 只讀設定;`enable` / `disable`
只寫一個 key —— `~/.omp/agent/config.yml` 的 `disabledExtensions`。
Claude Code 本身不受影響。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-cc-user@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 使用

兩個入口執行同一支 script,輸出原樣轉發:

- slash command `/omp-cc-user:omp-cc-user <args>`(marketplace 安裝時,
  plugin commands 會冠上 plugin 名稱前綴)
- `omp-cc-user` skill:

```bash
python3 skill://omp-cc-user/scripts/omp_cc_user.py <args>
```

從 repo checkout 呼叫時,直接跑
`plugins/omp-cc-user/skills/omp-cc-user/scripts/omp_cc_user.py`。
不帶參數即印 usage 表。

### 資源

| 資源 | 管理對象 | 說明 |
|---|---|---|
| `skill` | `~/.claude/skills` 下的目錄 | 狀態來自 `disabledExtensions` 與舊版 `skills.ignoredSkills` key |
| `plugin` | `~/.claude/plugins/installed_plugins.json` 的條目 | 一個名稱切換該 plugin 附帶的全部資源:skills、slash commands、hooks,以及 `mcp:<plugin>:<server>` ids |
| `command` | `~/.claude/commands` 下的 `*.md` | 子目錄內的檔案會列出其全部 ids,如 `sub:x` |
| `mcp` | `~/.claude.json`,否則 `~/.claude/mcp.json` 的 user-level servers | 第一個有 server 的檔案勝出 —— omp 的規則。`enabled: false` 的 server 列為 off;即使 `mcp enable`,omp 仍會跳過它 |

每個資源都有 `list`、`disable <name...>`、`enable <name...>`。

### 名稱規則

- 每次呼叫可給一或多個名稱;支援 fnmatch globs(`* ? [`)—— 記得加引號,
  讓 shell 原樣傳遞。
- 每個名稱必須至少匹配一項,否則什麼都不寫(fail-fast:不寫一半)。
- plugin 名稱:完整 key(`name@market`)、或唯一的短名 `name`;globs
  兩種形式都比對。短名同時出現在兩個 marketplace 時報錯,需寫完整 key。
- 與其他 plugin 資源同名的資源會一併切換 —— disable 作用於 ids,不是檔案。

`enable` / `disable` 後執行 `/reload-plugins`(或重啟 omp)才生效。

## 移除

    omp plugin uninstall omp-cc-user@omp-extensions

## 開發

檔案結構、版號 bump 與沙箱驗證見 [CONTRIBUTING-zh-tw.md](CONTRIBUTING-zh-tw.md)。
