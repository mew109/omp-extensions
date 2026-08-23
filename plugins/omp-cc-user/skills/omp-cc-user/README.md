# omp-cc-user

Manage personal Claude Code™ user resources (`~/.claude`) inside omp: list
personal skills, user plugins, and slash commands, and enable or disable
them in omp.

Entry point: the `/omp-cc-user:omp-cc-user` command (from
`commands/omp-cc-user.md`; marketplace installs prefix plugin commands with
the plugin name) and the `omp-cc-user` skill (`SKILL.md`), both backed by
`scripts/omp_cc_user.py`.

```bash
# usage table
python3 skill://omp-cc-user/scripts/omp_cc_user.py

# examples
python3 skill://omp-cc-user/scripts/omp_cc_user.py skill list
python3 skill://omp-cc-user/scripts/omp_cc_user.py plugin list
python3 skill://omp-cc-user/scripts/omp_cc_user.py command disable setup
```

Full command table: see `SKILL.md`.

The `plugin` resource is a line-by-line port of the former `claude-plugin`
skill, which has been removed; `omp-cc-user` supersedes it.
