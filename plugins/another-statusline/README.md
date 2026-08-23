# another-statusline extension

將內建狀態列的 `path`、`git`、`pr` 三段合併成一個 widget(另加 Open-Meteo 天氣段與 Yahoo 股市段),顯示在編輯器下方。前三段**改寫自 omp 內建渲染器**(path = mpi、git = cpi、pr = dpi;格式與縮排策略於 2026-08 對照已安裝的 @oh-my-pi/pi-coding-agent bundle 驗證);weather 與 stock 為本擴充自製。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 檔案結構

    index.ts            註冊表(SEGMENTS)+ 組裝(寬度分配、截斷、hyperlink、OSC 8)+ extension entry
    core.ts             Segment 合約、寬度計算(displayWidth / truncate*)、分配器(allocate)、
                        command runner(run)、背景輪詢器(createPoller)
    core.test.ts        寬度 / 截斷 / 分配器測試
    segments/
      path.ts           路徑段(改寫自內建 mpi 渲染器;環境相依:tmpdir、HOME —— 唯一無測試的段)
      git.ts            git 段(改寫自內建 cpi 渲染器)+ git.test.ts
      pr.ts             PR 段(改寫自內建 dpi 渲染器)+ pr.test.ts
      weather.ts        天氣段 + weather.test.ts
      stock.ts          股市段 + stock.test.ts

### 新增 segment(plugin 式)

1. 建 `segments/<id>.ts`,export 一個 `Segment`(`core.ts` 定義):`{ id, max, min, keep?, render(ctx), start?(rerender) }`。`render` 回傳 `{ text, href? }`,回 `null` 隱藏;背景輪詢用 `createPoller`(weather / stock 即範本)。
2. `index.ts` 加 import,放進 `SEGMENTS` 陣列 —— 兩行。

順序即顯示順序(尾端先縮);把某段從陣列拿掉即完全停用(不發 API、不跑 timer)。

## 顯示

各段以兩格空格分隔,順序由 `index.ts` 的 `SEGMENTS` 決定(預設 `path` → `git` → `pr` → `weather` → `stock`):

- **path**:folder 圖示 + 路徑。
  - scratch 路徑(`os.tmpdir()`、`~/tmp`,Windows 另含 TEMP / TMP / SystemRoot\Temp):顯示相對路徑,換用 scratch 圖示。
  - work 前綴(`~/Projects`、`/work`):去掉前綴。
  - home 縮成 `~`(只匹配完整 path component)。
  - 過長時保留右側(路徑尾端)。
- **git**:`git status --porcelain=v1 --branch` → `<branch-icon> <branch> *N +N ?N`(N = unstaged / staged / untracked;0 值省略;無 branch 只剩計數)。
- **pr**:`gh pr view --json number,url` → `<pr-icon> #<number>`,hyperlink 指向 PR。
- **weather**:`<emoji> <H>時: <天氣> <溫度>°C <降雨機率>%`,`WEATHER_LANG: "en"` 時改為 `<emoji> <weather> <temp>°C <rain>% at <H>:00`(小時移到句尾)(Open-Meteo API,無 key):顯示下個整點的預報,`H` 即該整點的小時(24 小時制、不補零);降雨機率為該時隙的值,API 無機率資料時省略;未知 WMO code 省略天氣標籤。英文標籤較長,weather 段 max 已放寬到 39 cells,容納最長組合(`freezing drizzle` + `100%`)仍不截斷。
- **stock**:`<emoji> <指數名> <指數> <方向> <漲跌> <幅度>%`(Yahoo Finance chart API,無 key):emoji 與方向隨漲跌(📈▲ / 📉▼ / ➖─);漲跌與幅度帶 +/− 號、千分位、小數兩位;基準為前一交易日收盤,盤中為最新價。當天(交易所時區)尚未成交——週末、假日或開盤前——只顯示 `💤 <指數名> <指數>`,不顯示漲跌(最近成交日非今日)。

非 git repo、無 PR、無天氣、無股市資料時該段不顯示(path 恆有);各段皆無時 widget 清空。

## 寬度

整行必須塞進一列:超寬時從最右段(`SEGMENTS` 尾端)開始縮,先縮到該段 min,再低於 min(下限 1)繼續往右縮,直到放得下。各段 cell 預算(max / min 定義在各 segment 檔):

    path     max 48  min 24   (segments/path.ts,保留右側)
    git      max 36  min 20   (segments/git.ts)
    pr       max 30  min 10   (segments/pr.ts)
    weather  max 39  min 20   (segments/weather.ts)
    stock    max 38  min 20   (segments/stock.ts)

