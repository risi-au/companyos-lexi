#!/usr/bin/env node
// Conformance check: verify an implementer (cline/aider/subagent) actually made every
// change a packet required. Catches the "silent omission" failure mode that a green gate
// misses (a feature quietly skipped still typechecks/lints/tests).
//
// Usage:
//   node conformance-check.mjs <checklist.txt> [baseRef]
//
// checklist.txt lines (blank lines and # comments ignored):
//   substring                     -> must appear in the ADDED lines of the change set
//   path/to/file :: substring     -> must appear in that file's current contents
//   path/to/file :: !substring    -> must NOT appear in that file (guard against forbidden edits)
//
// baseRef defaults to HEAD (i.e. uncommitted working-tree changes). Exit 1 if any check fails.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const [, , checklistPath, baseRef = "HEAD"] = process.argv;
if (!checklistPath || !existsSync(checklistPath)) {
  console.error(`conformance-check: checklist not found: ${checklistPath}`);
  process.exit(2);
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
}

// Added lines across tracked changes vs baseRef + all untracked files.
const trackedDiff = sh(`git diff ${baseRef} --unified=0`);
const untracked = sh(`git ls-files --others --exclude-standard`)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
let addedCorpus = trackedDiff
  .split("\n")
  .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
  .join("\n");
for (const f of untracked) {
  if (existsSync(f)) addedCorpus += "\n" + readFileSync(f, "utf8");
}

const lines = readFileSync(checklistPath, "utf8").split("\n");
let failures = 0;
let checks = 0;

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  checks++;
  const [lhs, rhs] = line.includes("::") ? line.split("::").map((s) => s.trim()) : [null, line];

  if (lhs) {
    // file-scoped check
    const negate = rhs.startsWith("!");
    const needle = negate ? rhs.slice(1).trim() : rhs;
    const present = existsSync(lhs) && readFileSync(lhs, "utf8").includes(needle);
    const ok = negate ? !present : present;
    if (!ok) {
      failures++;
      console.log(`  ✗ ${line}   ${negate ? "(forbidden string present)" : existsSync(lhs) ? "(missing in file)" : "(file not found)"}`);
    } else {
      console.log(`  ✓ ${line}`);
    }
  } else {
    // change-set check
    const ok = addedCorpus.includes(rhs);
    if (!ok) {
      failures++;
      console.log(`  ✗ ${rhs}   (not found in added lines / new files)`);
    } else {
      console.log(`  ✓ ${rhs}`);
    }
  }
}

console.log(`\nconformance: ${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`RESULT: FAIL — ${failures} required change(s) missing. The implementer left the card incomplete.`);
  process.exit(1);
}
console.log("RESULT: PASS — every required change is present.");
