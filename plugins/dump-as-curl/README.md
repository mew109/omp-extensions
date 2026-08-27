# dump-as-curl extension

English | [繁體中文](README-zh-tw.md)

Dumps the last LLM request omp sent — URL, headers, verbatim body — as a
single executable shell script that replays it with `curl`. Like the
built-in `/dump`, but the output is a ready-to-run curl command: use it to
inspect or replay requests against local llama.cpp / OpenAI-compatible
endpoints and remote providers alike.

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install dump-as-curl@omp-extensions

(For local development, use the repo path in `marketplace add`.)

## Use

    /dump-as-curl [--index N] [--filename FILE] [--help]

| Flag | Meaning |
|---|---|
| `--index N` | which capture to dump: 1 = newest (default 1; the last 8 are kept) |
| `--filename FILE` | output file: a bare name goes to the OS tmp dir; a path with `/` resolves against the cwd |
| `--no-redact` | keep the original Authorization: Bearer token (default: replaced with `Bearer <REDACTED>`) |
| `--help` | show help |

Examples:

- `/dump-as-curl` — newest request → `omp-llm-request-curl-*.sh` in the
  OS tmp dir
- `/dump-as-curl --index 3` — the third-newest request
- `/dump-as-curl --filename req.sh` — `<tmp dir>/req.sh`
- `/dump-as-curl --filename ./req.sh` — `<cwd>/req.sh`

After each run the output path is shown in the status line (headless
mode: stdout). The file is written with mode 0700.

## How it works

The extension wraps `globalThis.fetch` in-process. Every POST whose URL
path matches an LLM endpoint is recorded (ordered headers, byte-exact
body) into a ring of the last 8 requests, capped at 16 MiB per body.
Endpoint patterns:

- `/v1/messages` — Anthropic
- `/completion` — completions, chat/completions, llama.cpp `/completion`
- `/v1/responses` — OpenAI Responses
- `generatecontent` — Gemini and Vertex
- `/api/chat` — Ollama
- `/api/generate` — Ollama
- `/converse` — Bedrock

## Security

By default the dumped script replaces the Authorization: Bearer token with
`Bearer <REDACTED>` — the redacted file is for reading, not replaying; pass
`--no-redact` to get a replayable script.
The script contains Authorization headers and the raw conversation
context, so treat the file like an API key: keep mode 0700, replay it,
then delete it. The ring lives in memory for the process lifetime.

## Limitations

- Requests via `providers.openaiWebsockets` are not captured (WebSocket,
  not fetch).
- Nothing is captured before the first LLM call of the process.
- Side requests (title generation, advisors, subagents, web-search LLMs)
  share the ring — use `--index` to reach earlier ones.
- ACP clients may not surface the status message; the file is still
  written — check the tmp dir.

## Uninstall

    omp plugin uninstall dump-as-curl@omp-extensions
