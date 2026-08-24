#!/usr/bin/env python3
"""Manage personal Claude Code™ user resources (~/.claude) inside omp.

Usage: omp_cc_user.py <resource> <action> [name]

Edits disabledExtensions in ~/.omp/agent/config.yml — omp's per-item kill
list (skill:<name>, slash-command:<name>, mcp:<name>, hook:t:tool:name).
Legacy skills.ignoredSkills entries still count as off and are migrated
away on enable. cc itself is unaffected.
"""
import fnmatch
import json
import os
import re
import sys

import yaml

HOME = os.path.expanduser("~")
SKILLS_DIR = os.path.join(HOME, ".claude", "skills")
INSTALLED = os.path.join(HOME, ".claude", "plugins", "installed_plugins.json")
SETTINGS = os.path.join(HOME, ".claude", "settings.json")
OMP_CONFIG = os.path.join(HOME, ".omp", "agent", "config.yml")


def frontmatter(path):
    """Return the YAML frontmatter dict of a SKILL.md, or {} on any error."""
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        if not lines or lines[0].strip() != "---":
            return {}
        block = []
        for line in lines[1:]:
            if line.strip() == "---":
                return yaml.safe_load("\n".join(block)) or {}
            block.append(line)
        return {}
    except Exception:
        return {}


def discover():
    """List (name, path, description) for each skill dir in SKILLS_DIR."""
    out = []
    if not os.path.isdir(SKILLS_DIR):
        return out
    for entry in sorted(os.listdir(SKILLS_DIR)):
        path = os.path.join(SKILLS_DIR, entry)
        skill_md = os.path.join(path, "SKILL.md")
        if not (os.path.isdir(path) or os.path.islink(path)) or not os.path.isfile(skill_md):
            continue
        fm = frontmatter(skill_md)
        name = fm.get("name") or entry
        desc = str(fm.get("description") or "").replace("\n", " ").strip()
        if len(desc) > 80:
            desc = desc[:77] + "..."
        out.append((name, path, desc))
    return out


def load_cfg():
    if not os.path.isfile(OMP_CONFIG):
        return {}
    with open(OMP_CONFIG) as f:
        return yaml.safe_load(f) or {}


def save_cfg(cfg):
    with open(OMP_CONFIG, "w") as f:
        yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)


def ignored_set(cfg):
    skills_cfg = cfg.get("skills") or {}
    return set(skills_cfg.get("ignoredSkills") or [])


def ext_ids(cfg):
    return set(cfg.get("disabledExtensions") or [])


def skill_off(name, ignored, ext):
    """True when omp hides this skill (skill: id, or legacy ignoredSkills)."""
    return f"skill:{name}" in ext or name in ignored or any(
        fnmatch.fnmatch(name, p) for p in ignored if any(c in p for c in "*?[")
    )


def pop_legacy_ignored(cfg, names):
    """Drop exact-name entries from skills.ignoredSkills; return what went."""
    skills_cfg = cfg.get("skills") or {}
    ignored = skills_cfg.get("ignoredSkills") or []
    kept = [s for s in ignored if s not in names]
    removed = [s for s in ignored if s in names]
    if not removed:
        return []
    if kept:
        skills_cfg["ignoredSkills"] = kept
        cfg["skills"] = skills_cfg
    else:
        skills_cfg.pop("ignoredSkills", None)
        if skills_cfg:
            cfg["skills"] = skills_cfg
        else:
            cfg.pop("skills", None)
    return removed


def find_skills(patterns):
    """Ordered unique skill names matching each pattern.

    Pattern matches via fnmatch (exact name = literal pattern). Zero matches
    for any pattern -> today's error message + available list, exit 1.
    """
    names = [n for n, _, _ in discover()]
    out = []
    for pat in patterns:
        m = sorted(n for n in names if fnmatch.fnmatch(n, pat))
        if not m:
            print(f"error: skill '{pat}' not found in ~/.claude/skills")
            print("available: " + ", ".join(sorted(names)))
            sys.exit(1)
        for n in m:
            if n not in out:
                out.append(n)
    return out


def cmd_skill_list(_args):
    cfg = load_cfg()
    ignored = ignored_set(cfg)
    ext = ext_ids(cfg)
    skills = discover()
    if not skills:
        print("no skills found in ~/.claude/skills")
        return
    for name, _path, desc in skills:
        if f"skill:{name}" in ext:
            state = "off"
        elif skill_off(name, ignored, set()):
            state = "off (ignoredSkills)"
        else:
            state = "on"
        print(f"{name}    omp: {state}")
        if desc:
            print(f"  {desc}")


