# Optional: Codex plugin for Claude Code

*Not required for the COS process. TRIP works with any agent. Use this only if you run Claude Code and want first-class Codex review/delegation.*

Upstream: [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)

## Install (Claude Code)

```text
/plugin marketplace add openai/codex-plugin-cc
/plugin install codex@openai-codex
/reload-plugins
/codex:setup
```

Requires local `codex` CLI auth (`codex login` if needed).

## Useful commands mapped to TRIP

| Command | TRIP stage |
|---|---|
| `/codex:review` | Review (read-only) |
| `/codex:adversarial-review` | Review -- challenge design; flag overbuild |
| `/codex:rescue` | Implement -- hand a stuck task to Codex |
| `/codex:status` / `/codex:result` | Monitor background jobs |

Respect `docs/MODEL-POLICY.md`: confirm with the owner before expensive models/effort.

## Without Claude Code

Use `docs/SUBAGENTS.md` recipes (`codex exec`, grok) and a fresh chat for adversarial review. Same verdicts as `docs/ORCHESTRATION.md`.
