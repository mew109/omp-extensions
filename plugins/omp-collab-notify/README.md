# omp-collab-notify

English | [繁體中文](README-zh-tw.md)

Send a Telegram message when a `/collab` room opens, with the new room links. Optionally re-open a fresh room when the relay kills the current one, and notify the new links. Also ships `/collab-keepalive`, which keeps a room alive with a pinging read-only guest.

TUI only. Requires `collab.relayUrl` to be configured (or passed to `/collab`). The plugin targets omp's current `/collab` internals and may need updates on major omp bumps.

## Config

Copy this to `~/.omp/agent/omp-collab-notify.yml` (or `$PI_CODING_AGENT_DIR/omp-collab-notify.yml`):

```yaml
telegram:
  botToken: ""           # e.g. "123456789:AA..." — from @BotFather
  chatId: ""             # e.g. "123456789" (negative number for group chats)
collab:
  notify: true           # send Telegram notifications for new rooms
  autoRehost: true       # re-open a fresh room when the relay kills the current one
  rehostRetries: 2       # extra start attempts after the first rehost try
  rehostDelaySeconds: 5  # pause between rehost attempts
```

The env vars `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` win over the YAML. omp loads `~/.omp/agent/.env` automatically, so that file is a good place for them. Blank values (env or YAML) count as unset. Config changes take effect without a restart.

| Option | Default | Meaning |
|---|---|---|
| `collab.notify` | `true` | Notification switch. `false` silences every Telegram send and the unconfigured warning. |
| `collab.autoRehost` | `true` | Re-open a fresh room when the relay kills the current one. Independent of `notify`. |
| `collab.rehostRetries` | `2` | Extra start attempts after the first rehost try. |
| `collab.rehostDelaySeconds` | `5` | Pause between rehost attempts. |

## Telegram bot setup

1. Message `@BotFather` in Telegram, run `/newbot`, follow the prompts, copy the token (`123456789:AA...`).
2. Send any message (or press Start) to your new bot. Bots cannot read `getUpdates` for users who never messaged them.
3. Get the chat ID:

       curl "https://api.telegram.org/bot<TOKEN>/getUpdates"

   and read `result[].message.chat.id`. For a group chat, add the bot to the group, post once, use the negative group id. `@userinfobot` is an alternative.

## Keep a room alive (`/collab-keepalive`)

Joins the room as a read-only guest named `keepalive` and pings the relay every 60 s ± 10 s, so the relay / Cloudflare idle timeout never closes the room. The guest shows up in the host's participant list but never writes — the write token is never sent, even for full links.

    /collab-keepalive <link>
    /collab-keepalive <link> --interval 30000 --jitter 5000 --name my-keeper
    /collab-keepalive stop <link|roomId|all>
    /collab-keepalive status [link|roomId]

- `<link>`: the web link (`https://my.omp.sh/#<id>.<key>`), `my.omp.sh/#<id>.<key>`, a bare `<id>.<key>`, or a `ws(s)://` relay URL. `stop` / `status` also accept a bare `<roomId>`; `stop all` stops every keeper.
- Flags are in milliseconds: `--interval` (default 60000), `--jitter` (default 10000), `--name` (default `keepalive`, trimmed to 64 chars).
- Files: `${TMPDIR}/omp-collab-keepalive-<roomId>.pid` (mode 600) and `.log` (one line per event: joins, pings, closes).
- Close-code policy: 4001 (host closed the room) → exit 0; 4004 (no such room) → retry up to 5 times, then give up; 4009 → exit; 4029 and anything else → reconnect with a 1–30 s randomized backoff.
- The link is passed to the detached daemon in its environment, never on the command line, so it does not show up in `ps` output.
- `OMP_COLLAB_KEEPALIVE_BUN` overrides the `bun` binary used to spawn the daemon (default: `bun` from `PATH`).
- Standalone, no omp needed: `bun keepalive.ts start '<link>'` — same CLI as the slash command.

## Behavior

- A Telegram message with the web + terminal links is sent when a room opens (`/collab`, `/collab start`, `/collab view`). View-only rooms use the read-only links.
- If a notification is due while `telegram.botToken` / `telegram.chatId` are unset, a TUI warning reminds you to configure them.
- Auto-rehost: when the relay kills the room without user action (fatal closes — host conflict, room closed / full / no such room), the plugin re-opens a fresh writable room (new link) and Telegram receives the new links. After `1 + rehostRetries` failed attempts a failure message is sent instead. Never triggers on `/collab stop`, session switch, or app exit.
- Guest mode (`/join`) never notifies.

## Switching in a running session

There is no in-session slash command. The config file is re-read on every notification and every loss poll, so editing it takes effect on the next event — no restart needed:

    # in another terminal, while the session keeps running
    ${EDITOR:-vi} ~/.omp/agent/omp-collab-notify.yml

- `collab.notify: false` — the next room-open (or rehost) produces no Telegram message and no unconfigured warning. Set it back to `true` to re-enable.
- `collab.autoRehost: false` — a relay-aborted room is no longer re-opened; notifications keep working.
- Env vars (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`) are read at process start; changing them requires restarting omp.

## Install

    omp plugin install omp-collab-notify@omp-extensions