若 OSC 8 實際輸出,hyperlink 在縮排完成後才包上:若先包,寬度計算會把 escape 字元當成可見 cell,壞掉分配。

## hyperlink(OSC 8)

path 段以官方 `fileHyperlink`、pr 與 stock 段以 `urlHyperlink` 包(由 index.ts 統一處理,segment 只回報 `href`)。是否真的輸出 OSC 8 由 `isHyperlinkEnabled()` 決定:`tui.hyperlinks` 設定(預設 auto)、終端能力偵測(kitty / ghostty / wezterm / iTerm / vscode / alacritty,或 tmux ≥ 3.4 且外層終端支援)、`NO_COLOR`。

實測(2026-08-22,omp v17.4.2,bun 全域安裝):extension import graph 裡的 `config/settings` instance(package source)與 cli.js bundle 內聯的不是同一個,host 的 `Settings.init()` 不會初始化它,`isSettingsInitialized()` 恆為 false,gate 恆關——**目前此佈局下 widget 行永遠是 plain text**,即使 `tui.hyperlinks: always` 或 `PI_FORCE_HYPERLINKS=1`。TUI 渲染器本身支援 OSC 8(寬度計算 ANSI-aware、逐行關閉 link);若 runtime 讓 extension 共用 host module registry(如 compiled binary),link 會自動生效,不需改程式碼。

## 主要設定

### config.yml:內建 statusline 的 segment 順序與有無

`statusLine` 段(`~/.omp/agent/config.yml`):

- `preset`:內建佈局,`default` / `minimal` / `compact` / `full` / `nerd` / `ascii` / `custom`。只有 `custom` 時 `leftSegments` / `rightSegments` 才生效(其他 preset 會忽略使用者陣列,直接用 preset 值)。
- `leftSegments` / `rightSegments`:**陣列順序即顯示順序**;拿掉某個 id 該段就不顯示;未知 id 靜默忽略(不報錯)。`preset: custom` 但沒給陣列時,回落 `custom` preset 預設(`model,mode,path,git,pr` / `session_name,token_total,cost,context_pct`)。
- `segmentOptions`:逐段細調(選項見下表);不給該段選項時用內建預設。
- `separator`:段間分隔,`powerline-thin`(預設)/ `powerline` / `slash` / `pipe` / `block` / `none` / `ascii`。

有效 id(24 個,左右皆可放):

| id | 顯示內容 |
|---|---|
| `pi` | omp logo + 模式徽章(plan / vibe / goal / loop / prewalk / worktree) |
| `model` | 模型名;`segmentOptions.model.showThinkingLevel: true` 時加思考等級 |
| `mode` | 目前模式 |
| `path` | 專案路徑;選項 `abbreviate`(預設 true)/ `maxLength`(預設 40)/ `stripWorkPrefix`(預設 true) |
| `git` | branch + `*N +N ?N`(unstaged / staged / untracked);選項 `showBranch` / `showStaged` / `showUnstaged` / `showUntracked` |
| `pr` | 目前 PR 編號(無 PR 隱藏) |
| `subagents` | 執行中 subagent 數(0 隱藏) |
| `token_in` / `token_out` / `token_total` | session 累計 input / output / 總 token |
| `token_rate` | 即時 tokens/秒 |
| `cost` | session 花費($) |
| `context_pct` | context 使用 % |
| `context_total` | context window 容量 |
| `time_spent` | session 活躍時間(<1s 隱藏) |
| `time` | 目前時間;選項 `format`(`12h` / `24h`)/ `showSeconds` |
| `session` | session id 前 8 碼 |
| `session_name` | session 名稱 |
| `hostname` | 主機名(不含網域) |
| `cache_read` / `cache_write` | 快取讀 / 寫 token |
| `cache_hit` | 快取命中率 %(0 隱藏) |
| `usage` | provider 配額使用(5h / 7d / 月;無配額資料隱藏) |
| `collab` | collab 角色 + 參與者數(非 collab 隱藏) |

範例(目前配置:左側 `pi → model → mode → collab → context_pct → cost → usage`,右側 `session_name`,model 段開思考等級):

    statusLine:
      preset: custom
      leftSegments:
        - pi
        - model
        - mode
        - collab
        - context_pct
        - cost
        - usage
      rightSegments:
        - session_name
      segmentOptions:
        model:
          showThinkingLevel: true

