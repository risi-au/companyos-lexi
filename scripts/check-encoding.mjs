#!/usr/bin/env node
// Fails if tracked text files contain a UTF-8/UTF-16 BOM, NUL bytes, or cp1252
// mojibake (the residue of Windows PowerShell 5.1 edits — see docs/SUBAGENTS.md).
// Wired into root `pnpm lint`; also run standalone against a worktree:
//   node scripts/check-encoding.mjs --dir C:\dev\companyos-<task>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dirFlag = process.argv.indexOf("--dir");
const root = dirFlag !== -1 ? process.argv[dirFlag + 1] : process.cwd();

const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|md|css|scss|json|sql|ya?ml|toml|ps1|sh|html|svg|txt|editorconfig|gitattributes)$/i;
// Files that legitimately contain mojibake byte sequences (they document them).
const EXCLUDE = new Set(["ONBOARDING.md"]);

// Byte patterns, computed from the strings so this file stays pure ASCII.
const MOJIBAKE = ["â€", "âŒ", "âœ", "Ã¢", "Â·"].map((s) => Buffer.from(s, "utf8"));
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16BE = Buffer.from([0xfe, 0xff]);

const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((f) => f && TEXT_EXT.test(f) && !EXCLUDE.has(f));

const findings = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(join(root, file));
  } catch {
    continue; // deleted in working tree
  }
  if (buf.subarray(0, 3).equals(BOM_UTF8)) findings.push(`${file}: UTF-8 BOM`);
  else if (buf.subarray(0, 2).equals(BOM_UTF16LE) || buf.subarray(0, 2).equals(BOM_UTF16BE)) {
    findings.push(`${file}: UTF-16 BOM`);
    continue; // everything below would false-positive on UTF-16 content
  }
  if (buf.includes(0)) findings.push(`${file}: NUL byte (binary or BOM-less UTF-16?)`);
  for (const pattern of MOJIBAKE) {
    if (buf.includes(pattern)) {
      findings.push(`${file}: cp1252 mojibake (${pattern.toString("utf8")})`);
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Encoding check FAILED:");
  for (const f of findings) console.error(`  ${f}`);
  console.error("Repair: rewrite the file as UTF-8 without BOM (see docs/SUBAGENTS.md encoding section).");
  process.exit(1);
}
console.log(`Encoding check OK (${files.length} files).`);
