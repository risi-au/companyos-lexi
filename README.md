# Company Operating System (COS)

**One cohesive, provider-agnostic Company Operating System** for the entire holding company (full-funnel marketing agency, AI live chat, ecommerce stores, AI freelancers, Shopify apps, and more).

Humans and AI agents can track everything, run intelligent recurring processes, and maintain consistent ways of working across the operation as it grows rapidly.

## Zero Lock-in by Design
- Switch any LLM provider or frontend instantly via Hermes routing abstractions
- Self-hosted core components + paid frontier models only when they accelerate growth
- All parts interoperate via open methods: MCP, webhooks, APIs, git sync, file operations

## Purpose of This Repository
This is the **central hub** (not a per-business repo). It contains:
- Complete architecture and integration specs
- Standardized templates for every new project/client/business
- Setup automation scripts and Docker Compose
- Initial Hermes skill definitions
- Step-by-step implementation guides

Per-business work lives in separate private GitHub repos that follow the standards defined here (via `.cos/` folders that sync into gbrain).

## How to Use

```bash
git clone https://github.com/risi-au/cos.git
cd cos
```

**If you are handing this off to Claude or another agent for the full setup:**
1. Copy the **entire content** of `NEXT_AGENT_PROMPT.md`
2. Paste it as the first message / system prompt in the new chat
3. The agent will then guide you step-by-step starting from VPS provisioning

## Repository Structure

- `README.md` (this file)
- `NEXT_AGENT_PROMPT.md` — The master prompt for the next implementation agent
- `docs/` — Architecture, roadmap, data flows
- `templates/` — Reusable project/client onboarding templates (README frontmatter, .cos/ standards, etc.)
- `scripts/setup/` — VPS scripts, full Docker Compose, context loader
- `hermes-skills/` — Skill definitions (will be expanded)
- `affine-templates/` & `n8n-workflows/` — Visual process starters

## Current Status
Initial files committed. Ready to begin **Phase 1: Foundation** — starting with VPS provisioning and core services.

---
**This COS eliminates scattered conversations, context loss, and inconsistent processes while keeping full flexibility.**