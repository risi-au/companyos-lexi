import { describe, expect, it } from "vitest";
import { filterBrainGraph } from "./graph-utils";

const nodes = [
  { id: "scope:root", type: "scope", title: "Root", scopePath: "root" },
  { id: "scope:a", type: "scope", title: "AirBuddy", scopePath: "airbuddy" },
  { id: "doc:a:wiki", type: "wiki-page", title: "Meta Ads Wiki", scopePath: "airbuddy", slug: "wiki", flagged: true },
  { id: "doc:b:wiki", type: "wiki-page", title: "Other Wiki", scopePath: "indya", slug: "wiki" },
  { id: "pattern", type: "root-pattern", title: "Pattern: Paid Media", scopePath: "root", slug: "pattern-paid-media" },
];

const edges = [
  { source: "scope:root", target: "scope:a" },
  { source: "scope:a", target: "doc:a:wiki" },
  { source: "doc:b:wiki", target: "pattern" },
];

describe("brain graph filters", () => {
  it("filters by scope, type, flagged only, and search focus", () => {
    const filtered = filterBrainGraph(nodes, edges, {
      scopePrefix: "airbuddy",
      types: ["wiki-page"],
      flaggedOnly: true,
      query: "meta",
    });

    expect(filtered.nodes.map((node) => node.id)).toEqual(["doc:a:wiki"]);
    expect(filtered.edges).toEqual([]);
    expect(filtered.focusNodeId).toBe("doc:a:wiki");
  });

  it("keeps edges only when both endpoints remain visible", () => {
    const filtered = filterBrainGraph(nodes, edges, { scopePrefix: "airbuddy" });

    expect(filtered.nodes.map((node) => node.id)).toEqual(["scope:a", "doc:a:wiki"]);
    expect(filtered.edges).toEqual([{ source: "scope:a", target: "doc:a:wiki" }]);
  });
});
