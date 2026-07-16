"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfirm, useToast } from "@companyos/ui";
import { Archive, BookOpen, History, Link2, ListTree, Plus, X } from "lucide-react";
import { DocEditor } from "./DocEditor";
import { extractMarkdownOutline, type KnownWikiPage, type MarkdownOutlineItem } from "./structured-editor";
import { createLoadSequence, DOC_LOAD_TIMEOUT_MS, withTimeout } from "./doc-load";
import {
  listDocsAction,
  getDocAction,
  saveDocAction,
  renameDocAction,
  archiveDocAction,
  listRevisionsAction,
  revertDocAction,
  getAccessAction,
  getInheritedWikiAction,
  getBacklinksAction,
  verifyDocAction,
  followDocAction,
  unfollowDocAction,
  isFollowingDocAction,
} from "./actions";

type AuthorKind = "human" | "agent" | "system";

interface DocListItem {
  id: string;
  slug: string;
  title: string;
  updatedAt: string | Date;
  createdByKind: AuthorKind | null;
  scopePath: string;
  unreviewed: boolean;
}

interface RawDocListItem {
  id: string;
  slug: string;
  title: string;
  updatedAt: string | Date;
  createdByKind?: AuthorKind | null;
  scopePath?: string;
  unreviewed?: boolean;
}

interface CurrentDoc {
  scopePath: string;
  slug: string;
  title: string;
  bodyMd: string;
  unreviewed: boolean;
}

interface RevisionItem {
  id: string;
  title: string;
  createdAt: string | Date;
  savedBy: string;
}

interface BacklinkItem {
  fromDocumentId: string;
  fromScopePath: string;
  fromSlug: string;
  fromTitle: string;
  toSlug: string;
  resolved: boolean;
}

interface DocsViewProps {
  scopePath: string;
  initialDocSlug?: string;
  initialAccess?: string | null;
}

interface InheritedWiki {
  scopePath: string;
  docs: Array<{ id: string; slug: string; title: string }>;
}

function docKey(scopePath: string, slug: string): string {
  return `${scopePath}:${slug}`;
}

