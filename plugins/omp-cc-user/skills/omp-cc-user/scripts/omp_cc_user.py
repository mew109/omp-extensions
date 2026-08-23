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


def find_skill(name):
    names = [n for n, _, _ in discover()]
    if name not in names:
        print(f"error: skill '{name}' not found in ~/.claude/skills")
        print("available: " + ", ".join(sorted(names)))
        sys.exit(1)


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
    find_skill(args.name)
    cfg = load_cfg()
    key = f"skill:{args.name}"
    legacy = pop_legacy_ignored(cfg, [args.name])
    ext = cfg.setdefault("disabledExtensions", [])
    if key in ext:
        if legacy:
            save_cfg(cfg)
            print(f"{args.name}: already disabled — migrated off legacy skills.ignoredSkills")
            print("run /reload-plugins (or restart omp) to apply")
        else:
            print(f"{args.name}: already disabled in omp — nothing to change")
        return
    ext.append(key)
    save_cfg(cfg)
    note = " (migrated off legacy skills.ignoredSkills)" if legacy else ""
    print(f"{args.name}: disabled — added {key} to disabledExtensions{note}")
    print("run /reload-plugins (or restart omp) to apply")


def cmd_skill_enable(args):
    find_skill(args.name)
    cfg = load_cfg()
    key = f"skill:{args.name}"
    if not skill_off(args.name, ignored_set(cfg), ext_ids(cfg)):
        print(f"{args.name}: already visible in omp — nothing to change")
        return
    had_key = key in (cfg.get("disabledExtensions") or [])
    ext = [e for e in cfg.get("disabledExtensions") or [] if e != key]
    if ext:
        cfg["disabledExtensions"] = ext
    else:
        cfg.pop("disabledExtensions", None)
    legacy = pop_legacy_ignored(cfg, [args.name])
    save_cfg(cfg)
    bits = ([key] if had_key else []) + ([f"legacy ignoredSkills entry {args.name}"] if legacy else [])
    print(f"{args.name}: enabled — removed {' and '.join(bits)}")
    globs = [p for p in ignored_set(cfg)
             if any(c in p for c in "*?[") and fnmatch.fnmatch(args.name, p)]
    if globs:
        print(f"note: skills.ignoredSkills glob {', '.join(globs)} still hides {args.name}")
    print("run /reload-plugins (or restart omp) to apply")


# --- plugin resource (ported from claude-plugin) ---


def plugins():
    with open(INSTALLED) as f:
        data = json.load(f)
    return {k: v[0]["installPath"] for k, v in data.get("plugins", {}).items()}


