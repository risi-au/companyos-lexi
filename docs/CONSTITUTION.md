# Engineering Constitution

*Non-negotiable rules for every contributor — human or agent. CI enforces what it can; reviewers enforce the rest. If a change requires breaking one of these, it requires an explicit amendment to this file first.*

## 1. Kernel + vertical modules

- The **kernel** owns only: the scope tree, principals/grants/tokens, the event bus, and the module contract. It changes rarely and only with explicit review.
- Everything else is a **vertical module** (`apps/os/modules/<name>/`): its own DB tables + migrations, service functions, API routes, MCP tools, UI components, tests, and `AGENTS.md`. Nothing else.
- **Modules never import from each other.** Cross-module effects go through kernel events (`scope.created`, `task.completed`, …) or kernel interfaces. Enforced by lint import-boundary rules — a violation fails CI.
- A new feature is a new module or a change inside one module. If a change touches >1 module or the kernel, stop and re-scope.

## 2. API-first (three clients, one service layer)

- All business logic lives in `packages/api`. The web UI, the MCP server, and any future mobile app are *clients* of it.
- Nothing is reachable only through the UI. If the UI can do it, an agent can do it via MCP, and vice versa.
- No UI code touches the database directly. Ever.

## 3. Every write emits an event

- Any mutation in any module appends to `events` (type, scope, principal, payload). This powers the audit log, activity feeds, cross-module reactions, and usage observability. A write without an event is a bug.

## 4. Scoping and permissions at the kernel

- Every read/write is checked against the caller's grants at the service layer — not in the UI, not in prompts.
- Agents and humans are both principals. No god-keys: every token belongs to a principal with explicit grants.

## 5. Content is markdown; flexibility is jsonb

- Documents, records, reports: markdown bodies, always exportable, git-syncable, agent-native.
- Dashboard specs, module config, metric dimensions: jsonb — evolve without migrations.
- Editors are constrained to markdown-representable content. No format that traps data.

## 6. MCP contract is public API

- Tools are added, or deprecated with warnings. Never silently changed. Workbench `AGENTS.md` files in the field must stay valid for years.

## 7. Design tokens only

- Modules compose primitives from `packages/ui`; primitives consume design tokens. No hardcoded colors/spacing/fonts in modules. Reskinning the product must be a token-file change.

## 8. 12-factor / SaaS discipline

- All config via env vars. No hardcoded domains, paths, keys, tenant names.
- Docker Compose is the only install path; a fresh instance must boot to a working state with one command (migrations + seed automated).
- Versioned releases; migrations always forward-compatible one version.

## 9. Docs live with the code

- Every module has an `AGENTS.md`: purpose, contract, tables, files, how to test. Updated in the same PR as the change — a PR that changes behavior without updating the module's AGENTS.md is incomplete.
- The root `AGENTS.md` is only a map. `docs/DESIGN.md` is the why; this file is the how.

## 10. Tests prove the contract

- Each module tests its own service functions and MCP tools. The kernel has the deepest coverage (grants resolution, event emission, tree operations).
- A task brief's acceptance criteria become tests. No green tests, no merge.
