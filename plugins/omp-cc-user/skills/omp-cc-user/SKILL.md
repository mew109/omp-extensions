---
disable-model-invocation: true
name: omp-cc-user
description: >-
  Manage personal Claude Code™ user resources (~/.claude) inside omp — list
  personal skills, user plugins, slash commands and mcp servers and enable or
  disable them in omp. Triggers on "omp cc user", "/omp-cc-user:omp-cc-user",
  "enable/disable personal skill, plugin, command or mcp server in omp".
---

# omp-cc-user

Control which personal `~/.claude` resources are visible in omp.

| Command | Effect |
|---|---|
| `/omp-cc-user:omp-cc-user` | Show this usage table |
| `/omp-cc-user:omp-cc-user skill list` | List personal skills and their omp state |
| `/omp-cc-user:omp-cc-user skill enable <name...>` | Make matching personal skills visible in omp |
| `/omp-cc-user:omp-cc-user skill disable <name...>` | Ignore matching personal skills in omp |
| `/omp-cc-user:omp-cc-user plugin list` | List user plugins with resources and states |
| `/omp-cc-user:omp-cc-user plugin enable <name...>` | Make matching plugins' resources visible in omp |
| `/omp-cc-user:omp-cc-user plugin disable <name...>` | Ignore matching plugins' resources in omp |
| `/omp-cc-user:omp-cc-user command list` | List ~/.claude/commands slash commands and their omp state |
| `/omp-cc-user:omp-cc-user command enable <name...>` | Make matching personal slash commands visible in omp |
| `/omp-cc-user:omp-cc-user command disable <name...>` | Ignore matching personal slash commands in omp |
| `/omp-cc-user:omp-cc-user mcp list` | List ~/.claude mcp servers and their omp state |
| `/omp-cc-user:omp-cc-user mcp enable <name...>` | Make matching mcp servers visible in omp |
| `/omp-cc-user:omp-cc-user mcp disable <name...>` | Ignore matching mcp servers in omp |

Names: one or more per call, fnmatch globs (`* ? [`) allowed — quote globs
so the shell passes them through, e.g. `plugin disable 'code-*'`. Every
name must match at least one item or nothing is written.

Run via bash, then relay the script output verbatim to the user — no interpretation needed:

```bash
python3 skill://omp-cc-user/scripts/omp_cc_user.py <args>
```

With no args or unknown args, print the usage table above.

Note: plugin entries match by name; a name shared with another plugin's
resource is toggled too.