def resolve(name):
    keys = plugins()
    if name in keys:
        return name, keys[name]
    partial = [k for k in keys if k.split("@")[0] == name]
    if not partial:
        sys.exit(f"error: no plugin matching {name!r}\nAvailable: " + "\n  ".join(sorted(keys)))
    if len(partial) > 1:
        sys.exit(f"error: ambiguous name {name!r}, matches:\n  " + "\n  ".join(sorted(partial)))
    return partial[0], keys[partial[0]]


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

    mcp = os.path.join(p, ".mcp.json")
    if os.path.isfile(mcp):
        try:
            with open(mcp) as f:
                inv["mcp"] += mcp_keys(json.load(f))
        except (json.JSONDecodeError, OSError):
            pass
    pj = os.path.join(p, ".claude-plugin", "plugin.json")
    if os.path.isfile(pj):
        try:
            with open(pj) as f:
                meta = json.load(f)
            srv = meta.get("mcpServers") if isinstance(meta, dict) else None
            if isinstance(srv, str):
                sp = os.path.join(p, srv)
                if os.path.isfile(sp):
                    with open(sp) as f:
                        inv["mcp"] += mcp_keys(json.load(f))
            elif isinstance(srv, dict):
                inv["mcp"] += list(srv.keys())
        except (json.JSONDecodeError, OSError):
            pass
    seen, out = set(), []
    for k in inv["mcp"]:
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
    key, path = resolve(args.name)
    name = key.split("@")[0]
    inv = inventory(path, name)
    skill_names, skill_ids, other_ids = plugin_items(inv, name)
    cfg = load_cfg()
    counts = (f"{len(skill_names)} skill(s), {len(inv['commands'])} command(s), "
              f"{len(inv['mcp'])} mcp, {len(inv['hooks'])} hook(s)")

    if args.action == "disable":
        legacy = pop_legacy_ignored(cfg, skill_names)
        ext = cfg.setdefault("disabledExtensions", [])
        added = [i for i in skill_ids + other_ids if i not in ext]
        if not added and not legacy:
            print(f"{key}: already fully ignored in omp — nothing to change ({counts})")
            return
        ext += added
        save_cfg(cfg)
        note = " (migrated skills off legacy skills.ignoredSkills)" if legacy else ""
        print(f"{key}: disabled — added {len(added)} entries to disabledExtensions{note} "
              f"({counts} now ignored in omp)")
        print("run /reload-plugins (or restart omp) to apply")
        return

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
        print(f"{key}: already fully visible in omp — nothing to change ({counts})")
        return
    if kept:
        cfg["disabledExtensions"] = kept
    else:
        cfg.pop("disabledExtensions", None)
    save_cfg(cfg)
    note = " (plus legacy ignoredSkills entries)" if legacy else ""
    print(f"{key}: enabled — removed {removed_e} entries from disabledExtensions{note} "
          f"({counts} now visible in omp)")
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


def find_command(name):
    for ids, _path, _desc in discover_commands():
        if name in ids:
            return ids
    avail = sorted(i for ids, _, _ in discover_commands() for i in ids)
    print(f"error: command '{name}' not found in ~/.claude/commands")
    print("available: " + ", ".join(avail))
    sys.exit(1)


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
    ids = find_command(args.name)
    cfg = load_cfg()
    ext = cfg.setdefault("disabledExtensions", [])
    add = [f"slash-command:{i}" for i in ids if f"slash-command:{i}" not in ext]
    if not add:
        print(f"{args.name}: already ignored in omp — nothing to change")
        return
    ext += add
    save_cfg(cfg)
    print(f"{args.name}: disabled — added {', '.join(add)} to disabledExtensions")
    print("run /reload-plugins (or restart omp) to apply")


def cmd_command_enable(args):
    ids = find_command(args.name)
    cfg = load_cfg()
    ext = cfg.get("disabledExtensions") or []
    keys = {f"slash-command:{i}" for i in ids}
    keep = [e for e in ext if e not in keys]
    if len(keep) == len(ext):
        print(f"{args.name}: already visible in omp — nothing to change")
        return
    if keep:
        cfg["disabledExtensions"] = keep
    else:
        cfg.pop("disabledExtensions", None)
    save_cfg(cfg)
    print(f"{args.name}: enabled — removed from disabledExtensions")
    print("run /reload-plugins (or restart omp) to apply")

USAGE = """usage: omp_cc_user.py <resource> <action> [name]

  skill list               list ~/.claude/skills skills and their omp state
  skill disable <name>     ignore a personal skill in omp
  skill enable <name>      unignore a personal skill in omp
  plugin list              list user plugins: resources, cc state, omp state
  plugin disable <name>    ignore a plugin's resources in omp
  plugin enable <name>     make a plugin's resources visible in omp
  command list             list ~/.claude/commands commands and their omp state
  command disable <name>   ignore a personal slash command in omp
  command enable <name>    unignore a personal slash command in omp

Resources: skill, plugin, command
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
    ap.add_argument("name", nargs="?")
    args = ap.parse_args(argv)
    if argv[1] in ("enable", "disable") and not args.name:
        print(USAGE)
        sys.exit(2)
    action(args)


if __name__ == "__main__":
    main()
