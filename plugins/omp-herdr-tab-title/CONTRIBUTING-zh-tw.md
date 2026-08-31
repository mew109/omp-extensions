# Contributing: omp-herdr-tab-title

[English](CONTRIBUTING.md) | 繁體中文

## 開發流程

在 repo 根目錄:

    bun install --cwd plugins/omp-herdr-tab-title
    bun test plugins/omp-herdr-tab-title
    bunx tsc --noEmit -p plugins/omp-herdr-tab-title

- `core.ts` 放純函式(`abbreviateSessionName`、`herdrSpawnTarget`)與其測試;`index.ts` 是 extension 接線,本身沒有測試。
- 依賴只放 devDependencies(`package.json` 不設 `dependencies`)。marketplace 安裝只是目錄複製,執行時只能 import Node/Bun 內建模組與 `@oh-my-pi/*`。
- `bun.lock` 需要追蹤;CI 用 `bun install --frozen-lockfile`。新增套件後若 `bun install` 沒印 "Saved lockfile",再跑一次。

## e2e 煙霧測試

1. 把 repo 註冊成 marketplace 並安裝:`omp plugin marketplace add <path-to-repo> && omp plugin install omp-herdr-tab-title@omp-extensions`。
2. 在 herdr 分頁內的暫存目錄跑 `omp`,送一個 prompt,等回合結束。自動標題會在約 15 秒內出現;用 `herdr tab get $HERDR_TAB_ID` 確認 `label` 等於 session 標題的前 12 顯示欄以內。
3. 離開後在同一分頁跑 `omp --continue`:啟動當下就會設好標籤,不需要任何 prompt。
4. 在 herdr 外(`env -u HERDR_TAB_ID`)確認什麼都不會發生:`~/.omp/logs/` 沒有 `omp-herdr-tab-title` 字樣。
5. 測完解除安裝,保持機器乾淨。

## 版本

`.omp-plugin/marketplace.json` 與本 plugin 的 `package.json` 的 `version` 要一起 bump,兩邊保持相等。CI 會檢查。
