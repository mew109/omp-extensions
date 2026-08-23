# code-mode extension

讓模型以「code mode」工作:模型可直接呼叫的工具限為 `eval` / `ask` / `read` / `write`,多步工具操作改寫在 `eval`(Python/JS kernel)的程式碼裡,由 kernel 的 tool bridge(`tool.<name>(args)`)呼叫工具,可迴圈、並列、條件判斷。這是 OpenAI / Anthropic Programmatic Tool Calling(PTC)的本地對應:減少與模型的 round trip,中間結果留在 kernel、不進模型 context。

## 安裝

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install code-mode@omp-extensions

(本機開發時,`marketplace add` 改用 repo 路徑。)

## 使用

- 直接以 code mode 開始 session:

      omp --code-mode

- 執行中切換:

      /code-mode on
      /code-mode off
      /code-mode          # 顯示目前狀態

- 啟用時,狀態列顯示 `⌨️ Code Mode`。

## 系統提示

啟用時,system prompt 結尾追加一個 `§ Code Mode` block,引導模型把多步工具操作寫成 `eval` 程式碼(程式碼內以 `tool.<name>(args)` 呼叫工具、中間結果留在 kernel)。

- 固定文字:同一 mode 狀態下,每個 turn 的 effective system prompt 相同,provider 的 prompt cache 維持。只在 on/off 切換時改變(切換本身已觸發 tool-inventory 段落重組)。
- block 約 430 字元、不重列工具(模型可在 Tool Inventory 看到自己可用的工具)。

## keep-set

啟用時 active 工具為 `eval`、`ask`、`read`、`write`:

- `eval`:執行程式碼;程式碼內 `tool.<name>(args)` 可呼叫任何 session 工具(read、grep、glob、bash、edit...)。
- `read`:直接讀檔(讀 skill 需要 `skill://<name>`,單次讀檔也不必繞道 eval)。
- `ask`:向使用者提問。
- `write`:直接寫檔(plan mode 寫 plan 檔需要,也是直接寫檔的 fallback)。
- `off` 時還原啟用前的 active 工具集。

> 實際行為(2026-08-20 驗證,omp v17.3.7,以逐名 probe 確認):`ask` 不在 tool registry(24 個註冊工具中無 `ask`),`setActiveTools` 對未註冊名稱靜默忽略,故啟用後 active 集實為 `eval`、`read`、`write`。`write` 可正常保留(逐項測試 `["write"]`、`["eval","write"]`、`["eval","ask","write"]` 結果均含 `write`)。`ask` 不受影響:非 registry 管理的工具不由 `setActiveTools` 控制,模型仍可用;`eval` 程式碼內的 `tool.<name>` 也可呼叫任何 session 工具。

## 與 prewalk 的相容性

來源:`packages/coding-agent/src/session/prewalk.ts` 與 `packages/coding-agent/src/eval/js/tool-bridge.ts`(2026-08-20 對 main 驗證)。

- prewalk 的 handoff 偵測掃描該 turn 的工具結果訊息,只認 `edit` / `write`(直接寫 filesystem,或 `xd://` dispatch 且 tier 為 `write`/`exec`)。
- `eval` tool bridge 內的工具呼叫直接走 `tool.execute(...)`,不產生工具結果訊息,prewalk 看不到。
- 結論:**code mode 啟用期間,handoff 不會觸發**(目前執行的模型會一直跑到底,不會切到便宜模型)。
- **直接** `write` 呼叫(不走 bridge)仍會觸發 handoff。
- 建議工作流:
  1. `omp --prewalk`(不啟用 code mode):強模型寫 plan,第一個 `edit`/`write` 觸發 handoff 到便宜模型。
  2. handoff 後再 `/code-mode on`:便宜模型用程式碼 orchestrate 實作。
- 若想讓強模型一路跑到底,就不要 arm prewalk。

## 移除

    omp plugin uninstall code-mode@omp-extensions
