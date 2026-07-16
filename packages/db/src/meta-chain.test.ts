import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type JournalEntry = {
  idx: number;
  tag: string;
};

type Snapshot = {
  id: string;
  prevId: string;
};

type SnapshotByTag = Record<string, Snapshot>;

type ChainAllowances = {
  missingSnapshots: readonly string[];
  duplicateParents: readonly string[];
  walkJumps: Readonly<Record<string, string>>;
};

const ZERO_ID = "00000000-0000-0000-0000-000000000000";

// frozen 2026-07-15 per issue #56 - never extend, repair the chain instead.
const HISTORICAL_MISSING_SNAPSHOTS = [
  "0002_clever_squirrel",
  "0008_brave_foxhound",
  "0009_structure_v2_enum",
  "0014_connect_connections",
  "0015_sessions_registry",
  "0016_search_fts_indexes",
  "0017_usage_observability",
  "0018_semantic_layer",
  "0021_intake_wizard_v2",
  "0022_credential_vault",
  "0023_ops_health",
  "0026_following_notifications",
] as const;

// The 0028 prevId defect this once allowed was repaired in #59 (owner-approved);
// the live chain has no duplicate parents. The single remaining jump bridges the
// snapshots deleted before 0023a_attention_items, formerly 20260710083235_attention_items
// (its prevId points at the absent 0023). Renamed per issue #56 so drizzle-kit's
// lexicographic snapshot sort matches chain order and generate diffs against the true head.
const HISTORICAL_WALK_JUMPS = {
  "0023a_attention_items": "0020_neat_vulcan",
} as const;

const REAL_CHAIN_ALLOWANCES: ChainAllowances = {
  missingSnapshots: HISTORICAL_MISSING_SNAPSHOTS,
  duplicateParents: [],
  walkJumps: HISTORICAL_WALK_JUMPS,
};

function migrationPrefix(tag: string): string {
  const firstUnderscore = tag.indexOf("_");
  return firstUnderscore === -1 ? tag : tag.slice(0, firstUnderscore);
}

function sortedDiff(left: Iterable<string>, right: Iterable<string>): string[] {
  const rightSet = new Set(right);
  return [...left].filter((item) => !rightSet.has(item)).sort();
}

function validateJournal(entries: readonly JournalEntry[]): string[] {
  const failures: string[] = [];
  const seenTags = new Set<string>();

  entries.forEach((entry, index) => {
    if (entry.idx !== index) {
      failures.push(`journal idx ${entry.idx} at position ${index}; expected ${index}`);
    }
    if (seenTags.has(entry.tag)) {
      failures.push(`duplicate journal tag ${entry.tag}`);
    }
    seenTags.add(entry.tag);
  });

  return failures;
}

function validateJournalMatchesSql(entries: readonly JournalEntry[], sqlTags: readonly string[]): string[] {
  const journalTags = entries.map((entry) => entry.tag);
  const missingSql = sortedDiff(journalTags, sqlTags);
  const missingJournal = sortedDiff(sqlTags, journalTags);
  const failures: string[] = [];

  if (missingSql.length > 0) {
    failures.push(`journal tags without drizzle SQL: ${missingSql.join(", ")}`);
  }
  if (missingJournal.length > 0) {
    failures.push(`drizzle SQL without journal tags: ${missingJournal.join(", ")}`);
  }

  return failures;
}

function validateSnapshotsPresent(
  entries: readonly JournalEntry[],
  snapshots: SnapshotByTag,
  missingSnapshots: readonly string[],
): string[] {
  const failures: string[] = [];
  const missingSnapshotSet = new Set(missingSnapshots);

  for (const tag of missingSnapshots) {
    if (snapshots[tag]) {
      failures.push(`historical missing snapshot allowlist entry now exists: ${tag}`);
    }
  }

  for (const entry of entries) {
    if (!snapshots[entry.tag] && !missingSnapshotSet.has(entry.tag)) {
      failures.push(`journal tag has no snapshot and is not historically allowlisted: ${entry.tag}`);
    }
  }

  return failures;
}

function validateUniquePrevIds(snapshots: SnapshotByTag, allowedDuplicatePairs: readonly string[]): string[] {
  const byPrevId = new Map<string, string>();
  const allowed = new Set(allowedDuplicatePairs);
  const failures: string[] = [];

  for (const [tag, snapshot] of Object.entries(snapshots)) {
    const previous = byPrevId.get(snapshot.prevId);
    if (!previous) {
      byPrevId.set(snapshot.prevId, tag);
      continue;
    }

    const pair = [previous, tag].sort().join(" -> ");
    if (!allowed.has(pair)) {
      failures.push(`snapshots share prevId ${snapshot.prevId}: ${pair}`);
    }
  }

  return failures;
}

