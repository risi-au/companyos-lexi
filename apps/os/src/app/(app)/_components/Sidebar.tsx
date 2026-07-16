"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { anim, df, rm, useToast } from "@companyos/ui";
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Gauge,
  Grid2X2,
  Home,
  KeyRound,
  LayoutDashboard,
  Link2,
  Minus,
  MonitorPlay,
  NotebookTabs,
  Palette,
  Plus,
  Search,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import type { Scope } from "@companyos/db";
import { useSidebarDrawer } from "./AppShellChrome";
import { setSelectedProject, createNewScope } from "./actions";
import {
  SIDEBAR_MODULES_STORAGE_KEY,
  accordionBranchForPath,
  parseStoredModuleShortcut,
  serializeStoredModuleShortcut,
  isNewScopeParentOption,
  toggleAccordionPath,
  toggleModuleShortcutPath,
} from "./sidebar-state";

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
  { tab: "docs", label: "Wiki" },
  { tab: "canvas", label: "Canvas" },
  { tab: "connect", label: "Worker tokens" },
  { tab: "credentials", label: "Platform connections" },
  { tab: "intake", label: "Setup" },
];

const MODULE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  dashboard: LayoutDashboard,
  overview: Grid2X2,
  activity: Activity,
  "work-log": NotebookTabs,
  sessions: MonitorPlay,
  docs: FileText,
  canvas: Palette,
  connect: Link2,
  credentials: KeyRound,
  intake: Settings,
  members: Users,
};

const hoverUnderlineClass =
  "[background-image:linear-gradient(var(--accent),var(--accent))] [background-position:0_100%] [background-repeat:no-repeat] [background-size:0%_1.5px] transition-[background-size,background-color,color] duration-[250ms] ease-out hover:[background-size:100%_1.5px] motion-reduce:transition-none";
const activeUnderlineClass =
  "[background-image:linear-gradient(var(--primary),var(--primary))] [background-position:0_100%] [background-repeat:no-repeat] [background-size:100%_2px]";

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

function filterForest(nodes: TreeNodeData[], query: string): TreeNodeData[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  return nodes.flatMap((node) => {
    const children = filterForest(node.children, q);
    const scope = node.scope;
    const selfMatch = scope.name.toLowerCase().includes(q) || scope.path.toLowerCase().includes(q);
    return selfMatch || children.length > 0 ? [{ scope, children }] : [];
  });
}

interface NodeContext {
  activeScope: string;
  selected: string | null;
  currentTab: string;
  taskManagerUrl: string | null;
  expandedPaths: ReadonlySet<string>;
  openBranch: (path: string) => void;
  toggleBranch: (path: string) => void;
  moduleShortcutPath: string | null;
  toggleModuleShortcuts: (path: string) => void;
  instanceName: string;
  searchQuery: string;
}