改順序:重排陣列(如把 `cost` 移到 `context_pct` 前);刪段:拿掉該行(如不要 `usage` 就刪 `- usage`);加段:補 id(如左側加 `hostname`、右側加 `time_spent`)。

### config.yml:停用內建 segments

`path` / `git` / `pr` 需從 `statusLine.leftSegments` 移除,避免與 widget 重複顯示(上方範例已無此三段)。

### 常數(依檔案)

| 常數 | 位置 | 預設 | 作用 |
|---|---|---|---|
| `SEGMENTS` | index.ts | 五段陣列 | 註冊表:順序 = 顯示順序(尾端先縮);拿掉即停用 |
| `SEPARATOR` | index.ts | 兩格空格 | 段間分隔 |
| `ERROR_LOG` | core.ts | `/tmp/another-statusline-errors.log` | 錯誤日誌位置 |
| `WEATHER_LOCATION` | segments/weather.ts | `{ name: "Taipei", lat: 25.033, lon: 121.565 }` | 天氣城市;換成自己城市的 lat/lon。注意:「下個整點」以本機時區計算,而 API 回傳地點時區(`timezone=auto`),兩者不同時會選錯時隙 |
| `WEATHER_LANG` | segments/weather.ts | `"zh"` | 天氣標籤語言:`"zh"` → `🌦️ 15時: 陣雨 26°C 85%`;`"en"` → `🌦️ showers 26°C 85% at 15:00` |
| `WEATHER_REFRESH_MS` | segments/weather.ts | 30 分 | 天氣重取間隔 |
| `WEATHER_MIN_ATTEMPT_MS` | segments/weather.ts | 10 分 | 兩次 HTTP attempt 的最小間隔 |
| `WEATHER_TIMEOUT_MS` | segments/weather.ts | 15 秒 | 單次 fetch 逾時(慢路由上 TLS handshake 就可能 >5 秒) |
| `STOCK_INDEX` | segments/stock.ts | `{ symbol: "^TWII", name: "TAIEX" }` | 股市指數;`symbol` 為 Yahoo 代號,`name` 為顯示用名稱 |
| `STOCK_REFRESH_MS` | segments/stock.ts | 5 分 | 報價重取間隔 |
| `STOCK_MIN_ATTEMPT_MS` | segments/stock.ts | 60 秒 | 兩次 HTTP attempt 的最小間隔 |
| `STOCK_TIMEOUT_MS` | segments/stock.ts | 10 秒 | 單次 fetch 逾時 |
| `ABBREVIATE` / `STRIP_WORK_PREFIX` / 圖示常數 | segments/path.ts 等 | 見原始碼 | 圖示 fallback;主題 `theme.icon.*` 存在時以主題為準 |

git / gh 查詢逾時預設 5000ms(`run` 的 `timeoutMs` 參數)。

## 測試

    bun test plugins/another-statusline

純邏輯均有測試(46 cases):core(寬度 / 截斷 / 分配器)、weather / git / pr / stock 各自的解析器與文字產生器。path 段依賴 `os.tmpdir()`、HOME 等環境,不測;fetch / timer 層不測(由 `bun test` 以外的整合 smoke 驗證)。測試檔不進 tsc(全域無 bun 型別),由 bun test 實跑涵蓋;typecheck:`bunx tsc --noEmit -p plugins/another-statusline`。

## 更新時機

事件驅動:`session_start` / `session_switch` / `turn_end` 各重繪一次(cwd 與 repo 狀態在 OMP 內就會變,事件已足夠)。weather / stock 另有各自的 unref'd timer(refresh 間隔),到期只重抓自己的資料,新資料落地才透過 rerender 重繪整行(git / pr 一併更新)——timer 不再無謂地重跑 git / gh。fetch 不阻塞渲染:widget 先畫(快取空時該段先隱藏),資料到位後即刻重繪補上;每次重繪從快取的時隙(天氣約 48 小時)選出「下個整點」,整點過後自動換下一段,不顯示過去時隙;fetch 失敗保留舊資料(無舊資料則隱藏該段),錯誤只寫 `ERROR_LOG` 不彈通知。

## 未複製的內建行為

extension 拿不到 status-line 專屬 context,故不實作:worktree label、activeRepo 的 ` relativeRepoRoot` 後綴。

## 移除

    omp plugin uninstall another-statusline@omp-extensions

必要時把 `path` / `git` / `pr` 加回 `statusLine.leftSegments`。
