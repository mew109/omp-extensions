# omp-cc-user 開發指南

[English](CONTRIBUTING.md) | 繁體中文

## 檔案結構

- `skills/omp-cc-user/scripts/omp_cc_user.py` —— 全部邏輯(stdlib + PyYAML)
- `skills/omp-cc-user/SKILL.md` —— 給 model 看的文件:命令表、名稱規則
- `commands/omp-cc-user.md` —— slash command 包裝;把 `$ARGUMENTS` 轉發給 script

## 發版

版號存在兩處,bump 時兩邊都要改:

- `package.json`
- `../../.omp-plugin/marketplace.json`(repo root 的 `.omp-plugin/`)

## 歷史

`plugin` 資源移植自前身 `claude-plugin` skill(本 plugin 取代了它)。
程式碼其後已分叉(多名稱與 glob 處理),不再是逐行對照的關係。

## 驗證變更

沒有測試套件。用沙箱 HOME 跑 script —— import 時展開 `~`,
所以 `export HOME` 就夠;真實的 `~/.claude` 與 `~/.omp` 不會動到。
需要 PyYAML;沒有時用
`uv run --with pyyaml python3 <script> ...`。

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
python3 $SCRIPT plugin disable 'code-*' b   # 多名稱 + glob
python3 $SCRIPT skill disable '*' nosuch    # fail-fast:什麼都不寫
python3 $SCRIPT command disable 'sub:*'     # 一個檔案,兩個 ids
```
