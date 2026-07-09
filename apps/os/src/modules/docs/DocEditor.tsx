"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import type { BlockNoteEditor } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

// Props: controlled via markdown canonical. Parent handles fetch/save via actions.
interface DocEditorProps {
  initialMarkdown: string;
  onSave: (markdown: string) => Promise<void>;
  readOnly?: boolean;
  // Optional external save state sync
  onSaveStateChange?: (state: "saved" | "saving" | "error") => void;
  docKey?: string; // to force remount on doc switch
}

type SaveState = "saved" | "saving" | "error";

// Debounce helper (1.5s idle as per brief)
/* eslint-disable @typescript-eslint/no-explicit-any */
function useDebouncedCallback<T extends (...args: any[]) => void>(cb: T, delay: number) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(cb);
  cbRef.current = cb;

  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      cbRef.current(...args);
    }, delay);
  }, [delay]);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function DocEditor({
  initialMarkdown,
  onSave,
  readOnly = false,
  onSaveStateChange,
  docKey,
}: DocEditorProps) {
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaved, setLastSaved] = useState<string>("");

  const updateSaveState = useCallback((s: SaveState) => {
    setSaveState(s);
    onSaveStateChange?.(s);
  }, [onSaveStateChange]);

  // Create editor; initial content will be set in effect from markdown.
  const editor: BlockNoteEditor = useCreateBlockNote({
    // Default schema is markdown-representable (headings, para, lists, code, tables, images as links ok per brief)
    // No multi-column or other XL features enabled.
  });

  // Convert initial md to blocks on load / when initialMarkdown or doc changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown || "");
        if (!cancelled) {
          // Replace full doc
          editor.replaceBlocks(editor.document, blocks);
          setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          updateSaveState("saved");
        }
      } catch {
        // Fallback to empty on parse issue (lossy tolerant)
        if (!cancelled) {
          editor.replaceBlocks(editor.document, []);
          updateSaveState("saved");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [initialMarkdown, docKey, editor, updateSaveState]); // remount key for doc switch

  // Autosave on change: convert blocks -> md (lossy) then call onSave, debounced
  const doSave = useCallback(async () => {
    if (readOnly) return;
    try {
      updateSaveState("saving");
      const md = await editor.blocksToMarkdownLossy(editor.document);
      await onSave(md);
      setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      updateSaveState("saved");
    } catch {
      updateSaveState("error");
      // keep editing; parent may surface
    }
  }, [editor, onSave, readOnly, updateSaveState]);

  const debouncedSave = useDebouncedCallback(doSave, 1500);

  const handleEditorChange = useCallback(() => {
    if (readOnly) return;
    if (editor.document && editor.document.length > 0) {
      debouncedSave();
    }
  }, [editor, debouncedSave, readOnly]);

  // Keyboard save hint (Ctrl/Cmd+S)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave]);

  const statusText = useMemo(() => {
    if (saveState === "saving") return "Saving…";
    if (saveState === "error") return "Save failed";
    if (lastSaved) return `Saved ${lastSaved}`;
    return "Saved";
  }, [saveState, lastSaved]);

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
        <div>{readOnly ? "Read-only (viewer)" : "Autosaves as you work"}</div>
        <div className={saveState === "error" ? "text-[var(--destructive)]" : ""}>{statusText}</div>
      </div>

      <div className="bn-container flex-1 overflow-auto p-[var(--space-2)]">
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          onChange={handleEditorChange}
        />
      </div>
    </div>
  );
}
