# another-statusline extension
[English](README.md) | 繁體中文

將內建狀態列的 `path`、`git`、`pr` 三段合併成一個 widget(另加 Open-Meteo 天氣段與 Yahoo 股市段),顯示在編輯器下方。前三段**改寫自 omp 內建渲染器**(path = mpi、git = cpi、pr = dpi;格式與縮排策略於 2026-08 對照已安裝的 @oh-my-pi/pi-coding-agent bundle 驗證);weather 與 stock 為本擴充自製。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 顯示

各段以兩格空格分隔,順序由設定檔 `segments` 決定(無設定檔時用 `index.ts` 的 `SEGMENTS` 預設:`path` → `git` → `pr` → `weather` → `stock`;最尾端的段最先縮):

- **path**:folder 圖示 + 路徑。
  - scratch 路徑(`os.tmpdir()`、`~/tmp`,Windows 另含 TEMP / TMP / SystemRoot\Temp):顯示相對路徑,換用 scratch 圖示。
  - work 前綴(`~/Projects`、`/work`):去掉前綴。
  - home 縮成 `~`(只匹配完整 path component)。
  - 過長時保留右側(路徑尾端)。
- **git**:`git status --porcelain=v1 --branch` → `<branch-icon> <branch> *N +N ?N`(N = unstaged / staged / untracked;0 值省略;無 branch 只剩計數)。
- **pr**:`gh pr view --json number,url` → `<pr-icon> #<number>`,hyperlink 指向 PR(目前佈局下 link 實際不輸出,見「hyperlink(OSC 8)」)。
- **weather**:Open-Meteo API(無 key),顯示**下個整點**的預報:
  - `weather.lang: zh`(預設):`<emoji> <H>時: <天氣> <溫度>°C <降雨機率>%`
  - `weather.lang: en`:`<emoji> <weather> <temp>°C <rain>% at <H>:00`(小時移到句尾)
  - `H` = 該整點的小時(24 小時制、不補零);降雨機率為該時隙的值,API 無機率資料時省略;未知 WMO code 省略天氣標籤。
  - 英文標籤較長,weather 段 max 已放寬到 39 cells,容納最長組合(`freezing drizzle` + `100%`)仍不截斷。
- **stock**:Yahoo Finance chart API(無 key):
  - 格式 `<emoji> <指數名> <指數> <方向> <漲跌> <幅度>%`;emoji 與方向隨漲跌(📈▲ / 📉▼ / ➖─)。
  - 漲跌與幅度帶 +/− 號、千分位、小數兩位;基準為前一交易日收盤,盤中為最新價。
  - 當天(交易所時區)尚未成交——週末、假日或開盤前——只顯示 `💤 <指數名> <指數>`,不顯示漲跌(最近成交日非今日)。

非 git repo、無 PR、無天氣、無股市資料時該段不顯示(path 恆有);各段皆無時 widget 清空。

## 寬度

整行必須塞進一列:超寬時從最右段(`SEGMENTS` 尾端)開始縮,先縮到該段 min,再低於 min(下限 1)繼續往右縮,直到放得下。各段 cell 預算(max / min 定義在各 segment 檔):

寬度預算保留 2 cells 給 widget 每行自身的 padding——omp 把每行 `setWidget` 內容包在 `Text(line, 1, 0)` 裡,內容區為 `columns − 2`(`tui.tight` 會拿掉 padding,該設定下只是多出 2 cells 餘裕)。寬度以 grapheme cluster 為單位、用 `Bun.stringWidth` 計算——與 renderer 換行的引擎相同:emoji + VS16 = 2 cells、`⛅`/`➖` = 2、tab = 3。此修正解決低估寬度導致窄終端上整行換到第二列的問題。

    path     max 40  min 24   (segments/path.ts,保留右側)
    git      max 36  min 20   (segments/git.ts)
    pr       max 30  min 10   (segments/pr.ts)
    weather  max 39  min 20   (segments/weather.ts)
    stock    max 38  min 20   (segments/stock.ts)

若 OSC 8 實際輸出,hyperlink 在縮排完成後才包上:若先包,寬度計算會把 escape 字元當成可見 cell,壞掉分配。

## hyperlink(OSC 8)

path 段以官方 `fileHyperlink`、pr 與 stock 段以 `urlHyperlink` 包(由 index.ts 統一處理,segment 只回報 `href`)。是否真的輸出 OSC 8 由 `isHyperlinkEnabled()` 決定:`tui.hyperlinks` 設定(預設 auto)、終端能力偵測(kitty / ghostty / wezterm / iTerm / vscode / alacritty,或 tmux ≥ 3.4 且外層終端支援)、`NO_COLOR`。

