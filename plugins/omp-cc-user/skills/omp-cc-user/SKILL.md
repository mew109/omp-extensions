---
disable-model-invocation: true
name: omp-cc-user
description: >-
  Manage personal Claude Code™ user resources (~/.claude) inside omp — list
  personal skills, user plugins and slash commands and enable or disable
  them in omp. Triggers on "omp cc user", "/omp-cc-user:omp-cc-user",
  "enable/disable personal skill, plugin or command in omp".
---

# omp-cc-user

Control which personal `~/.claude` resources are visible in omp.

| Command | Effect |
|---|---|
| `/omp-cc-user:omp-cc-user` | Show this usage table |
| `/omp-cc-user:omp-cc-user skill list` | List personal skills and their omp state |
| `/omp-cc-user:omp-cc-user skill enable <name>` | Make a personal skill visible in omp |
| `/omp-cc-user:omp-cc-user skill disable <name>` | Ignore a personal skill in omp |
| `/omp-cc-user:omp-cc-user plugin list` | List user plugins with resources and states |
| `/omp-cc-user:omp-cc-user plugin enable <name>` | Make a plugin's resources visible in omp |
| `/omp-cc-user:omp-cc-user plugin disable <name>` | Ignore a plugin's resources in omp |
| `/omp-cc-user:omp-cc-user command list` | List ~/.claude/commands slash commands and their omp state |
| `/omp-cc-user:omp-cc-user command enable <name>` | Make a personal slash command visible in omp |
| `/omp-cc-user:omp-cc-user command disable <name>` | Ignore a personal slash command in omp |

Run via bash, then relay the script output verbatim to the user — no interpretation needed:


```bash
python3 skill://omp-cc-user/scripts/omp_cc_user.py <args>
```

With no args or unknown args, print the usage table above.

Note: plugin entries match by name; a name shared with another plugin's
resource is toggled too.
