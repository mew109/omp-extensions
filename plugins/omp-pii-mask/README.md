# omp-pii-mask extension

English | [繁體中文](README-zh-tw.md)

Masks personal information (PII) before it leaves omp for the LLM provider,
then restores it transparently in tool arguments and in assistant replies.
The model works with placeholders like `[EMAIL_1]`; real values never appear
in provider-bound traffic. Forked from
[pi-pii-mask](https://github.com/TheRealStubbornDeveloper/pi-pii-mask)
(by alfrancisgabriel, MIT).

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-pii-mask@omp-extensions

(For local development, use the repo path in `marketplace add`.)

## What gets masked

| Pattern | Matches | Default |
|---|---|---|
| EMAIL | email addresses | on |
| PHONE | phone numbers (3-3-4 digits, optional separators and country code) | **off** |
| SSN | `123-45-6789` | on |
| CC | 16-digit card numbers | on |
| PRIVATE_IP | RFC 1918 IPv4 addresses | on |
| API_KEY_SK | `sk-…`, `sk-ant-…`, `sk-or-v1-…` keys | on |
| API_KEY_GH | `ghp_…` / `gho_…` / `ghu_…` / `ghs_…` / `ghr_…` tokens | on |
| API_KEY_AI | `AIza…` Google API keys | on |
| API_KEY_CF | Cloudflare API tokens | on |
| JWT | JSON Web Tokens (`eyJ…`) | on |
| AWS_KEY | `AKIA…` access key IDs | on |
| CONN_STR | passwords in mongodb / postgres / mysql connection strings | on |

PHONE is off by default because its regex matches every 10-digit run —
Unix timestamps, order numbers, and so on. Turn it on only if you expect
real phone numbers in your traffic.

## How it works

```
 user prompt ──▶ context hook ──▶ masked ──▶ LLM provider
                    │                            │
                    ▼                            ▼
     before_agent_start: system-prompt notice   │
                    │                            ▼
 tool_call hook ◀── placeholders in tool args    │
   (restore real values)                        │
                    │                           ▼
             message_end hook ◀── assistant reply ──▶ restored to the user
                    │
                    ▼
              /pii-map (placeholder → original mapping)
```

- `context` — masks user and tool-result content (and assistant thinking)
  before it is sent to the provider.
- `tool_call` — restores placeholders in tool arguments, so tools run on
  real values.
- `before_agent_start` — appends a system-prompt notice telling the model
  to use placeholders verbatim (added once, marker-guarded).
- `message_end` — restores placeholders in assistant text/thinking, so you
  see real values.
- `/pii-map` — shows the current placeholder → original mapping. In the TUI
  it uses the status surface; headless it prints to stdout.

Masking is per process, in memory only. Nothing is written to disk.

## Settings

Settings are read once at startup — restart omp to apply. A missing or
invalid config file silently falls back to the defaults.

Precedence: environment variable > YAML > default.

| Setting | Environment | YAML key | Default |
|---|---|---|---|
| phone-number masking | `PII_MASK_PHONE` | `phone` | `false` |

`$PII_CODING_AGENT_DIR/pii-mask.yml` (default `~/.omp/agent/pii-mask.yml`):

```yaml
phone: true
```

Environment: `PII_MASK_PHONE=true|false|1|0|yes|no|on|off` (blank or
anything else counts as unset).

## Differences from upstream

- The PHONE pattern is a setting, default off (upstream: always on).
- `/pii-map` uses the omp status surface / stdout instead of pi's
  `ctx.ui.showText`.
- Ported to the omp extension API (omp's `systemPrompt` is an array of
  blocks; `message_end` is notification-only, so the restore mutates the
  message snapshot).

## Scope

Only provider-bound traffic is masked. Text inside the terminal, session
files, and tool output on disk still contains whatever the tools produced.

## License

MIT — upstream © alfrancisgabriel; this port under the repo LICENSE.