export function Sidebar({ tree, selected = null, taskManagerUrl = null, instanceName = "CompanyOS", rootRole = null }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPath = pathname?.startsWith("/s/") ? (pathname.replace("/s/", "").split("?")[0] ?? "") : "";
  const currentTab = searchParams?.get("tab") || "";
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => accordionBranchForPath(currentPath));
  const [moduleShortcutPath, setModuleShortcutPath] = useState<string | null>(null);
  const { closeDrawer } = useSidebarDrawer();

  const showSystem = rootRole === "owner" || rootRole === "admin";

  // Active scope: the scope page you're on, else the cookie-selected project.
  const activeScope = currentPath || (selected ?? "");

  const forest = useMemo(() => buildForest(tree), [tree]);
  const visibleForest = useMemo(() => filterForest(forest, query), [forest, query]);

  useEffect(() => {
    if (currentPath) setExpandedPaths(accordionBranchForPath(currentPath));
  }, [currentPath]);

  useEffect(() => {
    try {
      setModuleShortcutPath(parseStoredModuleShortcut(window.localStorage.getItem(SIDEBAR_MODULES_STORAGE_KEY), activeScope));
    } catch {
      setModuleShortcutPath(null);
    }
  }, [activeScope]);

  const openBranch = (path: string) => setExpandedPaths(accordionBranchForPath(path));
  const toggleBranch = (path: string) => setExpandedPaths((current) => toggleAccordionPath(current, path));
  const toggleModuleShortcuts = (path: string) => {
    setModuleShortcutPath((current) => {
      const next = toggleModuleShortcutPath(current, path);
      try {
        window.localStorage.setItem(SIDEBAR_MODULES_STORAGE_KEY, serializeStoredModuleShortcut(next));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  };

  const ctx: NodeContext = {
    activeScope,
    selected,
    currentTab,
    taskManagerUrl,
    expandedPaths,
    openBranch,
    toggleBranch,
    moduleShortcutPath,
    toggleModuleShortcuts,
    instanceName,
    searchQuery: query,
  };

  return (
    <>
    <div className="border-b border-[var(--border)] p-[var(--space-3)]">
      <div className="flex h-[34px] items-center gap-[var(--space-2)]">
        <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--primary)] text-[var(--font-size-sm)] font-semibold text-[var(--primaryfg)]">
          {instanceName.trim().charAt(0).toUpperCase() || "C"}
        </div>
        <div
          className="flex min-w-0 flex-1 items-center gap-[var(--space-1)] rounded-[var(--radius-3)] px-[var(--space-1)] py-[var(--space-1)] text-left text-[var(--font-size-sm)] font-medium text-[var(--fg)]"
          aria-label="Workspace switcher"
        >
          <span className="truncate">{instanceName}</span>
          <ChevronDown size={14} className="shrink-0 text-[var(--mutedfg)]" />
        </div>
        <button
          type="button"
          onClick={closeDrawer}
          className="hidden h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-[var(--radius-3)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] max-[820px]:inline-flex"
          aria-label="Close navigation"
        >
          <X size={16} />
        </button>
      </div>

      <label className="mt-[var(--space-3)] flex h-[34px] items-center gap-[var(--space-2)] rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--mutedfg)] focus-within:border-[var(--borderstrong)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--primary)]">
        <Search size={14} className="shrink-0" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[var(--fg)] outline-none placeholder:text-[var(--mutedfg)]"
          placeholder="Search"
          aria-label="Filter navigation"
        />
        <span className="rounded-[var(--radius-2)] border border-[var(--border)] bg-[var(--surface)] px-[6px] py-[2px] font-mono text-[11px] leading-none text-[var(--mutedfg)]">
          ⌘K
        </span>
      </label>
    </div>

    <div className="flex-1 overflow-auto p-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--fg)]">
      {/* work group — expand/collapse project tree */}
      <div className="mb-[var(--space-4)]">
        <div className="mb-[var(--space-1)] flex items-center justify-between px-[var(--space-2)]">
          <span
            className="text-[11px] lowercase text-[var(--faded)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            work
          </span>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex cursor-pointer items-center rounded-[var(--radius-2)] p-[var(--space-1)] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            title="New project"
            aria-label="Create new project"
          >
            <Plus size={14} />
          </button>
        </div>

        {visibleForest.length === 0 ? (
          <div className="px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--mutedfg)]">
            {query.trim() ? "No matching projects." : "No visible projects."}
          </div>
        ) : (
          <div>
            {visibleForest.map((node) => (
              <TreeNode key={node.scope.id} node={node} level={0} ctx={ctx} />
            ))}
          </div>
        )}
      </div>

      {taskManagerUrl && (
        <div className="mb-[var(--space-4)]">
          <a
            href={taskManagerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-[var(--space-1)] flex min-h-[30px] items-center gap-[7px] rounded-[var(--radius-3)] px-[var(--space-2)] text-[13.5px] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] ${hoverUnderlineClass}`}
          >
            <ExternalLink size={14} />
            Task board
          </a>
        </div>
      )}

      {/* system group — flat, gated on rootRole (owner/admin) */}
      {showSystem && (
        <div className="mb-[var(--space-2)]">
          <div className="mb-[var(--space-1)] px-[var(--space-2)]">
            <span
              className="text-[11px] lowercase text-[var(--faded)]"
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
    </>
  );
}

function SystemLink({ href, active, icon, label }: { href: string; active: boolean; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[30px] items-center gap-[7px] rounded-[var(--radius-3)] px-[var(--space-2)] text-[13.5px] ${hoverUnderlineClass} ${
        active ? `bg-[var(--active)] font-medium text-[var(--primary)] ${activeUnderlineClass}` : "text-[var(--mutedfg)] hover:bg-[var(--hover)]"
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

  const open = ctx.expandedPaths.has(scope.path);
  const showingChildren = hasChildren && (open || Boolean(ctx.searchQuery.trim()));
  const moduleShortcutsOpen = ctx.moduleShortcutPath === scope.path;
  const chevronRef = useRef<HTMLSpanElement | null>(null);
  const childrenRef = useRef<HTMLDivElement | null>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    const chevron = chevronRef.current;
    if (firstRun.current) {
      firstRun.current = false;
      if (chevron) chevron.style.transform = `rotate(${showingChildren ? 90 : 0}deg)`;
      return;
    }
    if (rm()) {
      if (chevron) chevron.style.transform = `rotate(${showingChildren ? 90 : 0}deg)`;
      return;
    }
    void anim((gsap) => {
      if (chevron) gsap.to(chevron, { rotate: showingChildren ? 90 : 0, duration: df(0.18), ease: "power2.out" });
      const kids = childrenRef.current;
      if (showingChildren && kids && kids.children.length > 0) {
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
  }, [showingChildren]);

  function toggle() {
    if (hasChildren) ctx.toggleBranch(scope.path);
  }

  const ScopeIcon = isRoot ? Home : isTopLevel ? (showingChildren ? FolderOpen : Folder) : level === 1 ? Gauge : CircleDot;

  const labelInner = (
    <>
      <ScopeIcon size={14} className="shrink-0 text-current" />
      <span className="truncate">{label}</span>
    </>
  );

  const labelClass = `relative flex min-h-[30px] min-w-0 flex-1 items-center gap-[7px] rounded-[var(--radius-3)] px-[var(--space-2)] text-left text-[13.5px] ${hoverUnderlineClass} ${
    isActive ? "bg-[var(--active)] font-medium text-[var(--primary)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"
  } focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]`;
  const activeTick = isActive ? (
    <span aria-hidden="true" className="absolute left-0 top-[5px] h-[calc(100%-10px)] w-[3px] rounded-r-[var(--radius-2)] bg-[var(--primary)]" />
  ) : null;
  const moduleToggle = (
    <button
      type="button"
      onClick={() => ctx.toggleModuleShortcuts(scope.path)}
      aria-expanded={moduleShortcutsOpen}
      aria-label={`${moduleShortcutsOpen ? "Hide" : "Show"} module shortcuts for ${label}`}
      className={`inline-flex h-[28px] w-[24px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-2)] transition-opacity duration-150 hover:bg-[var(--hover)] focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)] motion-reduce:transition-none group-hover:opacity-100 ${
        moduleShortcutsOpen ? "text-[var(--primary)] hover:text-[var(--primary)]" : "opacity-0 text-[var(--mutedfg)] hover:text-[var(--fg)]"
      }`}
    >
      {moduleShortcutsOpen ? <Minus size={13} /> : <Plus size={13} />}
    </button>
  );

  return (
    <div>
      <div className="group flex items-center gap-[var(--space-1)]">
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={showingChildren}
            aria-label={`${showingChildren ? "Collapse" : "Expand"} ${label}`}
            className="inline-flex h-[30px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-2)] text-[var(--mutedfg)] hover:text-[var(--fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--primary)]"
          >
            <span ref={chevronRef} className="inline-flex">
              <ChevronRight size={14} />
            </span>
          </button>
        ) : (
          <span aria-hidden className="inline-block h-[30px] w-[18px] shrink-0" />
        )}

        {isTopLevel ? (
          <form action={setSelectedProject} className="flex min-w-0 flex-1">
            <input type="hidden" name="path" value={scope.path} />
            <button
              type="submit"
              onClick={() => ctx.openBranch(scope.path)}
              aria-current={isActive ? "page" : undefined}
              className={`${labelClass} cursor-pointer`}
            >
              {activeTick}
              {labelInner}
            </button>
          </form>
        ) : (
          <Link
            href={`/s/${scope.path}`}
            onClick={() => ctx.openBranch(scope.path)}
            aria-current={isActive ? "page" : undefined}
            className={labelClass}
          >
            {activeTick}
            {labelInner}
          </Link>
        )}
        {moduleToggle}
      </div>

      {moduleShortcutsOpen && <ModuleRows scope={scope} ctx={ctx} />}

      {showingChildren && (
        <div ref={childrenRef} className="ml-[26px] border-l-2 border-[var(--border)] pl-[var(--space-2)]">
          {node.children.map((child) => (
            <TreeNode key={child.scope.id} node={child} level={level + 1} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleRows({ scope, ctx }: { scope: Scope; ctx: NodeContext }) {
  const effectiveTab = ctx.currentTab || "dashboard";
  const showMembers = scope.type === "project";
  const showTask = scope.type === "project" && scope.path === ctx.selected && !!ctx.taskManagerUrl;

  const rows = [...MODULES];
  if (showMembers) rows.push({ tab: "members", label: "Members" });

  return (
    <div className="my-[var(--space-1)] ml-[26px] border-l-2 border-[var(--primary)] pl-[var(--space-2)]">
      {rows.map(({ tab, label }) => {
        const active = scope.path === ctx.activeScope && effectiveTab === tab;
        const Icon = MODULE_ICONS[tab] ?? Grid2X2;
        return (
          <Link
            key={tab}
            href={`/s/${scope.path}?tab=${tab}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[30px] items-center gap-[7px] rounded-[var(--radius-3)] px-[var(--space-2)] text-[13.5px] ${hoverUnderlineClass} ${
              active ? `bg-[var(--active)] font-medium text-[var(--primary)] ${activeUnderlineClass}` : "text-[var(--mutedfg)] hover:bg-[var(--hover)]"
            }`}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </Link>
        );
      })}

      {showTask && ctx.taskManagerUrl && (
        <a
          href={ctx.taskManagerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-[var(--space-1)] flex min-h-[30px] items-center gap-[7px] rounded-[var(--radius-3)] px-[var(--space-2)] text-[13.5px] text-[var(--mutedfg)] hover:bg-[var(--hover)] hover:text-[var(--fg)] ${hoverUnderlineClass}`}
        >
          <ExternalLink size={14} />
          Open task board
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
    .filter(isNewScopeParentOption)
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
      toast.error(e instanceof Error ? e.message : "Couldn't create the project. Check the fields and try again.");
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
        <div className="mb-[var(--space-3)] text-[var(--font-size-md)] font-medium">New project</div>
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
            aria-label="URL name (optional)"
            placeholder="lowercase-no-spaces"
          />
          <select
            name="parentPath"
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            aria-label="Parent project"
          >
            <option value="">Top level (new project)</option>
            {parentOptions.map((p) => (
              <option key={p.path} value={p.path}>{p.path}</option>
            ))}
          </select>
          <textarea
            name="reason"
            className="min-h-24 w-full rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--surface)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
            aria-label="Why does this exist?"
            placeholder="One or two sentences"
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
              {pending ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
        <p className="mt-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--mutedfg)]">
          Choose a parent to nest this inside it; leave empty to create a top-level project.
        </p>
      </div>
    </div>
  );
}
