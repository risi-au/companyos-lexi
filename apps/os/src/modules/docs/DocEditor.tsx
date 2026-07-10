"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import type { BlockNoteEditor } from "@blocknote/core";
import { Check, Edit3, Save } from "lucide-react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";

interface DocEditorProps {
  title: string;
  initialMarkdown: string;
  onSave: (markdown: string) => Promise<void>;
  readOnly?: boolean;
  onSaveStateChange?: (state: "saved" | "saving" | "error") => void;
  docKey?: string;
}

type SaveState = "saved" | "saving" | "error";

export interface ParsedFrontmatter {
  body: string;
  metadata: Record<string, string>;
}

export interface SplitSourcesResult {
  body: string;
  sources: string | null;
  count: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const normalized = markdown.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { body: markdown, metadata: {} };
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!pair) continue;
    const value = pair[2]!.replace(/^['"]|['"]$/g, "");
    if (value) metadata[pair[1]!] = value;
  }

  return { body: normalized.slice(match[0].length), metadata };
}

export function splitTrailingSources(markdown: string): SplitSourcesResult {
  const matches = Array.from(markdown.matchAll(/^##\s+Sources\s*$/gim));
  const last = matches.at(-1);
  if (!last || last.index === undefined) {
    return { body: markdown, sources: null, count: 0 };
  }

  const before = markdown.slice(0, last.index).trimEnd();
  const sources = markdown.slice(last.index).replace(/^##\s+Sources\s*$/im, "").trim();
  if (!sources) {
    return { body: before, sources: null, count: 0 };
  }

  const listItems = sources
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+\.)\s+/.test(line));
  const count = listItems.length || sources.split(/\r?\n+/).filter((line) => line.trim()).length;

  return { body: before, sources, count };
}

export function buildMetadataChips(metadata: Record<string, string>): string[] {
  const chips: string[] = [];
  if (metadata.verified_at) chips.push(`Verified ${formatDateChip(metadata.verified_at)}`);
  if (metadata.learned_at) chips.push(`Learned ${formatDateChip(metadata.learned_at)}`);
  if (metadata.confidence) chips.push(`Confidence: ${metadata.confidence}`);
  if (metadata.stale_after) chips.push(`Review by ${formatDateChip(metadata.stale_after)}`);
  return chips;
}

export function markdownForSave(initialMarkdown: string, serializedMarkdown: string, isDirty: boolean): string {
  return isDirty ? serializedMarkdown : initialMarkdown;
}

function formatDateChip(value: string): string {
  const ymd = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!ymd) return value;
  const year = Number(ymd[1]);
  const month = Number(ymd[2]) - 1;
  const day = Number(ymd[3]);
  if (!year || month < 0 || month > 11 || !day) return value;
  return `${day} ${MONTHS[month]} ${year}`;
}

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
  title,
  initialMarkdown,
  onSave,
  readOnly = false,
  onSaveStateChange,
  docKey,
}: DocEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaved, setLastSaved] = useState<string>("");
  const dirtyRef = useRef(false);
  const hydratingRef = useRef(false);
  const initialMarkdownRef = useRef(initialMarkdown);

  // Kept in a ref so a parent re-render (which recreates inline callbacks)
  // never changes updateSaveState's identity — the reset/hydration effects
  // below depend on it and must only fire when the document itself changes.
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  useEffect(() => {
    onSaveStateChangeRef.current = onSaveStateChange;
  });
  const updateSaveState = useCallback((s: SaveState) => {
    setSaveState(s);
    onSaveStateChangeRef.current?.(s);
  }, []);

  const editor: BlockNoteEditor = useCreateBlockNote({});

  useEffect(() => {
    initialMarkdownRef.current = initialMarkdown;
  }, [initialMarkdown]);

  // Reset edit mode only when switching documents — autosave feeds the saved
  // markdown back through initialMarkdown, and that must not kick the user
  // out of edit mode.
  useEffect(() => {
    dirtyRef.current = false;
    setIsEditing(false);
    setLastSaved("");
    updateSaveState("saved");
  }, [docKey, updateSaveState]);

  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    async function load() {
      hydratingRef.current = true;
      try {
        const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdownRef.current || "");
        if (!cancelled) {
          editor.replaceBlocks(editor.document, blocks);
          dirtyRef.current = false;
          setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
          updateSaveState("saved");
        }
      } catch {
        if (!cancelled) {
          editor.replaceBlocks(editor.document, []);
          dirtyRef.current = false;
          updateSaveState("saved");
        }
      } finally {
        window.setTimeout(() => {
          if (!cancelled) hydratingRef.current = false;
        }, 0);
      }
    }
    load();
    return () => {
      cancelled = true;
      hydratingRef.current = false;
    };
  }, [editor, isEditing, docKey, updateSaveState]);

  const doSave = useCallback(async () => {
    if (readOnly) return;
    try {
      updateSaveState("saving");
      const serialized = await editor.blocksToMarkdownLossy(editor.document);
      const md = markdownForSave(initialMarkdownRef.current, serialized, dirtyRef.current);
      await onSave(md);
      initialMarkdownRef.current = md;
      dirtyRef.current = false;
      setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      updateSaveState("saved");
    } catch {
      updateSaveState("error");
    }
  }, [editor, onSave, readOnly, updateSaveState]);

  const debouncedSave = useDebouncedCallback(doSave, 1500);

  const handleEditorChange = useCallback(() => {
    if (readOnly || hydratingRef.current) return;
    dirtyRef.current = true;
    debouncedSave();
  }, [debouncedSave, readOnly]);

  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        doSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSave, isEditing]);

  const statusText = useMemo(() => {
    if (saveState === "saving") return "Saving...";
    if (saveState === "error") return "Save failed";
    if (lastSaved) return `Saved ${lastSaved}`;
    return "Saved";
  }, [saveState, lastSaved]);

  const readPresentation = useMemo(() => {
    const parsed = parseFrontmatter(initialMarkdown);
    const split = splitTrailingSources(parsed.body);
    return {
      body: split.body,
      sources: split.sources,
      sourceCount: split.count,
      chips: buildMetadataChips(parsed.metadata),
    };
  }, [initialMarkdown]);

  const exitEditMode = async () => {
    await doSave();
    setIsEditing(false);
  };

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <div className="min-w-0">
            <h2 className="truncate text-[var(--font-size-lg)] font-semibold leading-tight">{title}</h2>
            {!isEditing && readPresentation.chips.length > 0 && (
              <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-1)]">
                {readPresentation.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--muted)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            )}
          </div>

          {isEditing ? (
            <div className="flex shrink-0 items-center gap-[var(--space-2)]">
              <button
                onClick={doSave}
                disabled={saveState === "saving"}
                className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60"
              >
                <Save size={14} /> Save
              </button>
              <button
                onClick={exitEditMode}
                className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] hover:opacity-90"
              >
                <Check size={14} /> Done
              </button>
            </div>
          ) : (
            !readOnly && (
              <button
                onClick={() => setIsEditing(true)}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]"
              >
                <Edit3 size={14} /> Edit
              </button>
            )
          )}
        </div>

        {isEditing && (
          <div className="mt-[var(--space-2)] flex items-center justify-between text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <div>{readOnly ? "Read only" : "Autosaves as you work"}</div>
            <div className={saveState === "error" ? "text-[var(--destructive)]" : ""}>{statusText}</div>
          </div>
        )}
      </div>

      {isEditing ? (
        <div
          className="bn-container flex-1 overflow-auto p-[var(--space-2)]"
          onScroll={() => window.dispatchEvent(new Event("scroll"))}
        >
          <BlockNoteView editor={editor} editable={!readOnly} onChange={handleEditorChange} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="docs-read-body flex-1 overflow-auto px-[var(--space-4)] py-[var(--space-3)] text-[var(--font-size-base)] leading-6">
            {readPresentation.body.trim() ? (
              <ReactMarkdown>{readPresentation.body}</ReactMarkdown>
            ) : (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">This doc is empty.</div>
            )}
          </div>
          {readPresentation.sources && (
            <details className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <summary className="cursor-pointer text-[var(--font-size-sm)] font-medium text-[var(--muted-foreground)]">
                Sources ({readPresentation.sourceCount})
              </summary>
              <div className="docs-read-body mt-[var(--space-2)] text-[var(--font-size-sm)] leading-6">
                <ReactMarkdown>{readPresentation.sources}</ReactMarkdown>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
