# Operating doctrine — what goes where

CompanyOS is the agent-facing layer that sits on top of whatever tools the company
already uses. It is the system of record for knowledge, facts, context, and agent
work — not a replacement CRM, mailer, task tracker, or billing system. External
tools keep doing what they do; integrations flow facts in; scopes organize them;
agents consume them via MCP. When you're unsure where something belongs, classify
it by shape:

## Scope-shaped

Something needs its own access boundary: its own grants, agents, wiki, repo,
credential vault. That's a scope — create it through the wizard so it starts with
context, history references, and provisioning.

- Clients get a scope **when they convert**, not before. Never a scope per lead.
- Topology is flexible: a client can be top-level or nested under a parent scope —
  decide per case. The one structural consequence: **the Plane workspace binds to
  the top-level scope and every sub-scope inherits it** (each sub-scope becomes a
  Plane project inside that workspace). Nest clients under one parent when staff
  should see all their work in one Plane workspace; make a client top-level when
  it needs hard isolation (own workspace, own tree).
- Function scopes (e.g. a sales scope, a marketing scope) hold the company's own
  recurring work: proposal docs, comm records, and the skills that make repeated
  work cheap. The OS should assist from the first touch with a prospect — that is
  what makes conversion cheap later.

## Plane-shaped

It has an assignee, a state, and a due date. That's a Plane issue.

- Tasks, obviously. A sales pipeline MAY be a Plane project whose kanban states are
  the funnel stages — or it may live in an external CRM. Both are fine; the OS does
  not care which tool holds the pipeline, only that the facts get mirrored in
  (see record-shaped).

## Record-shaped

A fact about something that happened: a comm sent, a quote issued, a decision
taken, an invoice paid, a deploy shipped. That's an OS record at the scope where it
happened, logged by whoever did it — human, agent, or integration.

- Agents doing outreach/followups/work log what they did as records via MCP as part
  of doing it. The sending agent *is* the integration.
- Records are the memory. The brain distills them into the wiki nightly; hybrid
  search spans them; the wizard's related-history step finds them at conversion
  time. If it isn't recorded, the OS doesn't know it.

## External-tool-shaped

Pipelines with their own machinery — CRM, billing/accounting, email tracking, ads
platforms — stay external. Integrate by mirroring key events into records and
metrics through the HTTP API, MCP, or n8n. The test: **the OS must be able to
answer "what's the state of X?" from mirrored records even though the source of
truth is external.** If agents can't answer it from inside the OS, the mirror is
too thin.

## Conversion: link, don't migrate

When a lead becomes a client (or any work graduates into its own scope), nothing
moves. Pre-signing history stays at the scope where it happened. The wizard pulls a
digest of it into the new scope's intake pack (related-history step), the interview
distills it into the scope's starting docs, and a `source-refs` record in the new
scope points permanently back at the original records. "Where did we get them from
and what did we promise?" stays answerable forever, from the client scope.

## Secrets

Secret values never go in git repos, never in docs, and never through the external
interview (that's a third-party LLM). Connection *procedures* (how to log in, do's
and don'ts) are open markdown docs per scope; the values they reference live in the
scope's encrypted credential vault and agents fetch them at work time via
`get_credential` (audited). The interview collects credential *names* only.