實測(2026-08-22,omp v17.4.2,bun 全域安裝):extension import graph 裡的 `config/settings` instance(package source)與 cli.js bundle 內聯的不是同一個,host 的 `Settings.init()` 不會初始化它,`isSettingsInitialized()` 恆為 false,gate 恆關——**目前此佈局下 widget 行永遠是 plain text**,即使 `tui.hyperlinks: always` 或 `PI_FORCE_HYPERLINKS=1`。TUI 渲染器本身支援 OSC 8(寬度計算 ANSI-aware、逐行關閉 link);若 runtime 讓 extension 共用 host module registry(如 compiled binary),link 會自動生效,不需改程式碼。

## 設定

### another-statusline.yml(本擴充)

不動原始碼即可自訂 segment 順序、每段寬度與天氣 / 股票標的。設定檔:

    $PI_CODING_AGENT_DIR/another-statusline.yml
    (未設環境變數時:~/.omp/agent/another-statusline.yml)

YAML(JSON 亦合法),schema 模仿 omp 內建 `statusLine`:

    segments: [path, git, pr, weather, stock]   # 順序 = 顯示順序(最尾端先縮)
    segmentOptions:
      path: { max: 40, min: 10 }
      git: { max: 30, min: 8 }
    weather:
      location: Tokyo        # 地名;自動轉座標
      lang: zh               # 標籤語言:zh / en
    stock:
      symbol: ^TWII          # Yahoo 代號
      name: TAIEX            # 顯示名稱(可省)

語義:

- `segments`:**整份取代** —— 列出的才顯示、順序照列表;不列出的即隱藏(這就是關閉某段的方法);未知 id 忽略並記 log;空陣列或缺 `segments` → 內建預設全列表。id 即「顯示」一節的五段:`path` / `git` / `pr` / `weather` / `stock`。
- `segmentOptions.<id>.max` / `min`:正整數(≥1),合併後需 min ≤ max;單一欄位無效則忽略該欄位用內建值;min > max 則該段 max / min 全用內建值。無對應 segment 的 key 忽略。
- `weather.location`:天氣城市,以**地名**設定(預設 `Taipei`)。地名經 Open-Meteo 的 geocoding API 轉座標 —— 與預報同一家、免 key —— `count=1`(取 geocoder 首選);每地名一筆結果在 process 生命週期內快取,預設城市內建座標、不會呼叫 geocoder。geocode 失敗(查無地名、網路錯誤)時該段隱藏並記一行錯誤。
- `weather.lang`:標籤語言,`zh` 或 `en`(預設 `zh`);比對前先 trim、不分大小寫,其他值一律丟棄回落。
- `stock.symbol` / `stock.name`:Yahoo 代號與顯示名稱(預設 `^TWII` / `TAIEX`)。自訂 symbol 未給 `name` 時以 symbol 自身顯示(如 `7203.T`);預設維持 `TAIEX`。
- 環境變數逐 key 蓋過設定檔,設定檔再蓋過內建(**env > YAML > 內建**):`ANOTHER_WEATHER_LOCATION`、`ANOTHER_WEATHER_LANG`、`ANOTHER_STOCK_SYMBOL`、`ANOTHER_STOCK_NAME`。空白字串視同未設;值會 trim。
- **存檔即生效**:每次重繪(session_start / session_switch / turn_end / 終端寬度變更 / 背景資料落地)重新讀檔,不用重啟。location / symbol 變更會丟掉快取,新目標資料落地前該段先隱藏(絕不顯示舊城市 / 舊指數);前一次失敗剛發生時,重抓仍受 attempt 間隔下限節流(天氣 10 分、股票 60 秒)。
- 檔案不存在 → 靜默用預設。讀取失敗(非不存在)或解析失敗 → 用預設 + 記 OS tmp dir(`os.tmpdir()`)下的錯誤 log `another-statusline-errors.log` + 每進程一次錯誤通知。
- 天氣 / 股票的背景輪詢不受 `segments` 過濾影響:維持全部啟動(資料保溫,重新啟用零延遲)。

「下個整點」以本機時區計算,而 API 回傳地點時區(`timezone=auto`),城市不在本機時區時可能選錯時隙。

各段預設寬度見「寬度」一節的表;`segmentOptions` 覆蓋之。

### config.yml:內建 statusline

安裝本擴充後,`path` / `git` / `pr` 需從內建 statusline 的 `leftSegments` 移除,避免與 widget 重複顯示(唯一與本擴充相關的一步)。

以下為 omp 內建 statusline 的一般設定法,**與本擴充無關**,僅供調整內建列時參考。`~/.omp/agent/config.yml` 的 `statusLine` 段:

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

範例(目前配置:左側 `pi → model → mode → collab → context_pct → cost → usage`,右側 `session_name`,model 段開思考等級;`path` / `git` / `pr` 已拿掉——這三段由本擴充的 widget 顯示):

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

## 移除

    omp plugin uninstall another-statusline@omp-extensions

必要時把 `path` / `git` / `pr` 加回 `statusLine.leftSegments`。

## 開發

檔案結構、新增 segment、原始碼常數、測試與重繪時機見 [CONTRIBUTING-zh-tw.md](CONTRIBUTING-zh-tw.md)。