function validateSnapshotWalk(
  entries: readonly JournalEntry[],
  snapshots: SnapshotByTag,
  walkJumps: Readonly<Record<string, string>>,
): string[] {
  const expected = entries
    .map((entry) => entry.tag)
    .filter((tag) => snapshots[tag])
    .reverse();
  const failures: string[] = [];

  if (expected.length === 0) {
    return ["no snapshots exist for journal entries"];
  }

  const tagById = new Map(Object.entries(snapshots).map(([tag, snapshot]) => [snapshot.id, tag]));
  const visited: string[] = [];
  const seen = new Set<string>();
  let currentTag: string | undefined = expected[0];

  for (const expectedTag of expected) {
    if (!currentTag) {
      failures.push(`snapshot walk ended before expected ${expectedTag}`);
      break;
    }
    if (currentTag !== expectedTag) {
      failures.push(`snapshot walk expected ${expectedTag} but found ${currentTag}`);
      break;
    }
    if (seen.has(currentTag)) {
      failures.push(`snapshot walk visited ${currentTag} more than once`);
      break;
    }

    seen.add(currentTag);
    visited.push(currentTag);

    const snapshot = snapshots[currentTag];
    if (!snapshot) {
      failures.push(`snapshot walk reached missing snapshot ${currentTag}`);
      break;
    }

    const jumpTag = walkJumps[currentTag];
    currentTag = jumpTag ?? tagById.get(snapshot.prevId);
  }

  const unvisited = expected.filter((tag) => !seen.has(tag));
  if (unvisited.length > 0) {
    failures.push(`snapshot walk did not visit: ${unvisited.join(", ")}`);
  }

  const lastVisited = visited[visited.length - 1];
  if (!lastVisited) {
    failures.push(`snapshot walk ended at <none> instead of ${expected[expected.length - 1]}`);
  } else if (lastVisited !== expected[expected.length - 1]) {
    failures.push(`snapshot walk ended at ${lastVisited} instead of ${expected[expected.length - 1]}`);
  } else if (!lastVisited.startsWith("0000_")) {
    failures.push(`snapshot walk ended at ${lastVisited} instead of the 0000 snapshot`);
  } else if (snapshots[lastVisited]?.prevId !== ZERO_ID) {
    failures.push(`0000 snapshot prevId is ${snapshots[lastVisited]?.prevId}; expected ${ZERO_ID}`);
  }

  return failures;
}

function validateMetaChain(
  entries: readonly JournalEntry[],
  sqlTags: readonly string[],
  snapshots: SnapshotByTag,
  allowances: ChainAllowances,
): string[] {
  return [
    ...validateJournal(entries),
    ...validateJournalMatchesSql(entries, sqlTags),
    ...validateSnapshotsPresent(entries, snapshots, allowances.missingSnapshots),
    ...validateUniquePrevIds(snapshots, allowances.duplicateParents),
    ...validateSnapshotWalk(entries, snapshots, allowances.walkJumps),
  ];
}

function packageRoot(): string {
  const filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(filename), "..");
}

function readJournalEntries(metaDir: string): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(metaDir, "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

function readSqlTags(drizzleDir: string): string[] {
  return fs
    .readdirSync(drizzleDir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -".sql".length))
    .sort();
}

function readSnapshots(metaDir: string, entries: readonly JournalEntry[]): SnapshotByTag {
  const snapshots: SnapshotByTag = {};

  for (const entry of entries) {
    const snapshotPath = path.join(metaDir, `${migrationPrefix(entry.tag)}_snapshot.json`);
    if (!fs.existsSync(snapshotPath)) {
      continue;
    }

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as Snapshot;
    snapshots[entry.tag] = {
      id: snapshot.id,
      prevId: snapshot.prevId,
    };
  }

  return snapshots;
}

function assertNoMetaChainFailures(failures: string[]): void {
  expect(failures, failures.join("\n")).toEqual([]);
}

describe("drizzle meta chain", () => {
  const entries: JournalEntry[] = [
    { idx: 0, tag: "0000_base" },
    { idx: 1, tag: "0001_accounts" },
    { idx: 2, tag: "0002_documents" },
  ];
  const sqlTags = entries.map((entry) => entry.tag);
  const snapshots: SnapshotByTag = {
    "0000_base": { id: "snapshot-0", prevId: ZERO_ID },
    "0001_accounts": { id: "snapshot-1", prevId: "snapshot-0" },
    "0002_documents": { id: "snapshot-2", prevId: "snapshot-1" },
  };
  const noAllowances: ChainAllowances = {
    missingSnapshots: [],
    duplicateParents: [],
    walkJumps: {},
  };

  it("keeps the real drizzle journal, SQL files, and snapshots consistent", () => {
    const drizzleDir = path.join(packageRoot(), "drizzle");
    const metaDir = path.join(drizzleDir, "meta");
    const realEntries = readJournalEntries(metaDir);
    const realSqlTags = readSqlTags(drizzleDir);
    const realSnapshots = readSnapshots(metaDir, realEntries);

    assertNoMetaChainFailures(validateMetaChain(realEntries, realSqlTags, realSnapshots, REAL_CHAIN_ALLOWANCES));
  });

  it("fails when a journal entry is appended without its generated snapshot", () => {
    const brokenEntries = [...entries, { idx: 3, tag: "0003_missing_snapshot" }];
    const brokenSqlTags = [...sqlTags, "0003_missing_snapshot"];

    expect(validateMetaChain(brokenEntries, brokenSqlTags, snapshots, noAllowances)).toContain(
      "journal tag has no snapshot and is not historically allowlisted: 0003_missing_snapshot",
    );
  });

  it("fails when two snapshots share a prevId", () => {
    const brokenSnapshots: SnapshotByTag = {
      ...snapshots,
      "0002_documents": { id: "snapshot-2", prevId: "snapshot-0" },
    };

    expect(validateMetaChain(entries, sqlTags, brokenSnapshots, noAllowances)).toContain(
      "snapshots share prevId snapshot-0: 0001_accounts -> 0002_documents",
    );
  });

  it("fails when the snapshot walk is broken", () => {
    const brokenSnapshots: SnapshotByTag = {
      ...snapshots,
      "0002_documents": { id: "snapshot-2", prevId: "missing-parent" },
    };

    expect(validateMetaChain(entries, sqlTags, brokenSnapshots, noAllowances)).toEqual(
      expect.arrayContaining([
        "snapshot walk ended before expected 0001_accounts",
        "snapshot walk did not visit: 0001_accounts, 0000_base",
      ]),
    );
  });
});