export function DocsView({ scopePath, initialDocSlug, initialAccess }: DocsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestConfirm = useConfirm();
  const { toast } = useToast();

  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [currentDoc, setCurrentDoc] = useState<CurrentDoc | null>(null);
  const [isFollowingCurrent, setIsFollowingCurrent] = useState(false);
  const [isFollowBusy, setIsFollowBusy] = useState(false);
  const [access, setAccess] = useState<string | null>(initialAccess || null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [docLoadError, setDocLoadError] = useState<{ scopePath: string; slug: string } | null>(null);
  const [isDocEditing, setIsDocEditing] = useState(false);
  const [inheritedWiki, setInheritedWiki] = useState<InheritedWiki | null>(null);
  const [, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [isLoadingBacklinks, setIsLoadingBacklinks] = useState(false);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [editingDoc, setEditingDoc] = useState<{ scopePath: string; slug: string } | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [historyRevs, setHistoryRevs] = useState<RevisionItem[]>([]);
  const [historyFor, setHistoryFor] = useState<{ scopePath: string; slug: string } | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const readOnly = access === "viewer";
  const selectedKey = currentDoc ? docKey(currentDoc.scopePath, currentDoc.slug) : null;
  const urlDocSlug = searchParams?.get("doc") || initialDocSlug || null;
  const loadSequence = useRef(createLoadSequence());

  const mapDocs = useCallback((rows: RawDocListItem[]): DocListItem[] =>
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      updatedAt: r.updatedAt,
      createdByKind: r.createdByKind ?? null,
      scopePath: r.scopePath ?? scopePath,
      unreviewed: Boolean(r.unreviewed),
    })), [scopePath]);

  const updateUrlDoc = useCallback(
    (targetScopePath: string, slug: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", "docs");
      if (slug) {
        params.set("doc", slug);
      } else {
        params.delete("doc");
      }
      const url = `/s/${targetScopePath}?${params.toString()}`;
      if (targetScopePath === scopePath) {
        // Same scope: query-only change. Native replaceState keeps useSearchParams
        // in sync without an RSC navigation; a pending navigation would make any
        // in-flight server action hang forever (vercel/next.js#74246, issue #54).
        window.history.replaceState(null, "", url);
      } else {
        router.replace(url, { scroll: false });
      }
    },
    [router, scopePath, searchParams],
  );

  const refreshList = useCallback(async () => {
    try {
      const rows = await listDocsAction(scopePath, true);
      const mapped = mapDocs(rows as RawDocListItem[]);
      setDocs(mapped);
      setCurrentDoc((current) => {
        if (!current) return current;
        const fresh = mapped.find((doc) => doc.scopePath === current.scopePath && doc.slug === current.slug);
        return fresh ? { ...current, title: fresh.title, unreviewed: fresh.unreviewed } : current;
      });
      return mapped;
    } catch {
      setDocs([]);
      return [];
    }
  }, [mapDocs, scopePath]);

  const loadDoc = useCallback(
    async (targetScopePath: string, slug: string, syncUrl = true) => {
      const seq = loadSequence.current.next();
      setIsLoadingDoc(true);
      setDocLoadError(null);
      try {
        const d = await withTimeout(getDocAction(targetScopePath, slug), DOC_LOAD_TIMEOUT_MS);
        if (!loadSequence.current.isCurrent(seq)) return;
        if (d) {
          const following = await withTimeout(isFollowingDocAction(targetScopePath, d.slug), DOC_LOAD_TIMEOUT_MS).catch(() => false);
          if (!loadSequence.current.isCurrent(seq)) return;
          const listRow = docs.find((row) => row.scopePath === targetScopePath && row.slug === d.slug);
          setCurrentDoc({
            scopePath: targetScopePath,
            slug: d.slug,
            title: d.title,
            bodyMd: d.bodyMd ?? "",
            unreviewed: Boolean(listRow?.unreviewed),
          });
          setIsFollowingCurrent(Boolean(following));
          if (syncUrl) updateUrlDoc(targetScopePath, d.slug);
        } else {
          setDocLoadError({ scopePath: targetScopePath, slug });
        }
      } catch {
        if (!loadSequence.current.isCurrent(seq)) return;
        setIsFollowingCurrent(false);
        setDocLoadError({ scopePath: targetScopePath, slug });
        refreshList().catch(() => {});
      } finally {
        if (loadSequence.current.isCurrent(seq)) setIsLoadingDoc(false);
      }
    },
    [docs, refreshList, updateUrlDoc],
  );

  useEffect(() => {
    let mounted = true;
    setCurrentDoc(null);
    setIsFollowingCurrent(false);
    setDocs([]);
    setBacklinks([]);
    setInheritedWiki(null);
    setDocLoadError(null);
    setIsLoadingList(true);

    (async () => {
      const rows = await refreshList();
      const acc = initialAccess ?? (await getAccessAction(scopePath));
      if (mounted) setAccess(acc);

      try {
        const wiki = await getInheritedWikiAction(scopePath);
        if (mounted) setInheritedWiki(wiki as InheritedWiki | null);
      } catch {
        if (mounted) setInheritedWiki(null);
      }

      if (mounted) setIsLoadingList(false);

      const startRow = urlDocSlug
        ? rows.find((row) => row.scopePath === scopePath && row.slug === urlDocSlug) ?? rows.find((row) => row.slug === urlDocSlug)
        : rows[0] ?? null;
      if (startRow) {
        await loadDoc(startRow.scopePath, startRow.slug, Boolean(urlDocSlug));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [scopePath, initialAccess, refreshList]);

  useEffect(() => {
    if (!urlDocSlug || urlDocSlug === currentDoc?.slug || isLoadingDoc) return;
    // A failed load stays failed until the user retries; auto-reloading here would
    // clear the error pane and loop back to "Loading page..." on every docs refresh.
    if (docLoadError?.slug === urlDocSlug) return;
    const target = docs.find((row) => row.scopePath === scopePath && row.slug === urlDocSlug) ?? docs.find((row) => row.slug === urlDocSlug);
    if (target) loadDoc(target.scopePath, target.slug, false).catch(() => {});
  }, [urlDocSlug, currentDoc?.slug, docLoadError, isLoadingDoc, docs, loadDoc, scopePath]);

  useEffect(() => {
    let mounted = true;
    if (!currentDoc) {
      setBacklinks([]);
      return;
    }
    setIsLoadingBacklinks(true);
    getBacklinksAction(currentDoc.scopePath, currentDoc.slug)
      .then((rows) => {
        if (mounted) setBacklinks(rows as BacklinkItem[]);
      })
      .catch(() => {
        if (mounted) setBacklinks([]);
      })
      .finally(() => {
        if (mounted) setIsLoadingBacklinks(false);
      });
    return () => {
      mounted = false;
    };
  }, [currentDoc?.scopePath, currentDoc?.slug]);

  const sortedDocs = useMemo(() => {
    return [...docs].sort((a, b) => {
      if (a.scopePath === scopePath && b.scopePath !== scopePath) return -1;
      if (b.scopePath === scopePath && a.scopePath !== scopePath) return 1;
      const pathOrder = a.scopePath.localeCompare(b.scopePath);
      if (pathOrder !== 0) return pathOrder;
      if (a.slug === "wiki") return -1;
      if (b.slug === "wiki") return 1;
      return a.title.localeCompare(b.title);
    });
  }, [docs, scopePath]);

  const groupedDocs = useMemo(() => {
    const scopePaths = Array.from(new Set(sortedDocs.map((doc) => doc.scopePath)));
    if (scopePaths.length <= 1) {
      const yours = sortedDocs.filter((doc) => doc.createdByKind === "human");
      const ai = sortedDocs.filter((doc) => doc.createdByKind !== "human");
      return [
        { title: "Your pages", docs: yours },
        { title: "AI-maintained", docs: ai },
      ].filter((group) => group.docs.length > 0);
    }

    return scopePaths.map((path) => ({
      title: path === scopePath ? "This scope" : path,
      docs: sortedDocs.filter((doc) => doc.scopePath === path),
    }));
  }, [scopePath, sortedDocs]);

  const knownPages = useMemo<KnownWikiPage[]>(() => {
    const pages = docs.map((doc) => ({ scopePath: doc.scopePath, slug: doc.slug }));
    if (currentDoc && !pages.some((page) => page.scopePath === currentDoc.scopePath && page.slug === currentDoc.slug)) {
      pages.push({ scopePath: currentDoc.scopePath, slug: currentDoc.slug });
    }
    return pages;
  }, [currentDoc, docs]);

  const outline = useMemo<MarkdownOutlineItem[]>(() => {
    if (!currentDoc || isDocEditing) return [];
    return extractMarkdownOutline(currentDoc.bodyMd);
  }, [currentDoc, isDocEditing]);

  const onSelectDoc = async (doc: DocListItem) => {
    if (docKey(doc.scopePath, doc.slug) === selectedKey) {
      // Already loaded; if another page's failed load is covering it, reveal it again.
      setDocLoadError(null);
      return;
    }
    await loadDoc(doc.scopePath, doc.slug);
  };

  const openNewDialog = () => {
    setNewTitle("");
    setShowNewDialog(true);
  };

  const createNewDoc = async (stub = false) => {
    const title = newTitle.trim() || (stub ? "Untitled page" : "");
    if (!title) return;
    setIsCreating(true);
    try {
      const created = await saveDocAction({ scopePath, title, bodyMd: "" });
      await refreshList();
      setShowNewDialog(false);
      setNewTitle("");
      await loadDoc(scopePath, created.slug);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't create the page. Check the title and retry.";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const startRename = (item: DocListItem) => {
    setEditingDoc({ scopePath: item.scopePath, slug: item.slug });
    setEditTitle(item.title);
  };

  const cancelRename = () => {
    setEditingDoc(null);
    setEditTitle("");
  };

  const commitRename = async () => {
    if (!editingDoc) return;
    const newT = editTitle.trim();
    if (!newT) {
      cancelRename();
      return;
    }
    try {
      await renameDocAction({ scopePath: editingDoc.scopePath, slug: editingDoc.slug, newTitle: newT });
      await refreshList();
      if (currentDoc?.scopePath === editingDoc.scopePath && currentDoc.slug === editingDoc.slug) {
        setCurrentDoc({ ...currentDoc, title: newT });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't rename the page. Check the title and retry.";
      toast.error(msg);
    } finally {
      cancelRename();
    }
  };

  const archiveDoc = async (targetScopePath: string, slug: string, title: string) => {
    if (!(await requestConfirm({ title: "Archive page", body: `"${title}" will be hidden from the wiki list, not deleted.`, confirmLabel: "Archive page" }))) return;
    try {
      await archiveDocAction(targetScopePath, slug);
      const fresh = await refreshList();
      if (currentDoc?.scopePath === targetScopePath && currentDoc.slug === slug) {
        setCurrentDoc(null);
        updateUrlDoc(scopePath, null);
        if (fresh.length > 0) await loadDoc(fresh[0]!.scopePath, fresh[0]!.slug);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't archive the page. Refresh and try again.";
      toast.error(msg);
    }
  };

  const openHistory = async (targetScopePath: string, slug: string) => {
    setHistoryFor({ scopePath: targetScopePath, slug });
    setShowHistory(true);
    setIsLoadingHistory(true);
    try {
      const revs = await listRevisionsAction(targetScopePath, slug, 10);
      const mapped: RevisionItem[] = (revs as RevisionItem[]).map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt,
        savedBy: r.savedBy,
      }));
      setHistoryRevs(mapped);
    } catch {
      setHistoryRevs([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const closeHistory = () => {
    setShowHistory(false);
    setHistoryRevs([]);
    setHistoryFor(null);
  };

  const restoreRevision = async (revId: string) => {
    if (!historyFor) return;
    if (!(await requestConfirm({ title: "Restore revision", body: "This creates a new revision from the selected version and replaces the current content.", confirmLabel: "Restore revision", tone: "default" }))) return;
    try {
      await revertDocAction(historyFor.scopePath, historyFor.slug, revId);
      closeHistory();
      await loadDoc(historyFor.scopePath, historyFor.slug);
      await refreshList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't restore the revision. Refresh and try again.";
      toast.error(msg);
    }
  };

  const handleEditorSave = async (input: { title: string; markdown: string }) => {
    if (!currentDoc || readOnly) return;
    await saveDocAction({
      scopePath: currentDoc.scopePath,
      slug: currentDoc.slug,
      title: input.title,
      bodyMd: input.markdown,
    });
    setCurrentDoc({ ...currentDoc, title: input.title, bodyMd: input.markdown, unreviewed: false });
    refreshList().catch(() => {});
  };

  const verifyCurrentDoc = async () => {
    if (!currentDoc) return;
    try {
      const verified = await verifyDocAction(currentDoc.scopePath, currentDoc.slug);
      setCurrentDoc({
        ...currentDoc,
        title: verified.title,
        bodyMd: verified.bodyMd ?? currentDoc.bodyMd,
        unreviewed: false,
      });
      await refreshList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't verify this page. Refresh and try again.";
      toast.error(msg);
    }
  };


  const toggleFollowCurrent = async () => {
    if (!currentDoc || isFollowBusy) return;
    setIsFollowBusy(true);
    try {
      if (isFollowingCurrent) {
        await unfollowDocAction(currentDoc.scopePath, currentDoc.slug);
        setIsFollowingCurrent(false);
      } else {
        await followDocAction(currentDoc.scopePath, currentDoc.slug);
        setIsFollowingCurrent(true);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't update following for this page. Refresh and try again.";
      toast.error(msg);
    } finally {
      setIsFollowBusy(false);
    }
  };
  const handleSaveState = (s: "saved" | "saving" | "error") => setSaveState(s);

  const hasDocs = docs.length > 0;
  const noDocSelected = !currentDoc;

  const renderOutline = (items: MarkdownOutlineItem[]) => (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)]">
      <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-1)] px-[var(--space-1)] text-[var(--font-size-sm)] font-medium">
        <ListTree size={14} /> On this page
      </div>
      {items.length === 0 ? (
        <div className="px-[var(--space-1)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
          No sections yet.
        </div>
      ) : (
        <nav className="space-y-[var(--space-1)] text-[var(--font-size-xs)]">
          {items.map((item, index) => (
            <a
              key={`${item.id}-${index}`}
              href={`#${item.id}`}
              className={`block rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] ${item.level === 3 ? "ml-[var(--space-3)]" : ""}`}
            >
              {item.title}
            </a>
          ))}
        </nav>
      )}
    </div>
  );

  const renderDocRow = (d: DocListItem) => {
    const isSel = docKey(d.scopePath, d.slug) === selectedKey;
    const isEditing = editingDoc?.scopePath === d.scopePath && editingDoc.slug === d.slug;
    const isWiki = d.slug === "wiki";

    return (
      <li
        key={docKey(d.scopePath, d.slug)}
        className={`group rounded-[var(--radius-sm)] text-[var(--font-size-sm)] ${
          isSel ? "bg-[var(--selected)]" : "hover:bg-[var(--muted)]"
        } ${isWiki ? "font-medium" : ""}`}
        onDoubleClick={() => !readOnly && startRename(d)}
      >
        <div className="flex min-h-[44px] items-center justify-between gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)]">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-[var(--space-1)] text-left"
            onClick={() => onSelectDoc(d)}
          >
            {isWiki && <BookOpen size={14} className="shrink-0 text-[var(--primary)]" />}
            {isEditing ? (
              <input
                autoFocus
                value={editTitle}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") cancelRename();
                }}
                className="w-full border-b border-[var(--primary)] bg-transparent text-[var(--font-size-sm)] outline-none"
              />
            ) : (
              <span className={`truncate ${isWiki ? "text-[var(--primary)]" : ""}`}>{d.title}</span>
            )}
            {d.unreviewed && !isEditing && (
              <span className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--accent)] px-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--accent)]">
                Unreviewed
              </span>
            )}
          </button>

          <div className="flex shrink-0 items-center gap-[var(--space-1)] opacity-70 group-hover:opacity-100">
            <span className="hidden text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums min-[820px]:inline">
              {new Date(d.updatedAt).toLocaleDateString()}
            </span>
            {!readOnly && (
              <>
                <button
                  aria-label={`History for ${d.title}`}
                  title="History"
                  onClick={(e) => {
                    e.stopPropagation();
                    openHistory(d.scopePath, d.slug);
                  }}
                  className="rounded-[var(--radius-sm)] p-[var(--space-1)] hover:bg-[var(--background)]"
                >
                  <History size={14} />
                </button>
                <button
                  aria-label={`Archive ${d.title}`}
                  title="Archive"
                  onClick={(e) => {
                    e.stopPropagation();
                    archiveDoc(d.scopePath, d.slug, d.title);
                  }}
                  className="rounded-[var(--radius-sm)] p-[var(--space-1)] hover:bg-[var(--background)]"
                >
                  <Archive size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="grid min-h-[520px] grid-cols-1 gap-[var(--space-3)] min-[820px]:grid-cols-[minmax(0,1fr)_300px] min-[1100px]:grid-cols-[200px_minmax(0,1fr)_300px]">
      <aside className="order-1 hidden min-[1100px]:flex min-[1100px]:flex-col">
        {renderOutline(outline)}
      </aside>

      <aside className="order-1 flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)] min-[820px]:order-2 min-[1100px]:order-3">
        <div className="mb-[var(--space-2)] flex items-center justify-between px-[var(--space-1)]">
          <div className="text-[var(--font-size-sm)] font-medium">Wiki pages</div>
          {!readOnly && (
            <button
              onClick={openNewDialog}
              className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
              aria-label="New page"
            >
              <Plus size={14} /> New page
            </button>
          )}
        </div>

        {inheritedWiki && (
          <div className="mb-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--primary)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-xs)]">
            <div className="mb-[var(--space-1)] flex items-center gap-[var(--space-1)] font-medium text-[var(--primary)]">
              <BookOpen size={13} /> Inherited wiki from {inheritedWiki.scopePath}
            </div>
            <ul className="space-y-[var(--space-1)]">
              {inheritedWiki.docs.map((d) => (
                <li key={d.id}>
                  <a
                    href={`/s/${inheritedWiki.scopePath}?tab=docs&doc=${encodeURIComponent(d.slug)}`}
                    className="text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:underline"
                  >
                    {d.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isLoadingList ? (
          <div className="p-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading...</div>
        ) : !hasDocs ? (
          <div className="px-[var(--space-2)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            No pages yet. Create the first one; agents can add pages here too.
          </div>
        ) : (
          <div className="min-h-0 overflow-auto">
            {groupedDocs.map((group) => (
              <section key={group.title} className="mb-[var(--space-3)] last:mb-0">
                <h3 className="px-[var(--space-2)] pb-[var(--space-1)] text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
                  {group.title}
                </h3>
                <ul className="space-y-[var(--space-1)]">{group.docs.map(renderDocRow)}</ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-[var(--space-3)] border-t border-[var(--border)] pt-[var(--space-3)]">
          <div className="mb-[var(--space-2)] flex items-center gap-[var(--space-1)] px-[var(--space-1)] text-[var(--font-size-sm)] font-medium">
            <Link2 size={14} /> Backlinks
          </div>
          {!currentDoc ? (
            <div className="px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              Select a page to see backlinks.
            </div>
          ) : isLoadingBacklinks ? (
            <div className="px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Loading...</div>
          ) : backlinks.length === 0 ? (
            <div className="px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
              No pages link here yet.
            </div>
          ) : (
            <ul className="space-y-[var(--space-1)] text-[var(--font-size-xs)]">
              {backlinks.map((link) => (
                <li key={`${link.fromDocumentId}:${link.toSlug}`}>
                  <a
                    href={`/s/${link.fromScopePath}?tab=docs&doc=${encodeURIComponent(link.fromSlug)}`}
                    className="block rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    <span className="block truncate">{link.fromTitle}</span>
                    <span className="block truncate font-mono text-[var(--font-size-xs)]">{link.fromScopePath}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <main className="order-2 flex min-h-[420px] w-full min-w-0 flex-col min-[820px]:order-1 min-[820px]:min-h-[520px] min-[1100px]:order-2">
        {outline.length > 0 && (
          <div className="mb-[var(--space-3)] min-[1100px]:hidden">
            {renderOutline(outline)}
          </div>
        )}

        {isLoadingDoc ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Loading page...
          </div>
        ) : docLoadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            <div>This page didn&apos;t load.</div>
            <button
              type="button"
              onClick={() => loadDoc(docLoadError.scopePath, docLoadError.slug)}
              className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--foreground)] hover:bg-[var(--muted)]"
            >
              Try again
            </button>
          </div>
        ) : noDocSelected ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {hasDocs ? "Select a page from the list." : "Create the first page to start editing."}
          </div>
        ) : (
          <DocEditor
            key={`${currentDoc.scopePath}:${currentDoc.slug}`}
            docKey={`${currentDoc.scopePath}:${currentDoc.slug}`}
            title={currentDoc.title}
            initialMarkdown={currentDoc.bodyMd}
            onSave={handleEditorSave}
            readOnly={readOnly}
            onSaveStateChange={handleSaveState}
            scopePath={currentDoc.scopePath}
            knownPages={knownPages}
            unreviewed={currentDoc.unreviewed}
            onVerify={verifyCurrentDoc}
            isFollowing={isFollowingCurrent}
            isFollowBusy={isFollowBusy}
            onToggleFollow={toggleFollowCurrent}
            onEditingChange={setIsDocEditing}
          />
        )}
      </main>

      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]" onClick={() => setShowNewDialog(false)}>
          <div
            className="w-full max-w-[360px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-3)] text-[var(--font-size-md)] font-medium">New page</div>
            <input
              autoFocus
              placeholder="Page title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createNewDoc();
                if (e.key === "Escape") setShowNewDialog(false);
              }}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
            <div className="mt-[var(--space-3)] flex justify-end gap-[var(--space-2)]">
              <button
                onClick={() => setShowNewDialog(false)}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)]"
              >
                Cancel
              </button>
              <button
                onClick={() => createNewDoc(true)}
                disabled={isCreating}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60"
              >
                Skip for now
              </button>
              <button
                onClick={() => createNewDoc()}
                disabled={isCreating || !newTitle.trim()}
                className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]" onClick={closeHistory}>
          <div
            className="w-full max-w-[420px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-2)] flex items-center justify-between">
              <div className="text-[var(--font-size-sm)] font-medium">History (last 10)</div>
              <button onClick={closeHistory} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {isLoadingHistory ? (
              <div className="py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading...</div>
            ) : historyRevs.length === 0 ? (
              <div className="py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No revisions.</div>
            ) : (
              <ul className="max-h-[260px] space-y-[var(--space-1)] overflow-auto text-[var(--font-size-sm)]">
                {historyRevs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-2)]">
                    <div className="min-w-0">
                      <div className="truncate">{r.title}</div>
                      <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                        {new Date(r.createdAt).toLocaleString()}, by {r.savedBy}
                      </div>
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => restoreRevision(r.id)}
                        className="ml-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-[var(--space-3)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Reverting creates a new revision.</div>
          </div>
        </div>
      )}
    </div>
  );
}
