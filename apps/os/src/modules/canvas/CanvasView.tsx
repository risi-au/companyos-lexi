"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  listCanvasesAction,
  getCanvasAction,
  saveCanvasAction,
  archiveCanvasAction,
  getAccessAction,
} from "./actions";
import { Plus, Archive, X } from "lucide-react";

// Dynamic import for Excalidraw per current Next.js App Router integration (verified via web/docs):
// must use "use client" + dynamic({ ssr: false }) + import css.
const Excalidraw = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);

// Excalidraw 0.17.x injects its styles at runtime; the index.css export exists only in 0.18+

interface CanvasListItem {
  id: string;
  slug: string;
  name: string;
  updatedAt: string | Date;
}

interface CanvasViewProps {
  scopePath: string;
  initialCanvasSlug?: string;
  initialAccess?: string | null;
}

type SaveState = "saved" | "saving" | "error";

export function CanvasView({ scopePath, initialCanvasSlug, initialAccess }: CanvasViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [canvases, setCanvases] = useState<CanvasListItem[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialCanvasSlug || null);
  const [currentCanvas, setCurrentCanvas] = useState<{ slug: string; name: string; scene: unknown } | null>(null);
  const [access, setAccess] = useState<string | null>(initialAccess || null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingCanvas, setIsLoadingCanvas] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaved, setLastSaved] = useState<string>("");

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [isDark, setIsDark] = useState(false);

  const readOnly = access === "viewer";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSceneRef = useRef<unknown>(null);

  // Sync theme from html class (UserMenu toggles .dark on documentElement)
  const syncTheme = useCallback(() => {
    if (typeof document !== "undefined") {
      const dark = document.documentElement.classList.contains("dark");
      setIsDark(dark);
    }
  }, []);

  useEffect(() => {
    syncTheme();
    // Observe class changes on html for live theme toggle while open
    const obs = new MutationObserver(() => syncTheme());
    if (typeof document !== "undefined") {
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
    return () => obs.disconnect();
  }, [syncTheme]);

  const updateUrlCanvas = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("tab", "canvas");
      if (slug) {
        params.set("canvas", slug);
      } else {
        params.delete("canvas");
      }
      router.replace(`/s/${scopePath}?${params.toString()}`, { scroll: false });
    },
    [router, scopePath, searchParams]
  );

  const refreshList = useCallback(async () => {
    try {
      const rows = await listCanvasesAction(scopePath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped: CanvasListItem[] = ((rows as unknown) as any[]).map((r: { id: string; slug: string; name: string; updatedAt: string | Date }) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        updatedAt: r.updatedAt,
      }));
      setCanvases(mapped);
    } catch {
      setCanvases([]);
    }
  }, [scopePath]);

  const loadCanvas = useCallback(
    async (slug: string) => {
      setIsLoadingCanvas(true);
      try {
        const c = await getCanvasAction(scopePath, slug);
        if (c) {
          const scene = c.scene || { elements: [], appState: {} };
          setCurrentCanvas({ slug: c.slug, name: c.name, scene });
          currentSceneRef.current = scene;
          setLastSaved(new Date(c.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          setSaveState("saved");
        }
      } catch {
        // ignore load errors
      } finally {
        setIsLoadingCanvas(false);
      }
    },
    [scopePath]
  );

  // Initial load list + access + selected
  useEffect(() => {
    let mounted = true;
    (async () => {
      setIsLoadingList(true);
      await refreshList();
      if (!access) {
        const a = await getAccessAction(scopePath);
        if (mounted) setAccess(a);
      }
      if (initialCanvasSlug) {
        await loadCanvas(initialCanvasSlug);
      } else if (mounted) {
        // auto select first if exists
        const first = (await listCanvasesAction(scopePath))[0];
        if (first && mounted) {
          setSelectedSlug(first.slug);
          updateUrlCanvas(first.slug);
          await loadCanvas(first.slug);
        }
      }
      if (mounted) setIsLoadingList(false);
    })();
    return () => { mounted = false; };
  }, [initialCanvasSlug, scopePath]); // initial load only; loadCanvas stable via useCallback

  // Load when slug changes
  useEffect(() => {
    if (selectedSlug) {
      loadCanvas(selectedSlug);
    }
  }, [selectedSlug, loadCanvas]);

  const debouncedSave = useCallback(
    (sceneData: unknown, nameForSave: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (readOnly) return;
      setSaveState("saving");
      debounceRef.current = setTimeout(async () => {
        try {
          const toSave = {
            scopePath,
            slug: selectedSlug || undefined,
            name: nameForSave || currentCanvas?.name || "Untitled",
            scene: sceneData,
          };
          const saved = await saveCanvasAction(toSave);
          if (saved) {
            setSaveState("saved");
            setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
            if (!selectedSlug || saved.slug !== selectedSlug) {
              setSelectedSlug(saved.slug);
              updateUrlCanvas(saved.slug);
            }
            await refreshList();
          }
        } catch {
          setSaveState("error");
        }
      }, 2000); // 2s idle per brief
    },
    [scopePath, selectedSlug, currentCanvas, readOnly, updateUrlCanvas, refreshList]
  );

  // Excalidraw change handler: elements + appState + files
  const handleExcalidrawChange = useCallback(
    (elements: readonly unknown[], appState: unknown, files: unknown) => {
      if (readOnly) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scene = { elements: [...(elements as any[])], appState: { ...(appState as any) }, files: { ...(files as any) } };
      currentSceneRef.current = scene;
      const name = currentCanvas?.name || "Untitled";
      debouncedSave(scene, name);
    },
    [readOnly, debouncedSave, currentCanvas]
  );

  // Create new canvas
  const createNew = async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      const created = await saveCanvasAction({
        scopePath,
        name: newName.trim(),
        scene: { elements: [], appState: { viewBackgroundColor: "#ffffff" } },
      });
      setNewName("");
      setShowNewDialog(false);
      await refreshList();
      setSelectedSlug(created.slug);
      updateUrlCanvas(created.slug);
      setCurrentCanvas({ slug: created.slug, name: created.name, scene: created.scene });
      setSaveState("saved");
      setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch {
      // silent create error
    } finally {
      setIsCreating(false);
    }
  };

  const selectCanvas = (slug: string) => {
    setSelectedSlug(slug);
    updateUrlCanvas(slug);
  };

  const archiveSelected = async () => {
    if (!selectedSlug) return;
    if (!confirm("Archive this canvas?")) return;
    try {
      await archiveCanvasAction(scopePath, selectedSlug);
      await refreshList();
      setSelectedSlug(null);
      setCurrentCanvas(null);
      updateUrlCanvas(null);
    } catch {
      // ignore
    }
  };

  const initialData = currentCanvas?.scene || { elements: [], appState: {} };

  return (
    <div className="flex h-[calc(100vh-220px)] gap-[var(--space-4)]">
      {/* Left: list + new */}
      <div className="w-64 flex-shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] flex flex-col">
        <div className="mb-[var(--space-2)] flex items-center justify-between">
          <div className="text-[var(--font-size-sm)] font-medium">Canvases</div>
          <button
            onClick={() => setShowNewDialog(true)}
            disabled={readOnly}
            className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-[var(--space-2)] py-0.5 text-[var(--font-size-xs)] hover:bg-[var(--muted)] disabled:opacity-50"
            aria-label="New canvas"
          >
            <Plus size={14} /> New
          </button>
        </div>

        {isLoadingList ? (
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Loading…</div>
        ) : canvases.length === 0 ? (
          <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">No canvases yet. Create one.</div>
        ) : (
          <ul className="flex-1 space-y-1 overflow-auto text-[var(--font-size-sm)]">
            {canvases.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => selectCanvas(c.slug)}
                  className={`w-full text-left px-[var(--space-2)] py-[var(--space-1)] rounded hover:bg-[var(--muted)] ${selectedSlug === c.slug ? "bg-[var(--muted)] font-medium" : ""}`}
                >
                  {c.name}
                  <div className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
                    {new Date(c.updatedAt).toLocaleDateString()}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedSlug && !readOnly && (
          <button
            onClick={archiveSelected}
            className="mt-2 inline-flex items-center gap-1 text-[var(--font-size-xs)] text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
          >
            <Archive size={14} /> Archive selected
          </button>
        )}

        <div className="mt-auto pt-2 text-[10px] text-[var(--muted-foreground)]">Excalidraw • 2MB cap</div>
      </div>

      {/* Right: editor or placeholder */}
      <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] overflow-hidden relative">
        {!selectedSlug || !currentCanvas ? (
          <div className="flex h-full items-center justify-center text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {canvases.length === 0 ? "Create a canvas to start drawing." : "Select a canvas from the list."}
          </div>
        ) : isLoadingCanvas ? (
          <div className="flex h-full items-center justify-center text-[var(--font-size-sm)]">Loading canvas…</div>
        ) : (
          <>
            <div className="absolute top-2 right-2 z-10 flex items-center gap-2 rounded bg-[var(--surface)]/80 px-2 py-0.5 text-[var(--font-size-xs)] border border-[var(--border)]">
              {readOnly ? "Read-only (viewer)" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save error" : `Saved ${lastSaved || ""}`}
            </div>
            <div className="h-full w-full" style={{ minHeight: 420 }}>
              {/* Excalidraw: key on slug to remount cleanly when switching; theme bound to app; viewMode for viewers */}
              <Excalidraw
                key={selectedSlug}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                initialData={initialData as any} // excalidraw accepts loose scene shape; cast acceptable for embed
                onChange={handleExcalidrawChange}
                viewModeEnabled={readOnly}
                theme={isDark ? "dark" : "light"}
                gridModeEnabled={false}
                zenModeEnabled={false}
              />
            </div>
          </>
        )}
      </div>

      {/* New canvas dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-80 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-medium">New canvas</div>
              <button onClick={() => setShowNewDialog(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createNew(); }}
              placeholder="Canvas name"
              className="w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => { setShowNewDialog(false); setNewName(""); }}
                className="rounded border border-[var(--border)] px-3 py-1 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={createNew}
                disabled={!newName.trim() || isCreating}
                className="rounded bg-[var(--primary)] px-3 py-1 text-sm text-[var(--primary-foreground)] disabled:opacity-50"
              >
                {isCreating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
