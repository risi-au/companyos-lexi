# OmniRoute + Cline Setup — Lexi V2 Experiment

*Date: 2026-07-22. This file is the reproducible reference for the harness configured here. If you ever need to rebuild this setup, follow this doc.*

---

## 1. OmniRoute

**Dashboard:** http://localhost:20128
**API Key:** `sk-76385974580730b1-029db5-609874ae` (rotate periodically; the /v1 gateway is also open on localhost)
**Auth file:** `%APPDATA%\omniroute\server.env`

### Active provider connections (10 total, 9 working)

| Provider | Auth | Status | Notes |
|---|---|---|---|
| codex ×2 | OAuth | ✅ | GPT-5.6/5.5 subs (rishi2310@gmail.com + risi@nutritionwarehouse.com.au) — generous limits, workhorse |
| claude | OAuth | ✅ | claude-sonnet-5/opus-4-8 via sub (risi@nutritionwarehouse.com.au, claude_team "Nutrition Warehouse", raven tier) |
| opencode-go | apikey | ✅ | Kimi K3, K2.7-code, GLM-5.2 — **low limits, use as reserve only** |
| cerebras | apikey | ✅ | Fast free inference (zai-glm-4.7, gpt-oss-120b, gemma-4-31b) |
| cloudflare-ai | apikey | ✅ | Workers AI free tier (kimi-k2.7-code, glm-5.2, glm-4.7-flash, qwen2.5-coder-32b, gpt-oss-120b, llama-4-scout, qwq-32b) |
| groq | apikey | ✅ | Fast free (gpt-oss-120b, llama-3.3-70b) |
| nvidia | apikey | ✅ | NVIDIA NIM dev tier (deepseek-v4-pro, minimax-m2.7, mistral-large-3, nemotron-3-super-120b, qwen3.5-397b, step-3.5-flash, gemma-4-31b) |
| opencode (oc/) | apikey | ✅ | OpenCode Zen — **free tier only** (deepseek-v4-flash-free, minimax-m3-free, qwen3.6-plus-free); paid models 401 |
| mimocode | apikey | ⚠️ | MiMoCode (mimo-auto) — test status unknown |
| grok-cli | OAuth | ❌ | Credits exhausted, left inactive |

### Compression

- **Mode:** RTK standard (applies to tool results automatically)
- **Preserves:** system prompts, instructions, code diffs — never compressed
- **Savings measured:** 35% on test-output sample (much higher on real build/test runs with the full 47 RTK filter set)
- **Caveman:** lite intensity, user messages only, min 50 chars — safe "be terse" injection
- **Stacked pipeline:** RTK → Caveman (applied in sequence when relevant)

### Custom combos created

| Combo | Strategy | Models | Primary upstream (verified) |
|---|---|---|---|
| **lexi-orchestrator** | priority | 3 | gpt-5.6-sol (codex) — your /goal brain |
| **lexi-implementer** | priority | 3 | gpt-5.6-terra (codex) — R2/mid shots |
| **lexi-cheap** | lkgp | 7 | zai-glm-4.7 (cerebras) — bulk executor, first hit fast+free |
| **lexi-mechanical** | cost-optimized | 6 | glm-4.7-flash (cloudflare) — docs/explore/trivial |
| **lexi-reviewer** | priority | 4 | claude-sonnet-5 (claude sub) — cross-vendor fresh eyes |

**Total:** 32 model targets across 10 providers, 5 role-pinned lanes.

---

## 2. Cline CLI

**Version:** 3.0.46
**Config dir:** `%USERPROFILE%\.cline`

### Provider registered

```
cline auth -p openai -k sk-76385974580730b1-029db5-609874ae -b http://localhost:20128 -m lexi-mechanical
```
Registered as `openai-compatible` provider. This is the default for all card execution.

### Headless execution (proven pattern)

```
cline -P "openai-compatible" -m <combo-name> -c "C:\dev\companyos-lexi" --auto-approve true "prompt"
```

- `-m` = which combo/model to use (any of the 5 lexi-* combos, or raw model ids)
- `-c` = working directory
- `--auto-approve` = auto-approve tool calls (set to false for interactive review)
- For plan-only: add `-p` (no tools execute)

### Kanban board

- **URL:** http://localhost:3484
- **Launch:** `cline --kanban` (starts hub daemon + board)
- **Current status:** Hub daemon is answering (WebSocket /ws = 200), but the frontend may not render from the npm global install. Fix: reinstall cline globally (`npm i -g cline@latest`) or run cline from source. The board is cosmetic — headless CLI execution works end-to-end (tested: `lexi-mechanical` created `V2-LEXI-SMOKE-TEST.txt` in the fork with exact content, no side effects).

### Per-card model assignments (for the board)

| Card | Combo to use | Why |
|---|---|---|
| Shot 0 Hygiene | lexi-mechanical | Mechanical (trivial docs/status fixes) |
| Shot 1 M11-01 | lexi-cheap | Additive MCP work, well-specified |
| Shot 2 M13-02 | lexi-implementer | DB migration = R2; needs mid-tier minimum |
| Shot 3 Bundles | lexi-cheap | Schema + docs |
| Shot 4 Digest | lexi-cheap (fast escalate to lexi-implementer) | New module; curation logic is fiddly |
| Shot 5 Kickoff | lexi-cheap | Mid-complexity |
| Shot 6 Two-layer | lexi-implementer | Infra-flavored |
| Shot 7 Standing roles | lexi-cheap | Mostly wiring |
| Shot 8 Lexi Core | lexi-implementer | Design-heavy; pause for owner confirmation (Expensive tier per MODEL-POLICY) |
| Shot 9 Prod gate | lexi-implementer | R2/security; deep review required |
| Orchestrator sidebar agent | lexi-orchestrator | GPT-5.6 for /goal decomposition |
| Reviewer (per card) | lexi-reviewer | Cross-vendor; claude-sonnet-5 primary |

---

## 3. Quick command cheat sheet

```powershell
# List all combos
iwr http://localhost:20128/api/combos -H @{Authorization="Bearer sk-76385974580730b1-029db5-609874ae"} | % Content

# Headless shot execution
cline -P "openai-compatible" -m lexie-cheap -c "C:\dev\companyos-lexi" --auto-approve true "<packet prompt>"

# Plan-only (no tools)
cline -P "openai-compatible" -m lexie-orchestrator -p -c "C:\dev\companyos-lexi" "decompose this: ..."

# Launch board
cline --kanban
```

---

*Last verified: 2026-07-22. All combos routed successfully through live upstream. Compression tested: tool output compresses, instructions preserved. Cline headless: file create test passed.*
