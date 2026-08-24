# Contributing to omp-cc-user

English | [繁體中文](CONTRIBUTING-zh-tw.md)

## Layout

- `skills/omp-cc-user/scripts/omp_cc_user.py` — all logic (stdlib + PyYAML)
- `skills/omp-cc-user/SKILL.md` — model-facing docs: command table, name rules
- `commands/omp-cc-user.md` — slash-command wrapper; forwards `$ARGUMENTS` to the script

## Release

The version lives in two places; bump both:

- `package.json`
- `../../.omp-plugin/marketplace.json` (repo root `.omp-plugin/`)

## History

The `plugin` resource was ported from the former `claude-plugin` skill,
which this plugin replaced. The code has since diverged (multi-name and
glob handling), so it is no longer a line-by-line match.

## Verifying changes

No test suite. Run the script against a sandbox HOME — it expands `~` at
import time, so exporting `HOME` is enough; your real `~/.claude` and
`~/.omp` stay untouched. Requires PyYAML; without it use
`uv run --with pyyaml python3 <script> ...`.

```bash
SBOX=$(mktemp -d); export HOME=$SBOX
mkdir -p $SBOX/.claude/plugins $SBOX/.claude/skills/foo $SBOX/.claude/skills/bar \
         $SBOX/.claude/commands/sub $SBOX/.omp/agent
for s in foo bar; do printf -- '---\nname: %s\n---\ndesc\n' $s > $SBOX/.claude/skills/$s/SKILL.md; done
echo '# c' > $SBOX/.claude/commands/setup.md
echo '# c' > $SBOX/.claude/commands/sub/x.md
mk() { mkdir -p "$1/skills/$2"; printf -- '---\nname: %s\n---\nd\n' "$2" > "$1/skills/$2/SKILL.md"; mkdir -p "$1/commands"; echo '# c' > "$1/commands/$2.md"; }
mk $SBOX/p1 code-mode; mk $SBOX/p2 b; mk $SBOX/p3 a
cat > $SBOX/.claude/plugins/installed_plugins.json <<EOF
{"plugins": {
  "code-mode@omp-extensions": [{"installPath": "$SBOX/p1"}],
  "b@market": [{"installPath": "$SBOX/p2"}],
  "a@market": [{"installPath": "$SBOX/p3"}]
}}
EOF

SCRIPT=plugins/omp-cc-user/skills/omp-cc-user/scripts/omp_cc_user.py
python3 $SCRIPT plugin disable 'code-*' b   # multi-name + glob
python3 $SCRIPT skill disable '*' nosuch    # fail-fast: nothing written
python3 $SCRIPT command disable 'sub:*'     # one file, both its ids
```
