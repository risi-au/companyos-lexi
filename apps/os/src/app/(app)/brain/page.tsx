import Link from "next/link";
import { notFound } from "next/navigation";
import { Network, Settings2 } from "lucide-react";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { BrainGraphCanvas } from "@/modules/brain";

function isRootAdmin(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

export default async function BrainPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const rootRole = await api.resolveAccess(actor, "root");
  if (!isRootAdmin(rootRole)) notFound();

  const graph = await api.getBrainGraph({ nodeLimit: 1600, edgeLimit: 5000 }, actor);

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="text-[var(--font-size-2xl)] font-semibold tracking-[-0.01em]">Brain</h1>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Global knowledge graph
          </div>
        </div>
        <div className="flex items-center gap-[var(--space-2)] text-[var(--font-size-sm)]">
          <Link
            href="/brain"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--primary)]"
          >
            <Network size={16} />
            Graph
          </Link>
          <Link
            href="/brain/engine"
            className="inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
          >
            <Settings2 size={16} />
            Engine
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-[var(--space-3)] md:grid-cols-4">
        <Stat label="Nodes" value={graph.meta.returnedNodes} />
        <Stat label="Edges" value={graph.meta.returnedEdges} />
        <Stat label="Total nodes" value={graph.meta.totalNodes} />
        <Stat label="Total edges" value={graph.meta.totalEdges} />
      </div>

      <BrainGraphCanvas graph={graph} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]">
      <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{label}</div>
      <div className="mt-[var(--space-1)] font-mono text-[var(--font-size-xl)] tabular-nums">{value.toLocaleString()}</div>
    </div>
  );
}
