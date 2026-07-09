"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConfirm, useToast } from "@companyos/ui";
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
import { Plus, History, Archive, X, BookOpen } from "lucide-react";

interface DocListItem {
  id: string;
  slug: string;
  title: string;
  updatedAt: string | Date;
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
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialDocSlug || null);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: DocListItem[] = (rows as any[]).map((r: any) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        updatedAt: r.updatedAt,
      }));
      setDocs(mapped);
    } catch {
      // silent; empty list ok for empty state
      setDocs([]);
    }
  }, [scopePath]);

  const loadDoc = useCallback(
    async (slug: string) => {
      setIsLoadingDoc(true);
      try {
        const d = await getDocAction(scopePath, slug);
        if (d) {
          setCurrentDoc({ slug: d.slug, title: d.title, bodyMd: d.bodyMd ?? "" });
          setSelectedSlug(d.slug);
          updateUrlDoc(d.slug);
        }
      } catch {
        // doc may have been archived, refresh list
        await refreshList();
      } finally {
        setIsLoadingDoc(false);
      }
    },
    [scopePath, refreshList, updateUrlDoc]
  );

  // Initial load
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoadingList(true);
      await refreshList();
      const acc = initialAccess ?? (await getAccessAction(scopePath));
      if (mounted) setAccess(acc);

      try {
        const wiki = await getInheritedWikiAction(scopePath);
        if (mounted) setInheritedWiki(wiki as InheritedWiki | null);
      } catch {
        if (mounted) setInheritedWiki(null);
      }

      // Load initial or first doc from ?doc
      const spDoc = searchParams?.get("doc");
      const startSlug = spDoc || initialDocSlug || null;
      if (startSlug) {
        await loadDoc(startSlug);
      } else {
        // auto select first if any
        const list = await listDocsAction(scopePath);
        if (list.length > 0) {
          await loadDoc(list[0]!.slug);
        }
      }
      if (mounted) setIsLoadingList(false);
    })();
    return () => {
      mounted = false;
    };
  }, [scopePath, initialAccess, initialDocSlug, searchParams, refreshList, loadDoc]);

  const sortedDocs = [...docs].sort((a, b) => {
    if (a.slug === "wiki") return -1;
    if (b.slug === "wiki") return 1;
    return 0;
  });

  const onSelectDoc = async (slug: string) => {
    if (slug === selectedSlug) return;
    await loadDoc(slug);
  };

  // New doc dialog
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
      // select it
      await loadDoc(created.slug);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create doc";
      toast.error(msg);
    } finally {
      setIsCreating(false);
    }
  };

  // Inline rename
  const startRename = (item: DocListItem) => {
    setEditingSlug(item.slug);
    setEditTitle(item.title);
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
      const msg = e instanceof Error ? e.message : "Rename failed";
      toast.error(msg);
    } finally {
      cancelRename();
    }
  };

  const cancelRename = () => {
    setEditingSlug(null);
    setEditTitle("");
  };

  // Archive with confirm
  const archiveDoc = async (slug: string, title: string) => {
    if (!(await requestConfirm({ title: `Archive "${title}"?`, body: `Archive "${title}"? It will be hidden from list.`, confirmLabel: "Archive" }))) return;
    try {
      await archiveDocAction(scopePath, slug);
      await refreshList();
      if (selectedSlug === slug) {
        setSelectedSlug(null);
        setCurrentDoc(null);
        updateUrlDoc(null);
        // select next if any
        const fresh = await listDocsAction(scopePath);
        if (fresh.length > 0) await loadDoc(fresh[0]!.slug);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Archive failed";
      toast.error(msg);
    }
  };

  // History
  const openHistory = async (slug: string) => {
    setHistoryForSlug(slug);
    setShowHistory(true);
    setIsLoadingHistory(true);
    try {
      const revs = await listRevisionsAction(scopePath, slug, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: RevisionItem[] = (revs as any[]).map((r: any) => ({
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
    if (!(await requestConfirm({ title: "Restore this revision?", body: "Restore this revision? Current content will be replaced.", confirmLabel: "Restore", tone: "default" }))) return;
    try {
      await revertDocAction(scopePath, historyForSlug, revId);
      closeHistory();
      // reload current
      await loadDoc(historyForSlug);
      await refreshList();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Restore failed";
      toast.error(msg);
    }
  };

  // Save handler for editor: uses title from current
  const handleEditorSave = async (markdown: string) => {
    if (!currentDoc || readOnly) return;
    await saveDocAction({
      scopePath,
      slug: currentDoc.slug,
      title: currentDoc.title,
      bodyMd: markdown,
    });
    // list timestamp updates via refresh (non blocking)
    refreshList().catch(() => {});
  };

  const handleSaveState = (s: "saved" | "saving" | "error") => setSaveState(s);

  // Empty states
  const hasDocs = docs.length > 0;
  const noDocSelected = !currentDoc;

  return (
    <div className="grid grid-cols-1 gap-[var(--space-3)] lg:grid-cols-[280px,1fr] min-h-[520px]">
      {/* Left: list */}
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-2)] flex flex-col">
        <div className="mb-[var(--space-2)] flex items-center justify-between px-[var(--space-1)]">
          <div className="text-[var(--font-size-sm)] font-medium">Documents</div>
          {!readOnly && (
            <button
              onClick={openNewDialog}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
              aria-label="New doc"
            >
              <Plus size={14} /> New
            </button>
          )}
        </div>

        {inheritedWiki && (
          <div className="mb-[var(--space-2)] rounded-[var(--radius-sm)] border border-[var(--primary)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--font-size-xs)]">
            <div className="mb-1 flex items-center gap-1 font-medium text-[var(--primary)]">
              <BookOpen size={13} /> Inherited wiki — from {inheritedWiki.scopePath}
            </div>
            <ul className="space-y-0.5">
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
          <div className="p-3 text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading…</div>
        ) : !hasDocs ? (
          <div className="px-[var(--space-2)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            No docs yet. Create the first doc — agents can also write here via save_doc.
          </div>
        ) : (
          <ul className="space-y-[var(--space-1)] overflow-auto">
            {sortedDocs.map((d) => {
              const isSel = d.slug === selectedSlug;
              const isEditing = editingSlug === d.slug;
              const isWiki = d.slug === "wiki";
              return (
                <li
                  key={d.slug}
                  className={`group flex items-center justify-between rounded px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-sm)] ${
                    isSel ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]"
                  } ${isWiki ? "font-medium" : ""}`}
                  onDoubleClick={() => !readOnly && startRename(d)}
                >
                  <div className="flex min-w-0 flex-1 cursor-pointer items-center gap-1" onClick={() => onSelectDoc(d.slug)}>
                    {isWiki && <BookOpen size={13} className="shrink-0 text-[var(--primary)]" />}
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="w-full bg-transparent outline-none border-b border-[var(--primary)] text-[var(--font-size-sm)]"
                      />
                    ) : (
                      <span className={`truncate ${isWiki ? "text-[var(--primary)]" : ""}`}>{d.title}</span>
                    )}
                  </div>

                  <div className="ml-2 flex items-center gap-1 opacity-60 group-hover:opacity-100">
                    <span className="hidden text-[10px] text-[var(--muted-foreground)] tabular-nums sm:inline">
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </span>
                    {!readOnly && (
                      <>
                        <button
                          title="History"
                          onClick={(e) => {
                            e.stopPropagation();
                            openHistory(d.slug);
                          }}
                          className="rounded p-1 hover:bg-[var(--background)]"
                        >
                          <History size={14} />
                        </button>
                        <button
                          title="Archive"
                          onClick={(e) => {
                            e.stopPropagation();
                            archiveDoc(d.slug, d.title);
                          }}
                          className="rounded p-1 hover:bg-[var(--background)]"
                        >
                          <Archive size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right: editor or empty */}
      <div className="min-h-[420px] lg:min-h-[520px] flex flex-col">
        {noDocSelected ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {hasDocs ? "Select a document on the left." : "Create the first doc to start editing."}
          </div>
        ) : isLoadingDoc || !currentDoc ? (
          <div className="flex h-full items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Loading document…
          </div>
        ) : (
          <DocEditor
            key={`${scopePath}:${currentDoc.slug}`} // remount for clean state
            docKey={`${scopePath}:${currentDoc.slug}`}
            initialMarkdown={currentDoc.bodyMd}
            onSave={handleEditorSave}
            readOnly={readOnly}
            onSaveStateChange={handleSaveState}
          />
        )}
      </div>

      {/* New doc dialog (simple, token styled) */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewDialog(false)}>
          <div
            className="w-full max-w-[360px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 text-[var(--font-size-md)] font-medium">New document</div>
            <input
              autoFocus
              placeholder="Doc title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createNewDoc();
                if (e.key === "Escape") setShowNewDialog(false);
              }}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-3 py-2 text-[var(--font-size-sm)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShowNewDialog(false)}
                className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1.5 text-[var(--font-size-sm)]"
              >
                Cancel
              </button>
              <button
                onClick={createNewDoc}
                disabled={isCreating || !newTitle.trim()}
                className="rounded-[var(--radius-sm)] bg-[var(--primary)] px-3 py-1.5 text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60"
              >
                {isCreating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History popover (modal-like for simplicity) */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={closeHistory}>
          <div
            className="w-full max-w-[420px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[var(--font-size-sm)] font-medium">History (last 10)</div>
              <button onClick={closeHistory} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            {isLoadingHistory ? (
              <div className="py-2 text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading…</div>
            ) : historyRevs.length === 0 ? (
              <div className="py-2 text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No revisions.</div>
            ) : (
              <ul className="max-h-[260px] space-y-1 overflow-auto text-[var(--font-size-sm)]">
                {historyRevs.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1.5">
                    <div className="min-w-0">
                      <div className="truncate">{r.title}</div>
                      <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)] tabular-nums">
                        {new Date(r.createdAt).toLocaleString()} · {r.savedBy.slice(0, 8)}
                      </div>
                    </div>
                    {!readOnly && (
                      <button
                        onClick={() => restoreRevision(r.id)}
                        className="ml-2 rounded border border-[var(--border)] px-2 py-0.5 text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 text-[10px] text-[var(--muted-foreground)]">Reverting creates a new revision.</div>
          </div>
        </div>
      )}
    </div>
  );
}