def cmd_skill_disable(args):
    targets = find_skills(args.names)
    cfg = load_cfg()
    lines, changed = [], False
    for name in targets:
        key = f"skill:{name}"
        legacy = pop_legacy_ignored(cfg, [name])
        ext = cfg.setdefault("disabledExtensions", [])
        if key in ext:
            if legacy:
                changed = True
                lines.append(f"{name}: already disabled — migrated off legacy skills.ignoredSkills")
            else:
                lines.append(f"{name}: already disabled in omp — nothing to change")
            continue
        ext.append(key)
        changed = True
        note = " (migrated off legacy skills.ignoredSkills)" if legacy else ""
        lines.append(f"{name}: disabled — added {key} to disabledExtensions{note}")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")


def cmd_skill_enable(args):
    targets = find_skills(args.names)
    cfg = load_cfg()
    lines, changed = [], False
    for name in targets:
        key = f"skill:{name}"
        if not skill_off(name, ignored_set(cfg), ext_ids(cfg)):
            lines.append(f"{name}: already visible in omp — nothing to change")
            continue
        had_key = key in (cfg.get("disabledExtensions") or [])
        ext = [e for e in cfg.get("disabledExtensions") or [] if e != key]
        if ext:
            cfg["disabledExtensions"] = ext
        else:
            cfg.pop("disabledExtensions", None)
        legacy = pop_legacy_ignored(cfg, [name])
        changed = True
        bits = ([key] if had_key else []) + ([f"legacy ignoredSkills entry {name}"] if legacy else [])
        lines.append(f"{name}: enabled — removed {' and '.join(bits)}")
        globs = [p for p in ignored_set(cfg)
                 if any(c in p for c in "*?[") and fnmatch.fnmatch(name, p)]
        if globs:
            lines.append(f"note: skills.ignoredSkills glob {', '.join(globs)} still hides {name}")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")


# --- plugin resource (ported from claude-plugin) ---


def plugins():
    with open(INSTALLED) as f:
        data = json.load(f)
    return {k: v[0]["installPath"] for k, v in data.get("plugins", {}).items()}

def resolve_many(patterns):
    """Ordered unique (key, installPath) pairs for names/globs.

    Non-glob pattern: exact key, else unique short-name match, else the
    current errors (no match / ambiguous). Glob pattern (contains * ? [):
    fnmatch against full key and short name, >=1 match required, matches
    sorted. Any failure exits before the caller touches config.
    """
    keys = plugins()
    out, seen = [], set()
    for pat in patterns:
        if any(c in pat for c in "*?["):
            picked = sorted(k for k in keys
                            if fnmatch.fnmatch(k, pat)
                            or fnmatch.fnmatch(k.split("@")[0], pat))
            if not picked:
                sys.exit(f"error: no plugin matching {pat!r}\nAvailable: "
                         + "\n  ".join(sorted(keys)))
        elif pat in keys:
            picked = [pat]
        else:
            partial = [k for k in keys if k.split("@")[0] == pat]
            if not partial:
                sys.exit(f"error: no plugin matching {pat!r}\nAvailable: "
                         + "\n  ".join(sorted(keys)))
            if len(partial) > 1:
                sys.exit(f"error: ambiguous name {pat!r}, matches:\n  "
                         + "\n  ".join(sorted(partial)))
            picked = [partial[0]]
        for k in picked:
            if k not in seen:
                seen.add(k)
                out.append((k, keys[k]))
    return out


