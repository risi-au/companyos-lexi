"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, ChevronDown, Plus } from "lucide-react";
import type { Scope } from "@companyos/db";
import { createNewScope } from "./actions";

interface SidebarProps {
  tree: Scope[];
}

export function Sidebar({ tree }: SidebarProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ root: true });
  const [showNew, setShowNew] = useState(false);

  // Build children map
  const byParent: Record<string, Scope[]> = {};
  const roots: Scope[] = [];
  for (const s of tree) {
    if (!s.parentId) {
      roots.push(s);
    } else {
      (byParent[s.parentId] ||= []).push(s);
    }
  }

  const currentPath = pathname?.startsWith("/s/") ? pathname.replace("/s/", "") : null;

  function toggle(id: string) {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  }

  function renderNode(node: Scope, depth: number) {
    const kids = byParent[node.id] || [];
    const isOpen = expanded[node.id] ?? (depth < 1);
    const isActive = currentPath === node.path;
    const indent = depth * 12;

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] cursor-pointer ${isActive ? "bg-[var(--muted)] font-medium" : ""}`}
          style={{ paddingLeft: `calc(var(--space-2) + ${indent}px)` }}
          onClick={() => kids.length > 0 && toggle(node.id)}
        >
          {kids.length > 0 ? (
            isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : (
            <span style={{ width: 14 }} />
          )}
          <Link
            href={`/s/${node.path}`}
            className="flex-1 truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {node.name}
          </Link>
          <span className="ml-auto text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{node.type === "project" ? "Project / Client" : node.type === "subproject" ? "Sub-project" : node.type}</span>
        </div>
        {isOpen && kids.length > 0 && (
          <div>
            {kids
              .slice()
              .sort((a, b) => a.path.localeCompare(b.path))
              .map((k) => renderNode(k, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-[var(--space-2)] text-[var(--foreground)]">
      <div className="mb-[var(--space-2)] flex items-center justify-between px-[var(--space-2)] text-[var(--font-size-xs)] uppercase tracking-[0.5px] text-[var(--muted-foreground)]">
        <span>Scopes</span>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--muted)]"
          title="New scope"
          aria-label="Create new scope"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Tree */}
      {roots
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((r) => renderNode(r, 0))}

      {/* New Scope minimal dialog (client) */}
      {showNew && (
        <NewScopeDialog
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            // refresh page for tree (simple)
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

/** Minimal inline dialog using Server Action for + New scope */
function NewScopeDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [pending, setPending] = useState(false);
  // Simple client validation display; real via action
  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const res = await createNewScope(formData);
      if (res?.error) {
        alert(res.error);
      } else if (res?.path) {
        onCreated();
        window.location.href = `/s/${res.path}`;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Create scope failed";
      alert(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--muted)]/60" onClick={onClose}>
      <div
        className="w-[320px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[var(--font-size-md)] font-medium">New scope</div>
        <form action={handleSubmit} className="space-y-[var(--space-3)]">
          <input
            name="name"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="Name"
            required
          />
          <input
            name="slug"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="slug (optional)"
          />
          <select
            name="type"
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            defaultValue="project"
          >
            <option value="project">Project / Client</option>
            <option value="subproject">Sub-project</option>
          </select>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded border border-[var(--border)] py-[var(--space-2)] text-[var(--font-size-sm)]">Cancel</button>
            <button type="submit" disabled={pending} className="flex-1 rounded bg-[var(--primary)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">{pending ? "Creating..." : "Create"}</button>
          </div>
        </form>
        <p className="mt-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Parent defaults to root for top level.</p>
      </div>
    </div>
  );
}
