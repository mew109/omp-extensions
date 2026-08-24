# omp-extensions

English | [繁體中文](README-zh-tw.md)

A personal omp plugin marketplace, named `omp-extensions`. It contains the following plugins:

| Plugin | Purpose | Type |
|---|---|---|
| another-statusline | Merges the built-in path/git/pr statusline segments into one widget and adds weather and stock segments | extension |
| code-mode | PTC-style code mode: the model can only call eval/ask/read/write and reaches other tools through a kernel tool bridge | extension |
| omp-cc-user | Manage which personal `~/.claude` resources (skills, plugins, slash commands, mcp servers) are visible in omp | skill + slash command |
| omp-segments-to-widgets | Procedure for moving OMP status-line segments into safe, width-aware extension widgets | skill |

## Install

    omp plugin marketplace add https://github.com/mew109/omp-extensions
    omp plugin install another-statusline@omp-extensions
    omp plugin install code-mode@omp-extensions
    omp plugin install omp-cc-user@omp-extensions
    omp plugin install omp-segments-to-widgets@omp-extensions

For local development use the repo path instead: `omp plugin marketplace add <path-to-repo>`.

## Uninstall

    omp plugin uninstall <name>@omp-extensions

## Version updates

1. Bump the plugin's `version` in `.omp-plugin/marketplace.json` (and in the plugin's `package.json`).
2. `omp plugin marketplace update omp-extensions`
3. `omp plugin upgrade <name>@omp-extensions`

## License

MIT — see [LICENSE](LICENSE).
