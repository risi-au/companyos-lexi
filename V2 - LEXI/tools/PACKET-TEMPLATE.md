# Implementer packet template (hardened)

Copy this per card. It encodes every lesson from Shots 1–2: patch-spec exactness,
a graphify-derived codebase map (so the implementer doesn't have to discover structure),
a mandatory self-check (kills silent omissions), and an explicit conformance token list
that `conformance-check.mjs` verifies mechanically after the run.

Workflow per card:
1. Query the graphify graph for the card's domain; fill the CODEBASE MAP section.
2. Write the CHANGES as exact anchor + verbatim patch-spec.
3. List every must-exist symbol under CONFORMANCE TOKENS; copy those lines into a
   `<card>.checklist.txt`.
4. Run the implementer (cline `lexi-implementer` / subagent) on the packet.
5. Run: `V2 - LEXI/tools/verify-card.sh <card>.checklist.txt [scoped gate]` → must be CARD GREEN.
6. Review the diff against the packet, fix any deviation, then full gate + PR.

---

TASK: <one line>

REPO: C:\dev\companyos-lexi  (branch <shot/N-slug> — do NOT commit, push, or switch branches.)

## CODEBASE MAP (from graphify — where things live)
<distilled from the graph: the files/symbols that own the subsystems this card touches,
their public functions, the barrels that re-export them, and the test harness pattern.
This replaces the implementer having to read large files to discover structure.>

## EXECUTION RULES
- Precise patch spec; copy verbatim, do not invent or "improve".
- Do NOT read large files in full — use only the exact anchors below.
- Only edit the ALLOWED FILES.

## ALLOWED FILES
1. <path> (edit|create)
...

## FORBIDDEN
- <constitution violations to actively avoid — cross-module imports, schema changes, signature breaks, etc.>

## CHANGES
### CHANGE 1 — <file>: <what>
Find EXACT anchor:
```
<anchor>
```
Replace with / insert before/after:
```
<verbatim>
```
...

## SELF-CHECK (do this before finishing)
Re-read each CHANGE above. For each, point to the exact hunk in your diff that satisfies it.
If ANY change is unaddressed or partial, do it now. List each field/param the packet names
and confirm it appears in your edit — do not drop optional fields.

## CONFORMANCE TOKENS (must exist after your edits)
<one per line; also copied to <card>.checklist.txt for conformance-check.mjs>
<path> :: <symbol that must be in that file>
<bare symbol that must appear in the change set>
<path> :: !<string that must NOT appear (forbidden)>

## VERIFY (run all; all must pass)
<scoped typecheck/lint/test commands>
Then report which files changed and each command's result.
