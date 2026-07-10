"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfirm, useToast } from "@companyos/ui";
import { Archive, BookOpen, History, Plus, X } from "lucide-react";
import { DocEditor } from "./DocEditor";
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
} from "./actions";

type AuthorKind = "human" | "agent" | "system";

interface DocListItem {
  id: string;
  slug: string;
  title: string;
  updatedAt: string | Date;
  createdByKind: AuthorKind | null;
}

interface RawDocListItem {
  id: string;
  slug: string;
  title: string;
  updatedAt: string | Date;
  createdByKind?: AuthorKind | null;
}

interface RevisionItem {
  id: string;
  title: string;
  createdAt: string | Date;
  savedBy: string;
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

export function DocsView({ scopePath, initialDocSlug, initialAccess }: DocsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestConfirm = useConfirm();
  const { toast } = useToast();

  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [currentDoc, setCurrentDoc] = useState<{ slug: string; title: string; bodyMd: string } | null>(null);
  const [access, setAccess] = useState<string | null>(initialAccess || null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const [inheritedWiki, setInheritedWiki] = useState<InheritedWiki | null>(null);
  const [, setSaveState] = useState<"saved" | "saving" | "error">("saved");

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const [showHistory, setShowHistory] = useState(false);
  const [historyRevs, setHistoryRevs] = useState<RevisionItem[]>([]);
  const [historyForSlug, setHistoryForSlug] = useState<string | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const readOnly = access === "viewer";
  const selectedSlug = currentDoc?.slug ?? null;
  const urlDocSlug = searchParams?.get("doc") || initialDocSlug || null;

  const mapDocs = (rows: RawDocListItem[]): DocListItem[] =>
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      updatedAt: r.updatedAt,
      createdByKind: r.createdByKind ?? null,
    }));

  const updateUrlDoc = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", "docs");
      if (slug) {
        params.set("doc", slug);
      } else {
        params.delete("doc");
      }
      router.replace(`/s/${scopePath}?${params.toString()}`, { scroll: false });
    },
    [router, scopePath, searchParams]
  );

  const refreshList = useCallback(async () => {
    try {
      const rows = await listDocsAction(scopePath);
      const mapped = mapDocs(rows as RawDocListItem[]);
      setDocs(mapped);
      return mapped;
    } catch {
      setDocs([]);
      return [];
    }
  }, [scopePath]);

  const loadDoc = useCallback(
    async (slug: string, syncUrl = true) => {
      setIsLoadingDoc(true);
      try {
        const d = await getDocAction(scopePath, slug);
        if (d) {
          setCurrentDoc({ slug: d.slug, title: d.title, bodyMd: d.bodyMd ?? "" });
          if (syncUrl) updateUrlDoc(d.slug);
        }
      } catch {
        await refreshList();
      } finally {
        setIsLoadingDoc(false);
      }
    },
    [scopePath, refreshList, updateUrlDoc]
  );

  useEffect(() => {
    let mounted = true;
    setCurrentDoc(null);
    setDocs([]);
    setInheritedWiki(null);
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

      const startSlug = urlDocSlug || rows[0]?.slug || null;
      if (startSlug) {
        await loadDoc(startSlug, Boolean(urlDocSlug));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [scopePath, initialAccess, refreshList]);

  useEffect(() => {
    if (!urlDocSlug || urlDocSlug === currentDoc?.slug) return;
    loadDoc(urlDocSlug, false).catch(() => {});
  }, [urlDocSlug, currentDoc?.slug, loadDoc]);

  const sortedDocs = useMemo(() => {
    return [...docs].sort((a, b) => {
      if (a.slug === "wiki") return -1;
      if (b.slug === "wiki") return 1;
      return 0;
    });
  }, [docs]);

  const groupedDocs = useMemo(() => {
    const yours = sortedDocs.filter((doc) => doc.createdByKind === "human");
    const ai = sortedDocs.filter((doc) => doc.createdByKind !== "human");
    return [
      { title: "Your docs", docs: yours },
      { title: "AI-maintained", docs: ai },
    ].filter((group) => group.docs.length > 0);
  }, [sortedDocs]);

  const onSelectDoc = async (slug: string) => {
    if (slug === currentDoc?.slug) return;
    await loadDoc(slug);
  };

  const openNewDialog = () => {
    setNewTitle("");
    setShowNewDialog(true);
  };

  const createNewDoc = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setIsCreating(true);
    try {
      const created = await saveDocAction({ scopePath, title, bodyMd: "" });
      await refreshList();
      setShowNewDialog(false);
      setNewTitle("");
      await loadDoc(created.slug);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't create the doc. Check the title and retry.";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  const startRename = (item: DocListItem) => {
    setEditingSlug(item.slug);
    setEditTitle(item.title);
  };

  const cancelRename = () => {
    setEditingSlug(null);
    setEditTitle("");
  };

  const commitRename = async () => {
    if (!editingSlug) return;
    const newT = editTitle.trim();
    if (!newT) {
      cancelRename();
      return;
    }
    try {
      await renameDocAction({ scopePath, slug: editingSlug, newTitle: newT });
      await refreshList();
      if (currentDoc?.slug === editingSlug) {
        setCurrentDoc({ ...currentDoc, title: newT });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't rename the doc. Check the title and retry.";
      toast.error(msg);
    } finally {
      cancelRename();
    }
  };

  const archiveDoc = async (slug: string, title: string) => {
    if (!(await requestConfirm({ title: "Archive document", body: `"${title}" will be hidden from the list (not deleted).`, confirmLabel: "Archive document" }))) return;
    try {
      await archiveDocAction(scopePath, slug);
      const fresh = await refreshList();
      if (currentDoc?.slug === slug) {
        setCurrentDoc(null);
        updateUrlDoc(null);
        if (fresh.length > 0) await loadDoc(fresh[0]!.slug);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't archive the doc. Refresh and try again.";
      toast.error(msg);
    }
  };

  const openHistory = async (slug: string) => {
    setHistoryForSlug(slug);
    setShowHistory(true);
    setIsLoadingHistory(true);
    try {
      const revs = await listRevisionsAction(scopePath, slug, 10);
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
    setHistoryForSlug(null);
  };

  const restoreRevision = async (revId: string) => {
    if (!historyForSlug) return;
    if (!(await requestConfirm({ title: "Restore revision", body: "This creates a new revision from the selected version and replaces the current content.", confirmLabel: "Restore revision", tone: "default" }))) return;
    try {
      await revertDocAction(scopePath, historyForSlug, revId);
      closeHistory();
      await loadDoc(historyForSlug);
      await refreshList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Couldn't restore the revision. Refresh and try again.";
      toast.error(msg);
    }
  };

  const handleEditorSave = async (markdown: string) => {
    if (!currentDoc || readOnly) return;
    await saveDocAction({
      scopePath,
      slug: currentDoc.slug,
      title: currentDoc.title,
      bodyMd: markdown,
    });
    setCurrentDoc({ ...currentDoc, bodyMd: markdown });
    refreshList().catch(() => {});
  };

  const handleSaveState = (s: "saved" | "saving" | "error") => setSaveState(s);

  const hasDocs = docs.length > 0;
  const noDocSelected = !currentDoc;

  const renderDocRow = (d: DocListItem) => {
    const isSel = d.slug === selectedSlug;
    const isEditing = editingSlug === d.slug;
    const isWiki = d.slug === "wiki";

    return (
      <li
        key={d.slug}
        className={`group rounded-[var(--radius-sm)] text-[var(--font-size-sm)] ${
          isSel ? "bg-[var(--selected)]" : "hover:bg-[var(--muted)]"
        } ${isWiki ? "font-medium" : ""}`}
        onDoubleClick={() => !readOnly && startRename(d)}
      >
        <div className="flex min-h-[44px] items-center justify-between gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)]">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-[var(--space-1)] text-left"
            onClick={() => onSelectDoc(d.slug)}
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
                    openHistory(d.slug);
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
                    archiveDoc(d.slug, d.title);
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
    <div className="grid min-h-[520px] grid-cols-1 gap-[var(--space-3)] min-[820px]:grid-cols-[minmax(0,1fr)_300px]">
      <aside className="order-1 flex flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)] min-[820px]:order-2">
        <div className="mb-[var(--space-2)] flex items-center justify-between px-[var(--space-1)]">
          <div className="text-[var(--font-size-sm)] font-medium">Documents</div>
          {!readOnly && (
            <button
              onClick={openNewDialog}
              className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
              aria-label="New doc"
            >
              <Plus size={14} /> New doc
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
            No docs yet. Create the first one; agents can add docs here too.
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
      </aside>

      <main className="order-2 flex min-h-[420px] w-full min-w-0 flex-col min-[820px]:order-1 min-[820px]:min-h-[520px]">
        {noDocSelected ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {hasDocs ? "Select a document from the list." : "Create the first doc to start editing."}
          </div>
        ) : isLoadingDoc || !currentDoc ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Loading document...
          </div>
        ) : (
          <DocEditor
            key={`${scopePath}:${currentDoc.slug}`}
            docKey={`${scopePath}:${currentDoc.slug}`}
            title={currentDoc.title}
            initialMarkdown={currentDoc.bodyMd}
            onSave={handleEditorSave}
            readOnly={readOnly}
            onSaveStateChange={handleSaveState}
          />
        )}
      </main>

      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]" onClick={() => setShowNewDialog(false)}>
          <div
            className="w-full max-w-[360px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-[var(--space-3)] text-[var(--font-size-md)] font-medium">New document</div>
            <input
              autoFocus
              placeholder="Doc title"
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
                onClick={createNewDoc}
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
