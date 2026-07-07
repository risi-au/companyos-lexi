"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BrainCircuit, ExternalLink, Plus } from "lucide-react";
import type { Scope } from "@companyos/db";
import { setSelectedProject, createNewScope } from "./actions";

interface SidebarProps {
  tree: Scope[];
  selected?: string | null;
  taskManagerUrl?: string | null;
  instanceName?: string;
  rootRole?: string | null;
}

export function Sidebar({ tree, selected, taskManagerUrl, instanceName = "CompanyOS", rootRole = null }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const currentPath = pathname?.startsWith("/s/") ? pathname.replace("/s/", "").split("?")[0] : "";
  const currentTab = searchParams?.get("tab") || "";

  const hasRootGrant = tree.some((s: Scope) => s.type === "root" || s.path === "root");
  const showBrain = rootRole === "owner" || rootRole === "admin";
  const topLevelProjects: Scope[] = tree
    .filter((s: Scope) => s.type === "project" && s.path.split("/").length === 1)
    .sort((a: Scope, b: Scope) => a.path.localeCompare(b.path));

  // Nodes to render for the selected project (or root overview)
  const navNodes: Scope[] = [];
  if (selected && selected !== "root") {
    const proj = tree.find((s: Scope) => s.path === selected);
    if (proj) {
      navNodes.push(proj);
      const prefix = selected + "/";
      const subs = tree
        .filter((s: Scope) => s.path.startsWith(prefix))
        .sort((a: Scope, b: Scope) => a.path.localeCompare(b.path));
      navNodes.push(...subs);
    }
  } else if (selected === "root") {
    const rt = tree.find((s: Scope) => s.path === "root" || s.type === "root");
    if (rt) navNodes.push(rt);
  }

  function isHeaderActive(path: string): boolean {
    return currentPath === path;
  }

  function isModuleActive(path: string, tab: string): boolean {
    if (currentPath !== path) return false;
    const effectiveTab = currentTab || "dashboard";
    return effectiveTab === tab;
  }

  const moduleTabs = ["dashboard", "overview", "activity", "docs", "canvas", "intake"] as const;

  return (
    <div className="flex-1 overflow-auto p-[var(--space-2)] text-[var(--foreground)] text-[var(--font-size-sm)]">
      {/* Project switcher (top of sidebar, under instance name) */}
      <div className="mb-[var(--space-3)] px-[var(--space-1)]">
        <div className="mb-[var(--space-1)] flex items-center justify-between text-[var(--font-size-xs)] uppercase tracking-[0.5px] text-[var(--muted-foreground)]">
          <span>Project</span>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--muted)]"
            title="New scope"
            aria-label="Create new scope"
          >
            <Plus size={14} />
          </button>
        </div>
        <form action={setSelectedProject}>
          <select
            name="path"
            defaultValue={selected || topLevelProjects[0]?.path || (hasRootGrant ? "root" : "")}
            onChange={(e) => {
              const form = e.currentTarget.form;
              if (form) form.requestSubmit();
            }}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] cursor-pointer"
            aria-label="Select active project"
          >
            {hasRootGrant && (
              <option value="root">⌂ {instanceName} overview</option>
            )}
            {topLevelProjects.map((p) => (
              <option key={p.path} value={p.path}>{p.name}</option>
            ))}
            {!hasRootGrant && topLevelProjects.length === 0 && <option value="">No projects</option>}
          </select>
        </form>
      </div>

      {showBrain && (
        <div className="mb-[var(--space-3)] px-[var(--space-1)]">
          <Link
            href="/brain"
            className={`flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] ${pathname?.startsWith("/brain") ? "bg-[var(--muted)] font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
          >
            <BrainCircuit size={16} />
            Brain
          </Link>
        </div>
      )}

      {/* Sections: selected project + nested subprojects (indented) */}
      {navNodes.length === 0 && (
        <div className="px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          No visible projects.
        </div>
      )}

      {navNodes.map((node) => {
        const depth = node.path.split("/").length - 1;
        const baseDepth = selected && selected !== "root" ? selected.split("/").length - 1 : 0;
        const indent = Math.max(0, depth - baseDepth) * 12;
        const isTopProject = node.path === selected && node.type === "project";
        const showMembers = isTopProject;
        const showTask = isTopProject && !!taskManagerUrl;

        return (
          <div key={node.id} className="mb-[var(--space-3)]">
            {/* Section header links to scope page (default tab) */}
            <Link
              href={`/s/${node.path}`}
              className={`block rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] font-medium hover:bg-[var(--muted)] truncate ${isHeaderActive(node.path) ? "bg-[var(--muted)] text-[var(--primary)]" : ""}`}
              style={{ paddingLeft: `calc(var(--space-2) + ${indent}px)` }}
            >
              {node.name}
            </Link>

            {/* Module links under header */}
            <div className="mt-[var(--space-1)] space-y-[1px]" style={{ paddingLeft: `calc(var(--space-3) + ${indent}px)` }}>
              {moduleTabs.map((tab) => {
                const href = `/s/${node.path}?tab=${tab}`;
                const active = isModuleActive(node.path, tab);
                const label = tab.charAt(0).toUpperCase() + tab.slice(1);
                return (
                  <Link
                    key={tab}
                    href={href}
                    className={`block rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] ${active ? "font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
                  >
                    {label}
                  </Link>
                );
              })}

              {/* Members only for the (top) project section, per spec */}
              {showMembers && (
                <Link
                  href={`/s/${node.path}?tab=members`}
                  className={`block rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] ${isModuleActive(node.path, "members") ? "font-medium text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
                >
                  Members
                </Link>
              )}

              {/* Task Manager link (external) only in project section, server href */}
              {showTask && taskManagerUrl && (
                <a
                  href={taskManagerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-[var(--space-1)] flex items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                >
                  Task Manager <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>
        );
      })}

      {showNew && (
        <NewScopeDialog
          tree={tree}
          defaultParent={selected && selected !== "root" ? selected : ""}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}

/** Minimal inline dialog using the createNewScope server action */
function NewScopeDialog({ tree, defaultParent, onClose }: { tree: Scope[]; defaultParent: string; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [parent, setParent] = useState(defaultParent);

  // Any visible project/subproject can be a parent; empty = top level
  const parentOptions: Scope[] = tree
    .filter((s: Scope) => s.type === "project" || s.type === "subproject")
    .sort((a: Scope, b: Scope) => a.path.localeCompare(b.path));

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const res = await createNewScope(formData);
      if (res?.error) {
        alert(res.error);
      } else if (res?.path) {
        onClose();
        window.location.href = `/s/${res.path}?wizard=${encodeURIComponent(res.intakeId || "new")}`;
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Create scope failed");
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
            name="parentPath"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            aria-label="Parent scope"
          >
            <option value="">(top level — new Project / Client)</option>
            {parentOptions.map((p) => (
              <option key={p.path} value={p.path}>{p.path}</option>
            ))}
          </select>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded border border-[var(--border)] py-[var(--space-2)] text-[var(--font-size-sm)]">Cancel</button>
            <button type="submit" disabled={pending} className="flex-1 rounded bg-[var(--primary)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)]">{pending ? "Creating..." : "Create"}</button>
          </div>
        </form>
        <p className="mt-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Top level creates a Project / Client; picking a parent creates a Sub-project under it.</p>
      </div>
    </div>
  );
}