def inventory(install_path, plugin_name):
    inv = {"skills": [], "commands": [], "mcp": [], "hooks": [], "hooks_json_not_loaded": False}
    p = install_path

    sk = os.path.join(p, "skills")
    if os.path.isdir(sk):
        for e in sorted(os.listdir(sk)):
            md = os.path.join(sk, e, "SKILL.md")
            if os.path.isfile(md):
                inv["skills"].append(frontmatter(md).get("name") or e)

    for d in ("commands", "slash-commands"):
        cd = os.path.join(p, d)
        if os.path.isdir(cd):
            for e in sorted(os.listdir(cd)):
                if e.endswith(".md"):
                    base = e[:-3]
                    if base not in inv["commands"]:
                        inv["commands"].append(base)

    def mcp_keys(obj):
        if not isinstance(obj, dict):
            return []
        if "mcpServers" in obj:
            obj = obj["mcpServers"]
        return list(obj.keys())

    mcp_raw, declared = None, False
    for manifest_dir in (".omp-plugin", ".claude-plugin"):
        pj = os.path.join(p, manifest_dir, "plugin.json")
        if not os.path.isfile(pj):
            continue
        try:
            with open(pj) as f:
                meta = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(meta, dict):
            continue
        ptr = meta.get("mcpServers")
        if isinstance(ptr, dict):          # inline server map
            mcp_raw, declared = ptr, True
            break
        if isinstance(ptr, str) and ptr.strip():
            declared = True
            sp = os.path.normpath(os.path.join(p, ptr.strip()))
            inside = sp == p or sp.startswith(p + os.sep)
            if inside:
                try:
                    with open(sp) as f:
                        doc = json.load(f)
                except (json.JSONDecodeError, OSError):
                    doc = None
                if isinstance(doc, dict):
                    mcp_raw = doc
            break   # declared is exclusive: escape/missing file -> no servers (omp behavior)
    if not declared:
        try:
            with open(os.path.join(p, ".mcp.json")) as f:
                doc = json.load(f)
        except (json.JSONDecodeError, OSError):
            doc = None
        if isinstance(doc, dict):
            mcp_raw = doc
    names = mcp_keys(mcp_raw) if mcp_raw else []
    seen, out = set(), []
    for k in names:
        if k not in seen:
            seen.add(k)
            out.append(k)
    inv["mcp"] = [f"mcp:{plugin_name}:{k}" for k in out]

    for phase in ("pre", "post"):
        hd = os.path.join(p, "hooks", phase)
        if os.path.isdir(hd):
            for e in sorted(os.listdir(hd)):
                inv["hooks"].append((phase, e))

    if os.path.isfile(os.path.join(p, "hooks", "hooks.json")):
        inv["hooks_json_not_loaded"] = True
    return inv


def plugin_ignores(cfg):
    return ignored_set(cfg), ext_ids(cfg)


HOOK_EXT = re.compile(r"\.(sh|bash|zsh|fish)$")


def hook_id(phase, fname):
    """omp registers hooks/<phase>/<fname> as hook:<phase>:<tool>:<fname>,
    where tool is the file name without a .sh/.bash/.zsh/.fish suffix."""
    return f"hook:{phase}:{HOOK_EXT.sub('', fname)}:{fname}"


def plugin_items(inv, plugin_name):
    """(skill names, skill ids, other ids) as omp registers them.
    Plugin commands are prefixed with the plugin name; mcp ids already are."""
    skill_ids = [f"skill:{s}" for s in inv["skills"]]
    other = [f"slash-command:{plugin_name}:{c}" for c in inv["commands"]]
    other += list(inv["mcp"])
    other += [hook_id(ph, fn) for ph, fn in inv["hooks"]]
    return inv["skills"], skill_ids, other


def omp_state(cfg, inv, plugin_name):
    names, skill_ids, other = plugin_items(inv, plugin_name)
    ign_skills, ign_ext = plugin_ignores(cfg)
    n = len(names) + len(other)
    if n == 0:
        return "none"
    off = sum(1 for s in names if skill_off(s, ign_skills, ign_ext))
    off += sum(1 for i in other if i in ign_ext)
    if off == 0:
        return "on"
    if off == n:
        return "off"
    return "partial"


def cc_state(key):
    if not os.path.isfile(SETTINGS):
        return True
    try:
        with open(SETTINGS) as f:
            ep = (json.load(f) or {}).get("enabledPlugins") or {}
    except (json.JSONDecodeError, OSError):
        return True
    return ep.get(key, True)


def cmd_plugin_list(_args):
    keys = plugins()
    cfg = load_cfg()
    for key in sorted(keys):
        name = key.split("@")[0]
        inv = inventory(keys[key], name)
        state = omp_state(cfg, inv, name)
        cc = "enabled" if cc_state(key) else "disabled"
        suffix = " (no resources)" if state == "none" else ""
        print(f"{key}    cc: {cc}    omp: {state}{suffix}")
        ign_skills, ign_ext = plugin_ignores(cfg)
        if inv["skills"]:
            tag = [s for s in inv["skills"]
                   if f"skill:{s}" in ign_ext or s in ign_skills]
            print(f"  skills:         {', '.join(inv['skills'])}"
                  + (f"    [ignored: {', '.join(tag)}]" if tag else ""))
        if inv["commands"]:
            print("  slash-commands: " + ", ".join("/" + c for c in inv["commands"]))
        if inv["mcp"]:
            print("  mcp:            " + ", ".join(inv["mcp"]))
        if inv["hooks"]:
            pre = [fn for ph, fn in inv["hooks"] if ph == "pre"]
            post = [fn for ph, fn in inv["hooks"] if ph == "post"]
            parts = []
            if pre:
                parts.append("pre: " + ", ".join(pre))
            if post:
                parts.append("post: " + ", ".join(post))
            print("  hooks:          " + "  ".join(parts))
        if inv["hooks_json_not_loaded"]:
            print("  (hooks.json present — not loaded by omp)")
        print()


