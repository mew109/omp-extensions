# another-statusline 開發指南
[English](CONTRIBUTING.md) | 繁體中文

給維護者與想改 code 的人:檔案結構、怎麼新增 segment、原始碼常數、測試與重繪時機。使用者取向的說明(安裝、顯示、設定)見 [README-zh-tw.md](README-zh-tw.md)。

## 檔案結構

    index.ts            Segment 合約、註冊表(SEGMENTS)、loader 設定(parseLoaderConfig /
                        resolveSegments / resolveBounds)、各段設定接線、組裝(寬度分配、截斷、
                        hyperlink、OSC 8)+ extension entry
    core.ts             與 segment 無關的共用機械:寬度計算(displayWidth / truncate*)、分配器
                        (allocate)、command runner(run)、背景輪詢器(createPoller)
    core.test.ts        寬度 / 截斷 / 分配器 / poller invalidate 測試
    index.test.ts       loader 設定測試(parseLoaderConfig / resolveSegments / resolveBounds)
    segments/
      path.ts           路徑段(改寫自內建 mpi 渲染器;環境相依:tmpdir、HOME —— 唯一無測試的段)
      git.ts            git 段(改寫自內建 cpi 渲染器)+ git.test.ts
      pr.ts             PR 段(改寫自內建 dpi 渲染器)+ pr.test.ts
      weather.ts        天氣段(自帶設定切片:weatherSettings / applyWeatherSettings、geocoding)+ weather.test.ts
      stock.ts          股市段(自帶設定切片:stockSettings / applyStockSettings)+ stock.test.ts

## 新增 segment

1. 建 `segments/<id>.ts`,export 一個 `Segment`(`index.ts` 定義):`{ id, max, min, keep?, render(ctx), start?(rerender) }`。
   - `keep?`:截斷方向 —— `"head"`(預設,保留左側)或 `"tail"`(保留右側,path 用)。
   - `render` 回傳 `{ text, href? }`,回 `null` 隱藏;背景輪詢用 `createPoller`(weather / stock 即範本)。
2. `index.ts` 加 import,放進 `SEGMENTS` 陣列 —— 兩行。

`SEGMENTS` 是內建預設註冊表;使用者端的順序與顯示與否由設定檔控制(見 README-zh-tw 的「設定」),不必改原始碼。

## 常數(依檔案)

| 常數 | 位置 | 預設 | 作用 |
|---|---|---|---|
| `SEGMENTS` | index.ts | 五段陣列 | 內建預設註冊表(使用者端由 `another-statusline.yml` 覆蓋順序與寬度,見 README-zh-tw 的「設定」) |
| `SEPARATOR` | index.ts | 兩格空格 | 段間分隔 |
| `ERROR_LOG` | core.ts | `<os.tmpdir()>/another-statusline-errors.log` | 錯誤日誌位置 |
| `DEFAULT_WEATHER` | segments/weather.ts | `{ location: "Taipei", lang: "zh" }` | 天氣內建預設;執行期優先序為 env `ANOTHER_WEATHER_LOCATION` / `ANOTHER_WEATHER_LANG` > YAML `weather.location` / `weather.lang` > 此值(`weatherSettings` / `applyWeatherSettings` 同檔)。注意:「下個整點」以本機時區計算,而 API 回傳地點時區(`timezone=auto`),兩者不同時會選錯時隙 |
| `WEATHER_REFRESH_MS` | segments/weather.ts | 30 分 | 天氣重取間隔 |
| `WEATHER_MIN_ATTEMPT_MS` | segments/weather.ts | 10 分 | 兩次 HTTP attempt 的最小間隔 |
| `WEATHER_TIMEOUT_MS` | segments/weather.ts | 15 秒 | 單次 fetch 逾時(慢路由上 TLS handshake 就可能 >5 秒) |
| `DEFAULT_STOCK` | segments/stock.ts | `{ symbol: "^TWII", name: "TAIEX" }` | 股市內建預設;執行期優先序為 env `ANOTHER_STOCK_SYMBOL` / `ANOTHER_STOCK_NAME` > YAML `stock.symbol` / `stock.name` > 此值(`stockSettings` / `applyStockSettings` 同檔) |
| `STOCK_REFRESH_MS` | segments/stock.ts | 5 分 | 報價重取間隔 |
| `STOCK_MIN_ATTEMPT_MS` | segments/stock.ts | 60 秒 | 兩次 HTTP attempt 的最小間隔 |
| `STOCK_TIMEOUT_MS` | segments/stock.ts | 10 秒 | 單次 fetch 逾時 |
| `ABBREVIATE` / `STRIP_WORK_PREFIX` / 圖示常數 | segments/path.ts 等 | 見原始碼 | 圖示 fallback;主題 `theme.icon.*` 存在時以主題為準 |

git / gh 查詢逾時預設 5000ms(`run` 的 `timeoutMs` 參數)。

## 測試

    bun test plugins/another-statusline

純邏輯均有測試:core(寬度 / 截斷 / 分配器 / poller invalidate)、index(loader 設定)、weather / git / pr / stock 各自的解析器與文字產生器(含 weather / stock 的設定切片)。path 段依賴 `os.tmpdir()`、HOME 等環境,不測;fetch / timer 層不測(由 `bun test` 以外的整合 smoke 驗證)。測試檔不進 tsc(全域無 bun 型別),由 bun test 實跑涵蓋;typecheck:`bunx tsc --noEmit -p plugins/another-statusline`。

## 重繪時機

事件驅動:`session_start` / `session_switch` / `turn_end` 各重繪一次(cwd 與 repo 狀態在 OMP 內就會變,事件已足夠)。另以 `process.stdout` 的 `"resize"` 監聽(去抖 300 ms)重繪,終端寬度變更時整行自動重排。weather / stock 另有各自的 unref'd timer(refresh 間隔),到期只重抓自己的資料,新資料落地才透過 rerender 重繪整行(git / pr 一併更新)——timer 不再無謂地重跑 git / gh。fetch 不阻塞渲染:widget 先畫(快取空時該段先隱藏),資料到位後即刻重繪補上;每次重繪從快取的時隙(天氣約 48 小時)選出「下個整點」,整點過後自動換下一段,不顯示過去時隙;fetch 失敗保留舊資料(無舊資料則隱藏該段),錯誤只寫 `ERROR_LOG` 不彈通知。

## 未複製的內建行為

extension 拿不到 status-line 專屬 context,故不實作:worktree label、activeRepo 的 `relativeRepoRoot` 後綴。
