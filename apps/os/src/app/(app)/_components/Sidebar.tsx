"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { anim, df, rm, useToast } from "@companyos/ui";
import { Activity, BrainCircuit, ChevronRight, ExternalLink, Home, Plus, Shield } from "lucide-react";
import type { Scope } from "@companyos/db";
import { setSelectedProject, createNewScope } from "./actions";

interface SidebarProps {
  tree: Scope[];
  selected?: string | null;
  taskManagerUrl?: string | null;
  instanceName?: string;
  rootRole?: string | null;
}

/** Real app module set + tab slugs (mirrors s/[...path]/page.tsx — do NOT diverge). */
const MODULES: Array<{ tab: string; label: string }> = [
  { tab: "dashboard", label: "Dashboard" },
  { tab: "overview", label: "Overview" },
  { tab: "activity", label: "Activity" },
  { tab: "work-log", label: "Work Log" },
  { tab: "sessions", label: "Sessions" },
  { tab: "docs", label: "Docs" },
  { tab: "canvas", label: "Canvas" },
  { tab: "connect", label: "Connect" },
  { tab: "credentials", label: "Credentials" },
  { tab: "intake", label: "Intake" },
];

const INDENT_STEP = 16; // px per depth level (design-system-v2 §5)

type TreeNodeData = { scope: Scope; children: TreeNodeData[] };

function buildForest(scopes: Scope[]): TreeNodeData[] {
  const byPath = new Map<string, TreeNodeData>();
  const sorted = [...scopes].sort((a, b) => a.path.localeCompare(b.path));
  for (const s of sorted) byPath.set(s.path, { scope: s, children: [] });

  const roots: TreeNodeData[] = [];
  for (const node of byPath.values()) {
    const p = node.scope.path;
    const idx = p.lastIndexOf("/");
    if (idx === -1) {
      roots.push(node);
    } else {
      const parent = byPath.get(p.slice(0, idx));
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan (parent not visible) — surface at top level
    }
  }

  roots.sort((a, b) => {
    const ar = a.scope.type === "root" ? 0 : 1;
    const br = b.scope.type === "root" ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.scope.name.localeCompare(b.scope.name);
  });
  return roots;
}

/** Every path segment prefix of `path`, e.g. "a/b/c" → {a, a/b, a/b/c}. */
function ancestorsOf(path: string): Set<string> {
  const set = new Set<string>();
  if (!path) return set;
  let acc = "";
  for (const part of path.split("/")) {
    acc = acc ? `${acc}/${part}` : part;
    set.add(acc);
  }
  return set;
}

interface NodeContext {
  activeScope: string;
  selected: string | null;
  currentTab: string;
  taskManagerUrl: string | null;
  expandedInit: Set<string>;
  instanceName: string;
}