def cmd_plugin_toggle(args):
    targets = resolve_many(args.names)  # validated; exits on any bad name
    cfg = load_cfg()
    lines, changed = [], False
    for key, path in targets:
        name = key.split("@")[0]
        inv = inventory(path, name)
        skill_names, skill_ids, other_ids = plugin_items(inv, name)
        counts = (f"{len(skill_names)} skill(s), {len(inv['commands'])} command(s), "
                  f"{len(inv['mcp'])} mcp, {len(inv['hooks'])} hook(s)")

        if args.action == "disable":
            legacy = pop_legacy_ignored(cfg, skill_names)
            ext = cfg.setdefault("disabledExtensions", [])
            added = [i for i in skill_ids + other_ids if i not in ext]
            if not added and not legacy:
                lines.append(f"{key}: already fully ignored in omp — nothing to change ({counts})")
                continue
            ext += added
            changed = changed or bool(added) or bool(legacy)
            note = " (migrated skills off legacy skills.ignoredSkills)" if legacy else ""
            lines.append(f"{key}: disabled — added {len(added)} entries to disabledExtensions{note} "
                         f"({counts} now ignored in omp)")
            continue

        # enable: also sweep ids written by omp-cc-user <= 0.1.0 (unprefixed
        # slash-command:<cmd>, hook:<phase>:<base>:<base>)
        legacy_ids = {f"slash-command:{c}" for c in inv["commands"]}
        legacy_ids |= {f"hook:{ph}:{os.path.splitext(fn)[0]}:{os.path.splitext(fn)[0]}"
                       for ph, fn in inv["hooks"]}
        remove = set(skill_ids) | set(other_ids) | legacy_ids
        ext = cfg.get("disabledExtensions") or []
        kept = [e for e in ext if e not in remove]
        removed_e = len(ext) - len(kept)
        legacy = pop_legacy_ignored(cfg, skill_names)
        if not removed_e and not legacy:
            lines.append(f"{key}: already fully visible in omp — nothing to change ({counts})")
            continue
        if kept:
            cfg["disabledExtensions"] = kept
        else:
            cfg.pop("disabledExtensions", None)
        changed = changed or removed_e > 0 or bool(legacy)
        note = " (plus legacy ignoredSkills entries)" if legacy else ""
        lines.append(f"{key}: enabled — removed {removed_e} entries from disabledExtensions{note} "
                     f"({counts} now visible in omp)")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")

# --- command resource (~/.claude/commands) ---


COMMANDS_DIR = os.path.join(HOME, ".claude", "commands")


def discover_commands():
    """List (ids, path, description) for each *.md under ~/.claude/commands.

    ids = ['bar', 'foo:bar'] for foo/bar.md (omp registers both names).
    """
    out = []
    if not os.path.isdir(COMMANDS_DIR):
        return out
    for root, dirs, files in os.walk(COMMANDS_DIR):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, COMMANDS_DIR)[: -len(".md")]
            ids = [rel.replace(os.sep, ":")] if os.sep in rel else [rel]
            base = rel.split(os.sep)[-1]
            if base not in ids:
                ids.insert(0, base)
            fm = frontmatter(path)
            desc = str(fm.get("description") or "").replace("\n", " ").strip()
            if not desc:
                body = [ln.strip() for ln in open(path, encoding="utf-8").read().splitlines()]
                desc = next((ln for ln in body if ln and ln != "---"), "")
            if len(desc) > 80:
                desc = desc[:77] + "..."
            out.append((ids, path, desc))
    return out



def command_off(ids, disabled):
    keys = [f"slash-command:{i}" for i in ids]
    return any(
        k in disabled or any(fnmatch.fnmatch(k, pat) for pat in disabled)
        for k in keys
    )


