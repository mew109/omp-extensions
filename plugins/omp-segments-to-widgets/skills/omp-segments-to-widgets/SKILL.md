---
name: omp-segments-to-widgets
description: "Use when moving OMP status-line segments into safe, width-aware extension widgets."
---

# Move OMP Status-Line Segments into Widgets

Use this procedure when a built-in OMP status-line segment takes too much horizontal space and should appear as a widget instead.

## Core limitation

OMP custom status-line segments accept only built-in segment IDs. An extension cannot register a new status-line segment or directly reuse the private renderer for a built-in segment. Implement the widget as an extension and remove the segment from `statusLine.leftSegments` or `statusLine.rightSegments`.

## Widget API

Use the extension UI API:

```ts
ctx.ui.setWidget("stable-key", ["text"], {
  placement: "belowEditor",
});
```

- `placement` is `aboveEditor` or `belowEditor`.
- `content` accepts a string array, a component factory, or `undefined` to remove the widget.
- String-array widgets are limited to 10 lines.
- Use a stable key so refreshes update the same widget instead of adding duplicates.

For background refreshes, use `ctx.setInterval()` and `ctx.clearTimer()`. Do not use an unguarded global timer: extension timer failures can terminate the session.

## Implementing a segment replacement

1. Read the active config with `omp config list` and inspect `~/.omp/agent/config.yml`.
2. Confirm the exact segment behavior to preserve. For `git`, this includes branch state and staged, unstaged, and untracked counts. For `path`, this includes home-directory shortening, work-prefix stripping, and maximum length. For `pr`, preserve the number and hyperlink when available.
3. Create a user extension under `~/.omp/agent/extensions/`.
4. Guard terminal-only rendering with `ctx.hasUI === true`.
5. Use `pi.exec(command, args, { cwd, timeout })` for external state. Check the exit code and hide only the failed segment or widget data; do not display stale data after a failed refresh.
6. Refresh on `session_start` and `session_switch`; refresh after `turn_end` when the displayed value can change during a turn.
7. Add a short interval refresh only when the data can change outside OMP. Prevent overlapping refreshes with a per-widget `refreshing` flag.
8. Store one widget state per session and clear its timer on `session_shutdown`.
9. Use `belowEditor` when the widget should sit below the input area and keep the status line compact.
10. Remove the original segment from the status-line list and add the extension path to the global `extensions` array.

## Width budgeting

When multiple segments share one line, calculate the visible text width before adding terminal hyperlink escape sequences. Keep separators in the budget.

Use explicit per-segment limits:

- maximum length controls normal display;
- minimum length controls the first shrinking pass;
- define a path minimum even when it is currently zero, so later policy changes do not require a new allocator design.

Shrink from the rightmost segment toward the left. A typical order is:

1. rightmost PR segment to its minimum;
2. next segment, such as git status, to its minimum;
3. path until the line fits;
4. if the terminal is narrower than all configured minimums, continue shrinking from the right so the line still fits.

Apply truncation before wrapping a PR label in an OSC 8 hyperlink. The hyperlink wrapper must not change the logical width used by the allocator. Use a visible truncation marker so shortened text is clear.

## Git replacement pattern

Run:

```text
git status --porcelain=v1 --branch
```

Parse the `## ` header for the branch. Count each changed entry by its porcelain XY columns:

- non-space first column: staged
- non-space second column: unstaged
- `?? `: untracked

Render a compact line such as:

```text
⎇ feature/name  +2 ~1 ?3
```

Do not show a stale value when the repository command fails. Clear the widget instead.

## PR replacement pattern

Use the repository's existing PR lookup behavior where possible. A simple extension fallback is:

```text
gh pr view --json number,url
```

Treat a non-zero exit, invalid JSON, missing number, or missing URL as no PR. Wrap the visible label in an OSC 8 hyperlink only after width truncation. Keep the lookup timeout short so a missing GitHub login or non-Git directory does not block widget refresh.

## Path replacement pattern

Start with `ctx.cwd`. Apply the same user-facing policy as the prior status-line configuration:

- replace the home directory with `~`;
- strip configured workspace prefixes when appropriate;
- keep the rightmost path portion when the result exceeds the configured maximum length;
- use a visible truncation marker so the result is not mistaken for the full path.

Keep the path widget to one line. Do not expose credentials or unrelated absolute paths.

## Failure containment and diagnostics

A widget must not turn a refresh failure into an OMP crash or unhandled rejection.

- Put external commands, parsing, width calculation, and `setWidget` inside a `try/catch/finally`; always clear `refreshing` in `finally`.
- Every fire-and-forget call such as `void refresh(state)` must attach `.catch(...)`, including calls from timers, session events, and initial startup. A `try/catch` around the call does not catch a later rejected promise.
- Guard synchronous session event handlers as well, because UI cleanup and session state access can throw.
- Log the full stack trace to a fixed file under `/tmp`, for example `/tmp/second-statusline-errors.log`, and show only the short error message plus the file path. Append rather than overwrite so repeated failures remain available.
- If the log write fails, show only the short error message. Error reporting must never throw or create a second unhandled rejection.
- Keep error reporting synchronous and dependency-free. `appendFileSync` is suitable for this small diagnostic path.

## Widget ordering

OMP stores widgets in a `Map` per placement. Display order is insertion order:

- a new key is appended;
- updating an existing key keeps its position;
- removing and re-adding a key moves it to the end;
- `aboveEditor` and `belowEditor` have separate orders.

Choose stable keys and register/update widgets in the desired order. Do not rely on alphabetical key sorting.

## Configuration and verification

After editing the config, verify:

```bash
omp config list
omp config get statusLine.leftSegments --json
omp config get statusLine.rightSegments --json
omp config get extensions --json
```

Run a headless load smoke test to catch extension syntax and startup errors:

```bash
omp --no-session --no-title --max-time 8 -p 'Reply with exactly OK.'
```

Then run the actual interactive OMP in a Git repository and confirm all of the following:

- the original segment no longer appears in the status line;
- the replacement widget appears in the intended location;
- the widget shows current data;
- a changed file or branch state updates the widget;
- a PR label links to the expected URL when a PR exists;
- a failed command does not show stale data or crash OMP;
- a stack trace goes to the diagnostic file, and a log-write failure falls back to the short message;
- no duplicate widgets appear after repeated refreshes;
- the session exits cleanly.

Restart existing OMP sessions after changing global config because a running process may retain the old status-line and extension configuration.
