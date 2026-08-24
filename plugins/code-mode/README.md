# code-mode extension

English | [繁體中文](README-zh-tw.md)

Makes the model work in "code mode": the tools it can call directly are
limited to `eval` / `ask` / `read` / `write`; multi-tool work is written as
code in `eval` (Python/JS kernel), calling tools through the kernel tool
bridge (`tool.<name>(args)`), with loops, parallel calls, and conditionals.
It is a local counterpart of OpenAI / Anthropic Programmatic Tool Calling
(PTC): fewer round trips with the model, and intermediate results stay in
the kernel instead of the model context.

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install code-mode@omp-extensions

(For local development, use the repo path in `marketplace add`.)

## Use

- Start a session in code mode:

      omp --code-mode

- Toggle at runtime:

      /code-mode on
      /code-mode off
      /code-mode          # show current state

- While active, the statusline shows `⌨️ Code Mode`.

## System prompt

While active, a `§ Code Mode` block is appended to the end of the system
prompt, steering the model to write multi-tool work as eval code (tools are
called as `tool.<name>(args)` inside the code; intermediate results stay in
the kernel).

- Fixed text: within one mode state, the effective system prompt is the
  same every turn, so the provider prompt cache stays warm. It changes only
  when the mode toggles (the toggle itself already rebuilds the
  tool-inventory section).
- The block is about 430 characters and does not re-list tools (the model
  can see its tools in the Tool Inventory).

## keep-set

While active, the direct tools are `eval`, `ask`, `read`, `write`:

- `eval`: run code; inside the code, `tool.<name>(args)` calls any session
  tool (read, grep, glob, bash, edit...).
- `read`: read files directly (reading a skill needs `skill://<name>`; a
  single read need not go through eval).
- `ask`: ask the user a question.
- `write`: write files directly (plan mode needs it to write the plan file;
  it is also the fallback for direct writes).
- `off` restores the tool set that was active before the mode was enabled.

> Measured (2026-08-20, omp v17.3.7, probed name by name): `ask` is not in
> the tool registry (not among the 24 registered tools), and
> `setActiveTools` silently ignores unregistered names, so the effective
> active set is `eval`, `read`, `write`. `write` survives (tested
> `["write"]`, `["eval","write"]`, `["eval","ask","write"]` — all kept
> `write`). `ask` still works: tools outside the registry are not governed
> by `setActiveTools`, and the model can still use them; inside `eval`
> code, `tool.<name>` also reaches any session tool.

## Prewalk interaction

Sources: `packages/coding-agent/src/session/prewalk.ts` and
`packages/coding-agent/src/eval/js/tool-bridge.ts` (checked against main
2026-08-20).

- Prewalk's handoff detection scans the turn's tool-result messages and
  recognizes only `edit` / `write` (direct filesystem writes, or `xd://`
  dispatch with tier `write`/`exec`).
- Tool calls inside the eval tool bridge run `tool.execute(...)`
  directly and produce no tool-result messages, so prewalk cannot see
  them.
- Conclusion: **while code mode is on, handoff never fires** (the current
  model runs to the end; it is never switched to a cheaper one).
- A **direct** `write` call (outside the bridge) still triggers handoff.
- Suggested workflow:
  1. `omp --prewalk` (without code mode): the strong model writes the
     plan; the first `edit`/`write` triggers handoff to the cheap model.
  2. After the handoff, `/code-mode on`: the cheap model implements,
     orchestrating in code.
- To let the strong model run to the end, do not arm prewalk.

## Uninstall

    omp plugin uninstall code-mode@omp-extensions
