# omp-cc-user

English | [繁體中文](README-zh-tw.md)

Control which personal `~/.claude` resources omp shows: personal skills,
user plugins, slash commands, and MCP servers. `list` only reads your
config; `enable` / `disable` write one key — `disabledExtensions` in
`~/.omp/agent/config.yml`. Claude Code itself is unaffected.

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install omp-cc-user@omp-extensions

(For local development, use the repo path in `marketplace add`.)

## Use

Two entry points run the same script and relay its output verbatim:

- the slash command `/omp-cc-user:omp-cc-user <args>` (marketplace installs
  prefix plugin commands with the plugin name)
- the `omp-cc-user` skill:

```bash
python3 skill://omp-cc-user/scripts/omp_cc_user.py <args>
```

From a repo checkout, call
`plugins/omp-cc-user/skills/omp-cc-user/scripts/omp_cc_user.py` directly.
No args prints the usage table.

### Resources

| Resource | Manages | Notes |
|---|---|---|
| `skill` | dirs under `~/.claude/skills` | state comes from `disabledExtensions` plus the legacy `skills.ignoredSkills` key |
| `plugin` | entries in `~/.claude/plugins/installed_plugins.json` | one name toggles every resource the plugin ships: skills, slash commands, hooks, and `mcp:<plugin>:<server>` ids |
| `command` | `*.md` under `~/.claude/commands` | a file in a subdir lists all its ids, e.g. `sub:x` |
| `mcp` | user-level servers in `~/.claude.json`, else `~/.claude/mcp.json` | first file with at least one server wins — omp's rule. A server with `enabled: false` lists as off; omp keeps skipping it even after `mcp enable` |

Each resource takes `list`, `disable <name...>`, and `enable <name...>`.

### Name rules

- One or more names per call; fnmatch globs (`* ? [`) allowed — quote them
  so the shell passes them through.
- Every name must match at least one item, or nothing is written
  (fail-fast: no partial writes).
- Plugin names: exact key (`name@market`), or the short name `name` when it
  is unique; globs match both forms. A short name used by two marketplaces
  is an error until you spell out the key.
- A resource name shared with another plugin's resource is toggled too —
  disable works on ids, not on files.

After `enable` / `disable`, run `/reload-plugins` (or restart omp) to apply.

## Uninstall

    omp plugin uninstall omp-cc-user@omp-extensions

## Development

File layout, version bump, and sandbox verification:
[CONTRIBUTING.md](CONTRIBUTING.md).