def find_commands(patterns):
    """[(pattern, ids)] — ids = union (ordered, deduped) of every command
    file whose any id fnmatches the pattern. Unmatched pattern -> today's
    error + available list, exit 1."""
    cmds = discover_commands()
    out = []
    for pat in patterns:
        ids = []
        for cids, _p, _d in cmds:
            if any(fnmatch.fnmatch(i, pat) for i in cids):
                for i in cids:
                    if i not in ids:
                        ids.append(i)
        if not ids:
            avail = sorted(i for cids, _, _ in cmds for i in cids)
            print(f"error: command '{pat}' not found in ~/.claude/commands")
            print("available: " + ", ".join(avail))
            sys.exit(1)
        out.append((pat, ids))
    return out


def cmd_command_list(_args):
    cfg = load_cfg()
    disabled = ext_ids(cfg)
    source_off = (cfg.get("commands") or {}).get("enableClaudeUser") is False
    cmds = discover_commands()
    if not cmds:
        print("no commands found in ~/.claude/commands")
        return
    if source_off:
        print("note: commands.enableClaudeUser=false — ALL user commands off in omp")
    for ids, _path, desc in cmds:
        state = "off (ignored)" if command_off(ids, disabled) else "on"
        names = ids[0] if len(ids) == 1 else " / ".join(ids)
        print(f"/{names}    omp: {state}")
        if desc:
            print(f"  {desc}")


def cmd_command_disable(args):
    targets = find_commands(args.names)
    cfg = load_cfg()
    ext = cfg.setdefault("disabledExtensions", [])
    lines, changed = [], False
    for pat, ids in targets:
        add = [f"slash-command:{i}" for i in ids if f"slash-command:{i}" not in ext]
        if not add:
            lines.append(f"{pat}: already ignored in omp — nothing to change")
            continue
        ext += add
        changed = True
        lines.append(f"{pat}: disabled — added {', '.join(add)} to disabledExtensions")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")


def cmd_command_enable(args):
    targets = find_commands(args.names)
    cfg = load_cfg()
    lines, changed = [], False
    for pat, ids in targets:
        ext = cfg.get("disabledExtensions") or []
        keys = {f"slash-command:{i}" for i in ids}
        keep = [e for e in ext if e not in keys]
        if len(keep) == len(ext):
            lines.append(f"{pat}: already visible in omp — nothing to change")
            continue
        if keep:
            cfg["disabledExtensions"] = keep
        else:
            cfg.pop("disabledExtensions", None)
        changed = True
        lines.append(f"{pat}: enabled — removed from disabledExtensions")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")

# --- mcp resource (user-level ~/.claude mcp config) ---

CLAUDE_JSON = os.path.join(HOME, ".claude.json")
CLAUDE_MCP_JSON = os.path.join(HOME, ".claude", "mcp.json")


def discover_mcp():
    """(name, cfg, src) for user-level Claude Code mcp servers.

    Mirrors omp's claude provider: ~/.claude.json first; ~/.claude/mcp.json
    only when the first yields no servers. Nested mcpServers shape only.
    cfg is the server map value ({} when not a dict).
    """
    for path in (CLAUDE_JSON, CLAUDE_MCP_JSON):
        try:
            with open(path) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError):
            continue
        servers = data.get("mcpServers") if isinstance(data, dict) else None
        if not isinstance(servers, dict) or not servers:
            continue
        return [(n, c if isinstance(c, dict) else {}, os.path.basename(path))
                for n, c in servers.items()]
    return []


def find_mcp(patterns):
    """Ordered unique (name, cfg, src) for names/globs; unmatched -> exit 1."""
    servers = discover_mcp()
    by_name = {n: (c, s) for n, c, s in servers}
    out = []
    for pat in patterns:
        hits = [n for n in by_name if fnmatch.fnmatch(n, pat)]
        hits.sort()
        if not hits:
            print(f"error: mcp server '{pat}' not found in ~/.claude mcp config")
            print("available: " + ", ".join(sorted(by_name)))
            sys.exit(1)
        for n in hits:
            if n not in out:
                out.append(n)
    return [(n, *by_name[n]) for n in out]


def mcp_detail(cfg):
    url = cfg.get("url")
    if isinstance(url, str) and url:
        return url
    cmd = cfg.get("command")
    if isinstance(cmd, str) and cmd:
        args = cfg.get("args")
        if isinstance(args, list):
            return cmd + " " + " ".join(str(a) for a in args)
        return cmd
    return None


