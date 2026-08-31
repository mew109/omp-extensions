# omp-herdr-tab-title

[English](README.md) | 繁體中文

omp extension:把目前的 herdr 分頁改名為 omp session 標題,最多 12 顯示欄。herdr 分頁預設只有編號,難以辨識;這個 plugin 把 omp 本來就會產生的 session 名稱同步到分頁上。

## 行為

- 在 herdr 環境內(以 `HERDR_TAB_ID` 偵測),用 `herdr tab rename <TAB_ID> <LABEL>` 改分頁名稱。
- 兩個觸發時機:
  - 第一回合後產生的第一個 session 標題(omp 在背景產生)。
  - Resume:啟動時的 `omp --continue` / `--resume`,或透過 session picker 的 resume/fork。
- 不在 herdr 環境時不做任何事,也不註冊任何 handler。

## 語意

- **第一個名稱優先。** session 設過分頁標籤後,之後該 session 的改名(replan 標題更新、手動 `/rename`)不會再改分頁。
- 多個 omp session 共用同一個 herdr 分頁時,**後寫入者勝**。
- 標籤做寬度感知截斷:CJK 字算 2 欄,所以中文標題會少於 12 個字。
- 事件觸發時自動標題可能還沒產生,extension 會在回合後 +2 秒/+6 秒/+12 秒重試,之後等下一個事件。不會無限輪詢。
- **已知限制:** 分頁標籤不會跟著前景切換。`fg` 不會對 omp 發出任何事件,所以同一個分頁裡有多個 omp session 在 shell 交替前景/背景時,分頁會維持最後寫入的 session 名稱。

## 環境變數

| 變數 | 意義 |
|---|---|
| `HERDR_TAB_ID` | 要改名的分頁(如 `w4:t1`)。有無此變數就是 herdr 偵測。 |
| `HERDR_BIN_PATH` | herdr 執行檔路徑。預設用 `PATH` 上的 `herdr`。 |

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-herdr-tab-title@omp-extensions

## 更新

1. 在 `.omp-plugin/marketplace.json` 與 plugin 的 `package.json` bump `version`。
2. `omp plugin marketplace update omp-extensions && omp plugin upgrade omp-herdr-tab-title@omp-extensions`

## 授權

MIT —— 見 [LICENSE](../../LICENSE)。
