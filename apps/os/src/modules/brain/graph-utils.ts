export interface BrainGraphNodeLike {
  id: string;
  type: string;
  title: string;
  scopePath: string;
  slug?: string;
  flagged?: boolean;
}

export interface BrainGraphEdgeLike {
  source: string;
  target: string;
}

export interface BrainGraphFilters {
  query?: string;
  scopePrefix?: string;
  types?: string[];
  flaggedOnly?: boolean;
}

function matchesQuery(node: BrainGraphNodeLike, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [node.title, node.scopePath, node.slug, node.type]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function matchesScope(node: BrainGraphNodeLike, scopePrefix: string): boolean {
  const prefix = scopePrefix.trim();
  if (!prefix || prefix === "root") return true;
  return node.scopePath === prefix || node.scopePath.startsWith(`${prefix}/`);
}

export function filterBrainGraph<TNode extends BrainGraphNodeLike, TEdge extends BrainGraphEdgeLike>(
  nodes: TNode[],
  edges: TEdge[],
  filters: BrainGraphFilters
): { nodes: TNode[]; edges: TEdge[]; focusNodeId: string | null } {
  const typeSet = new Set(filters.types || []);
  const hasTypeFilter = typeSet.size > 0;
  const filteredNodes = nodes.filter((node) => {
    if (filters.flaggedOnly && !node.flagged) return false;
    if (hasTypeFilter && !typeSet.has(node.type)) return false;
    if (filters.scopePrefix && !matchesScope(node, filters.scopePrefix)) return false;
    return matchesQuery(node, filters.query || "");
  });
  const ids = new Set(filteredNodes.map((node) => node.id));
  return {
    nodes: filteredNodes,
    edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    focusNodeId: filters.query?.trim() ? filteredNodes[0]?.id ?? null : null,
  };
}