export function Sidebar({ tree, selected = null, taskManagerUrl = null, instanceName = "CompanyOS", rootRole = null }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showNew, setShowNew] = useState(false);

  const currentPath = pathname?.startsWith("/s/") ? pathname.replace("/s/", "").split("?")[0] : "";
  const currentTab = searchParams?.get("tab") || "";

  const showSystem = rootRole === "owner" || rootRole === "admin";

  // Active scope: the scope page you're on, else the cookie-selected project.
  const activeScope = currentPath || (selected ?? "");

  const forest = useMemo(() => buildForest(tree), [tree]);
  const expandedInit = useMemo(() => ancestorsOf(activeScope), [activeScope]);

  const ctx: NodeContext = {
    activeScope,
    selected,
    currentTab,
    taskManagerUrl,
    expandedInit,
    instanceName,
  };

  return (
    <div className="flex-1 overflow-auto p-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--fg)]">
      {/* work group — expand/collapse project tree */}
      <div className="mb-[var(--space-4)]">
        <div className="mb-[var(--space-1)] flex items-center justify-between px-[var(--space-2)]">
          <span
            className="text-[var(--font-size-xs)] lowercase tracking-[0.08em] text-[var(--faded)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            work
          </span>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex cursor-pointer items-center rounded-[var(--radius-2)] p-[var(--space-1)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            title="New scope"
            aria-label="Create new scope"
          >
            <Plus size={14} />
          </button>
        </div>

        {forest.length === 0 ? (
          <div className="px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--mutedfg)]">
            No visible projects.
          </div>
        ) : (
          <div>
            {forest.map((node) => (
              <TreeNode key={node.scope.id} node={node} level={0} ctx={ctx} />
            ))}
          </div>
        )}
      </div>

      {/* system group — flat, gated on rootRole (owner/admin) */}
      {showSystem && (
        <div className="mb-[var(--space-2)]">
          <div className="mb-[var(--space-1)] px-[var(--space-2)]">
            <span
              className="text-[var(--font-size-xs)] lowercase tracking-[0.08em] text-[var(--faded)]"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              system
            </span>
          </div>
          <SystemLink href="/brain" active={!!pathname?.startsWith("/brain")} icon={<BrainCircuit size={16} />} label="Brain" />
          <SystemLink
            href="/admin/health"
            active={!!pathname?.startsWith("/admin/health")}
            icon={<Activity size={16} />}
            label="Ops Health"
          />
          <SystemLink
            href="/admin"
            active={!!pathname?.startsWith("/admin") && !pathname?.startsWith("/admin/health")}
            icon={<Shield size={16} />}
            label="Admin"
          />
        </div>
      )}

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

function SystemLink({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-[var(--space-2)] rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] ${
        active ? "bg-[var(--selected)] font-medium text-[var(--primary)]" : "text-[var(--mutedfg)]"
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

function TreeNode({ node, level, ctx }: { node: TreeNodeData; level: number; ctx: NodeContext }) {
  const { scope } = node;
  const hasChildren = node.children.length > 0;
  const isActive = ctx.activeScope === scope.path;
  const isTopLevel = level === 0;
  const isRoot = scope.type === "root" || scope.path === "root";
  const label = isRoot ? ctx.instanceName : scope.name;

  const [open, setOpen] = useState(() => ctx.expandedInit.has(scope.path));
  const chevronRef = useRef<HTMLSpanElement | null>(null);
  const childrenRef = useRef<HTMLDivElement | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    const chevron = chevronRef.current;
    if (firstRun.current) {
      firstRun.current = false;
      if (chevron) chevron.style.transform = `rotate(${open ? 90 : 0}deg)`;
      return;
    }
    if (rm()) {
      if (chevron) chevron.style.transform = `rotate(${open ? 90 : 0}deg)`;
      return;
    }
    void anim((gsap) => {
      if (chevron) gsap.to(chevron, { rotate: open ? 90 : 0, duration: df(0.18), ease: "power2.out" });
      const kids = childrenRef.current;
      if (open && kids && kids.children.length > 0) {
        gsap.from(Array.from(kids.children), {
          opacity: 0,
          y: -4,
          duration: df(0.18),
          stagger: df(0.03),
          ease: "power2.out",
          clearProps: "opacity,transform",
        });
      }
    });
  }, [open]);

  function toggle() {
    if (hasChildren) setOpen((v) => !v);
  }

  function onChevronKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  }

  const rowPadLeft = `${level * INDENT_STEP + 4}px`;

  const labelInner = (
    <>
      {isActive && <span aria-hidden className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--primary)]" />}
      {isRoot && !isActive && <Home size={14} className="shrink-0 text-[var(--mutedfg)]" />}
      <span className="truncate">{label}</span>
    </>
  );

  const labelClass = `flex min-w-0 flex-1 items-center gap-[var(--space-2)] rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-1)] text-left hover:bg-[var(--hover)] ${
    isActive ? "bg-[var(--selected)] font-medium text-[var(--primary)]" : "text-[var(--fg)]"
  } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]`;

  return (
    <div>
      <div className="flex items-center gap-[var(--space-1)]" style={{ paddingLeft: rowPadLeft }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            onKeyDown={onChevronKeyDown}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            className="inline-flex h-[20px] w-[16px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-2)] text-[var(--mutedfg)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]"
          >
            <span ref={chevronRef} className="inline-flex">
              <ChevronRight size={14} />
            </span>
          </button>
        ) : (
          <span aria-hidden className="inline-block h-[20px] w-[16px] shrink-0" />
        )}

        {isTopLevel ? (
          <form action={setSelectedProject} className="flex min-w-0 flex-1">
            <input type="hidden" name="path" value={scope.path} />
            <button type="submit" aria-current={isActive ? "page" : undefined} className={`${labelClass} cursor-pointer`}>
              {labelInner}
            </button>
          </form>
        ) : (
          <Link href={`/s/${scope.path}`} aria-current={isActive ? "page" : undefined} className={labelClass}>
            {labelInner}
          </Link>
        )}
      </div>

      {/* Module rows render inline under the active scope leaf */}
      {isActive && <ModuleRows scope={scope} level={level + 1} ctx={ctx} />}

      {hasChildren && open && (
        <div ref={childrenRef}>
          {node.children.map((child) => (
            <TreeNode key={child.scope.id} node={child} level={level + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleRows({ scope, level, ctx }: { scope: Scope; level: number; ctx: NodeContext }) {
  const padLeft = `${level * INDENT_STEP + 20}px`;
  const effectiveTab = ctx.currentTab || "dashboard";
  const showMembers = scope.type === "project";
  const showTask = scope.type === "project" && scope.path === ctx.selected && !!ctx.taskManagerUrl;

  const rows = [...MODULES];
  if (showMembers) rows.push({ tab: "members", label: "Members" });

  return (
    <div className="mt-[var(--space-1)] mb-[var(--space-1)]" style={{ paddingLeft: padLeft }}>
      {rows.map(({ tab, label }) => {
        const active = effectiveTab === tab;
        // Attention-badge seam: if a per-module count source lands, render a
        // badge (a var(--accent)/var(--warn) circle) on the row here. No count
        // data source exists today — do not fabricate counts.
        return (
          <Link
            key={tab}
            href={`/s/${scope.path}?tab=${tab}`}
            aria-current={active ? "page" : undefined}
            className={`block rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] hover:bg-[var(--hover)] ${
              active ? "bg-[var(--selected)] font-medium text-[var(--primary)]" : "text-[var(--mutedfg)]"
            }`}
          >
            {label}
          </Link>
        );
      })}

      {showTask && ctx.taskManagerUrl && (
        <a
          href={ctx.taskManagerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[var(--space-1)] flex items-center gap-[var(--space-1)] rounded-[var(--radius-3)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
        >
          Task Manager <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

/** Minimal inline dialog using the createNewScope server action (behavior preserved from M4-02). */
function NewScopeDialog({ tree, defaultParent, onClose }: { tree: Scope[]; defaultParent: string; onClose: () => void }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [parent, setParent] = useState(defaultParent);

  const parentOptions: Scope[] = tree
    .filter((s: Scope) => s.type === "project" || s.type === "subproject")
    .sort((a: Scope, b: Scope) => a.path.localeCompare(b.path));

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const res = await createNewScope(formData);
      if (res?.error) {
        toast.error(res.error);
      } else if (res?.path) {
        onClose();
        window.location.href = `/s/${res.path}?wizard=${encodeURIComponent(res.intakeId || "new")}`;
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Create scope failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] px-[var(--space-4)]" onClick={onClose}>
      <div
        className="w-[320px] rounded-[var(--radius-4)] border border-[var(--border)] bg-[var(--raised)] p-[var(--space-4)] text-[var(--fg)] shadow-[var(--shadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-[var(--space-3)] text-[var(--font-size-md)] font-medium">New scope</div>
        <form action={handleSubmit} className="space-y-[var(--space-3)]">
          <input
            name="name"
            className="w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="Name"
            required
          />
          <input
            name="slug"
            className="w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="slug (optional)"
          />
          <select
            name="parentPath"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            aria-label="Parent scope"
          >
            <option value="">(top level — new Project / Client)</option>
            {parentOptions.map((p) => (
              <option key={p.path} value={p.path}>{p.path}</option>
            ))}
          </select>
          <textarea
            name="reason"
            className="min-h-24 w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            placeholder="What is this scope for?"
            required
          />
          <div className="flex gap-[var(--space-2)] pt-[var(--space-1)]">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-[var(--radius-3)] border border-[var(--border)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--hover)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-[var(--radius-3)] bg-[var(--primary)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primaryfg)] hover:bg-[var(--primaryhover)] disabled:opacity-60"
            >
              {pending ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
        <p className="mt-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--mutedfg)]">
          Top level creates a Project / Client; picking a parent creates a Sub-project under it.
        </p>
      </div>
    </div>
  );
}
