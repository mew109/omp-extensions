# omp-cc-user

Manage personal Claude Code™ user resources (`~/.claude`) inside omp: list
personal skills, user plugins, slash commands, and mcp servers, and enable or
disable them.

Entry points:

- `/omp-cc-user:omp-cc-user` — slash command from `commands/omp-cc-user.md`
  (marketplace installs prefix plugin commands with the plugin name)
- the `omp-cc-user` skill (`SKILL.md`)

Both run `scripts/omp_cc_user.py` and relay its output verbatim. The script
edits only `~/.omp/agent/config.yml`; Claude Code™ itself is unaffected.

In an omp session (`skill://` resolves inside omp; from a repo checkout,
call `plugins/omp-cc-user/skills/omp-cc-user/scripts/omp_cc_user.py`
directly):

```bash
# usage table
python3 skill://omp-cc-user/scripts/omp_cc_user.py

# names: one or more per call; fnmatch globs (* ? [) allowed — quote them;
# every name must match at least one item, or nothing is written
python3 skill://omp-cc-user/scripts/omp_cc_user.py skill list
python3 skill://omp-cc-user/scripts/omp_cc_user.py plugin list
python3 skill://omp-cc-user/scripts/omp_cc_user.py command disable setup
python3 skill://omp-cc-user/scripts/omp_cc_user.py plugin disable 'code-*'
python3 skill://omp-cc-user/scripts/omp_cc_user.py skill enable 'ruff' 'ponytail*'
python3 skill://omp-cc-user/scripts/omp_cc_user.py mcp list
```

Full command table and name rules: see `SKILL.md`.
Developer notes: `CONTRIBUTING.md`.