def cmd_mcp_list(_args):
    cfg = load_cfg()
    disabled = ext_ids(cfg)
    servers = discover_mcp()
    if not servers:
        print("no mcp servers found in ~/.claude.json or ~/.claude/mcp.json")
        return
    for name, entry, src in servers:
        if f"mcp:{name}" in disabled:
            state = "off"
        elif entry.get("enabled") is False:
            state = "off (enabled=false in Claude config)"
        else:
            state = "on"
        print(f"{name}    omp: {state}    ({src})")
        detail = mcp_detail(entry)
        if detail:
            print(f"  {detail}")


def cmd_mcp_disable(args):
    targets = find_mcp(args.names)
    cfg = load_cfg()
    ext = cfg.setdefault("disabledExtensions", [])
    lines, changed = [], False
    for name, _entry, _src in targets:
        if f"mcp:{name}" in ext:
            lines.append(f"{name}: already ignored in omp — nothing to change")
            continue
        ext.append(f"mcp:{name}")
        changed = True
        lines.append(f"{name}: disabled — added mcp:{name} to disabledExtensions")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")


def cmd_mcp_enable(args):
    targets = find_mcp(args.names)
    cfg = load_cfg()
    srcs = {n: (c, s) for n, c, s in discover_mcp()}
    lines, changed = [], False
    for name, entry, _src in targets:
        ext = cfg.get("disabledExtensions") or []
        key = f"mcp:{name}"
        if key not in ext:
            lines.append(f"{name}: already visible in omp — nothing to change")
        else:
            keep = [e for e in ext if e != key]
            if keep:
                cfg["disabledExtensions"] = keep
            else:
                cfg.pop("disabledExtensions", None)
            changed = True
            lines.append(f"{name}: enabled — removed mcp:{name} from disabledExtensions")
        if entry.get("enabled") is False:
            src = srcs.get(name, ({}, ""))[1]
            lines.append(f"note: '{name}' has enabled=false in {src} — omp still skips it")
    if changed:
        save_cfg(cfg)
    for ln in lines:
        print(ln)
    if changed:
        print("run /reload-plugins (or restart omp) to apply")


USAGE = """usage: omp_cc_user.py <resource> <action> [name...]

  skill list                list ~/.claude/skills skills and their omp state
  skill disable <name...>   ignore matching skill(s) in omp
  skill enable <name...>    unignore matching skill(s) in omp
  plugin list               list user plugins: resources, cc state, omp state
  plugin disable <name...>  ignore matching plugins' resources in omp
  plugin enable <name...>   make matching plugins' resources visible in omp
  command list              list ~/.claude/commands commands and their omp state
  command disable <name...> ignore matching slash command(s) in omp
  command enable <name...>  unignore matching slash command(s) in omp
  mcp list                  list ~/.claude mcp servers and their omp state
  mcp disable <name...>     ignore matching mcp server(s) in omp
  mcp enable <name...>      unignore matching mcp server(s) in omp

Names: one or more, fnmatch globs (* ? [) allowed — quote them so the shell
passes them through, e.g. plugin disable 'code-*'. Every name must match at
least one item or nothing is written.

Resources: skill, plugin, command, mcp
Only edits ~/.omp/agent/config.yml; Claude Code™ is unaffected."""

RESOURCES = {
    "skill": {
        "list": cmd_skill_list,
        "enable": cmd_skill_enable,
        "disable": cmd_skill_disable,
    },
    "plugin": {
        "list": cmd_plugin_list,
        "enable": cmd_plugin_toggle,
        "disable": cmd_plugin_toggle,
    },
    "command": {
        "list": cmd_command_list,
        "enable": cmd_command_enable,
        "disable": cmd_command_disable,
    },
    "mcp": {
        "list": cmd_mcp_list,
        "enable": cmd_mcp_enable,
        "disable": cmd_mcp_disable,
    },
}


def main():
    argv = sys.argv[1:]
    if not argv:
        print(USAGE)
        return
    resource, actions = argv[0], RESOURCES.get(argv[0])
    if not actions:
        print(USAGE)
        sys.exit(2)
    if len(argv) < 2 or argv[1] not in actions:
        print(USAGE)
        sys.exit(2)
    action = actions[argv[1]]

    import argparse
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("resource")  # consumed
    ap.add_argument("action")    # consumed
    ap.add_argument("names", nargs="*")
    args = ap.parse_args(argv)
    if argv[1] == "list" and args.names:
        print(USAGE)
        sys.exit(2)
    if argv[1] in ("enable", "disable") and not args.names:
        print(USAGE)
        sys.exit(2)
    action(args)


if __name__ == "__main__":
    main()
