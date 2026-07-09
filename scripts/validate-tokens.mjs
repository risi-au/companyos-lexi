import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tokenFile = path.join(root, "packages/ui/src/tokens.css");
const scanRoots = ["apps/os/src", "packages/ui/src"].map((dir) => path.join(root, dir));
const sourceExts = new Set([".css", ".tsx"]);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return sourceExts.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

const tokenCss = fs.readFileSync(tokenFile, "utf8");
const definedTokens = new Set([...tokenCss.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)].map((match) => match[1]));
const files = scanRoots.flatMap(walk);
const failures = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/var\(\s*--([a-zA-Z0-9-]+)/g)) {
    if (!definedTokens.has(match[1])) {
      failures.push(`${rel(file)} references undefined token --${match[1]}`);
    }
  }

  if (path.resolve(file) === path.resolve(tokenFile)) continue;
  for (const match of text.matchAll(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g)) {
    failures.push(`${rel(file)} contains raw hex color ${match[0]}`);
  }
}

if (failures.length > 0) {
  console.error("validate-tokens failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`validate-tokens passed (${definedTokens.size} tokens, ${files.length} files scanned)`);
