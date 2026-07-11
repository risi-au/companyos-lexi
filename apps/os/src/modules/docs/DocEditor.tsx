"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import type { BlockNoteEditor } from "@blocknote/core";
import { ArrowDown, ArrowUp, Bell, Check, Edit3, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/shadcn/style.css";
import {
  parseAliasList,
  parseFrontmatter,
  parseStructuredMarkdown,
  reattachFrontmatter,
  serializeStructuredMarkdown,
  slugifyHeading,
  splitTrailingSources,
  wikilinksToMarkdown,
  type KnownWikiPage,
  type StructuredDocForm,
  type StructuredSection,
} from "./structured-editor";

export {
  parseAliasList,
  parseFrontmatter,
  reattachFrontmatter,
  splitTrailingSources,
  parseStructuredMarkdown,
  serializeStructuredMarkdown,
  wikilinksToMarkdown,
};

interface DocEditorProps {
  title: string;
  initialMarkdown: string;
  onSave: (input: { title: string; markdown: string }) => Promise<void>;
  readOnly?: boolean;
  onSaveStateChange?: (state: "saved" | "saving" | "error") => void;
  docKey?: string;
  scopePath: string;
  knownPages?: KnownWikiPage[];
  unreviewed?: boolean;
  onVerify?: () => Promise<void>;
  isFollowing?: boolean;
  isFollowBusy?: boolean;
  onToggleFollow?: () => Promise<void>;
  onEditingChange?: (editing: boolean) => void;
}

type SaveState = "saved" | "saving" | "error";
type WriteMode = "form" | "markdown";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildMetadataChips(metadata: Record<string, string>): string[] {
  const chips: string[] = [];
  if (metadata.verified_at) chips.push(`Verified ${formatDateChip(metadata.verified_at)}`);
  if (metadata.learned_at) chips.push(`Learned ${formatDateChip(metadata.learned_at)}`);
  if (metadata.confidence) chips.push(`Confidence: ${metadata.confidence}`);
  if (metadata.stale_after) chips.push(`Review by ${formatDateChip(metadata.stale_after)}`);
  return chips;
}

export function markdownForSave(
  initialMarkdown: string,
  serializedBody: string,
  isDirty: boolean,
  frontmatterRaw: string | null = null,
): string {
  if (!isDirty) return initialMarkdown;
  return reattachFrontmatter(frontmatterRaw, serializedBody);
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

function textFromChildren(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(children)) {
    return textFromChildren(children.props.children);
  }
  return "";
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

function cloneForm(form: StructuredDocForm): StructuredDocForm {
  return {
    ...form,
    aliases: [...form.aliases],
    originalAliases: [...form.originalAliases],
    sections: form.sections.map((section) => ({ ...section })),
  };
}

function newSection(): StructuredSection {
  return {
    id: `section-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: "section",
    title: "New section",
    content: "",
    headingPrefix: "## ",
    lineEnding: "\n",
  };
}

export function DocEditor({
  title,
  initialMarkdown,
  onSave,
  readOnly = false,
  onSaveStateChange,
  docKey,
  scopePath,
  knownPages,
  unreviewed = false,
  onVerify,
  isFollowing = false,
  isFollowBusy = false,
  onToggleFollow,
  onEditingChange,
}: DocEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [writeMode, setWriteMode] = useState<WriteMode>("form");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSaved, setLastSaved] = useState<string>("");
  const [titleDraft, setTitleDraft] = useState(title);
  const [formDraft, setFormDraft] = useState<StructuredDocForm>(() => parseStructuredMarkdown(title, initialMarkdown));
  const [isVerifying, setIsVerifying] = useState(false);

  const dirtyRef = useRef(false);
  const markdownDirtyRef = useRef(false);
  const hydratingRef = useRef(false);
  const initialMarkdownRef = useRef(initialMarkdown);
  const frontmatterRawRef = useRef<string | null>(parseFrontmatter(initialMarkdown).raw);
  const titleDraftRef = useRef(title);
  const formDraftRef = useRef(formDraft);
  const writeModeRef = useRef<WriteMode>(writeMode);

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
    titleDraftRef.current = titleDraft;
  }, [titleDraft]);

  useEffect(() => {
    formDraftRef.current = formDraft;
  }, [formDraft]);

  useEffect(() => {
    writeModeRef.current = writeMode;
  }, [writeMode]);

  useEffect(() => {
    onEditingChange?.(isEditing);
  }, [isEditing, onEditingChange]);

  useEffect(() => {
    initialMarkdownRef.current = initialMarkdown;
    frontmatterRawRef.current = parseFrontmatter(initialMarkdown).raw;
    if (!dirtyRef.current) {
      setTitleDraft(title);
      setFormDraft(parseStructuredMarkdown(title, initialMarkdown));
    }
  }, [initialMarkdown, title]);

  useEffect(() => {
    dirtyRef.current = false;
    markdownDirtyRef.current = false;
    setIsEditing(false);
    setWriteMode("form");
    setTitleDraft(title);
    setFormDraft(parseStructuredMarkdown(title, initialMarkdown));
    setLastSaved("");
    updateSaveState("saved");
  }, [docKey, initialMarkdown, title, updateSaveState]);

  const hydrateMarkdownEditor = useCallback(
    async (markdown: string) => {
      let cancelled = false;
      hydratingRef.current = true;
      try {
        const { body, raw } = parseFrontmatter(markdown || "");
        const blocks = await editor.tryParseMarkdownToBlocks(body);
        if (!cancelled) {
          editor.replaceBlocks(editor.document, blocks);
          frontmatterRawRef.current = raw;
        }
      } catch {
        if (!cancelled) {
          editor.replaceBlocks(editor.document, []);
        }
      } finally {
        window.setTimeout(() => {
          if (!cancelled) hydratingRef.current = false;
        }, 0);
      }
      return () => {
        cancelled = true;
        hydratingRef.current = false;
      };
    },
    [editor],
  );

  const doSave = useCallback(async () => {
    if (readOnly) return;
    try {
      updateSaveState("saving");
      const nextTitle = titleDraftRef.current.trim() || title;
      let md = initialMarkdownRef.current;

      if (markdownDirtyRef.current) {
        if (writeModeRef.current === "markdown") {
          const serialized = await editor.blocksToMarkdownLossy(editor.document);
          md = markdownForSave(initialMarkdownRef.current, serialized, true, frontmatterRawRef.current);
        } else {
          md = serializeStructuredMarkdown(formDraftRef.current);
        }
      }

      await onSave({ title: nextTitle, markdown: md });
      initialMarkdownRef.current = md;
      frontmatterRawRef.current = parseFrontmatter(md).raw;
      dirtyRef.current = false;
      markdownDirtyRef.current = false;
      setFormDraft((current) => {
        const next = cloneForm(current);
        next.originalAliases = [...next.aliases];
        next.frontmatterRaw = parseFrontmatter(md).raw;
        return next;
      });
      setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      updateSaveState("saved");
    } catch {
      updateSaveState("error");
    }
  }, [editor, onSave, readOnly, title, updateSaveState]);

  const debouncedSave = useDebouncedCallback(doSave, 1500);

  const markTitleDirty = useCallback(() => {
    if (readOnly || hydratingRef.current) return;
    dirtyRef.current = true;
    debouncedSave();
  }, [debouncedSave, readOnly]);

  const markMarkdownDirty = useCallback(() => {
    if (readOnly || hydratingRef.current) return;
    dirtyRef.current = true;
    markdownDirtyRef.current = true;
    debouncedSave();
  }, [debouncedSave, readOnly]);

  const updateForm = useCallback(
    (updater: (form: StructuredDocForm) => StructuredDocForm) => {
      setFormDraft((current) => updater(cloneForm(current)));
      markMarkdownDirty();
    },
    [markMarkdownDirty],
  );

  const handleEditorChange = useCallback(() => {
    markMarkdownDirty();
  }, [markMarkdownDirty]);

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

  const switchWriteMode = async (mode: WriteMode) => {
    if (mode === writeMode) return;
    if (mode === "markdown") {
      const md = markdownDirtyRef.current
        ? serializeStructuredMarkdown(formDraftRef.current)
        : initialMarkdownRef.current;
      await hydrateMarkdownEditor(md);
      setWriteMode("markdown");
      return;
    }

    const serialized = markdownDirtyRef.current
      ? await editor.blocksToMarkdownLossy(editor.document)
      : parseFrontmatter(initialMarkdownRef.current).body;
    const md = markdownForSave(initialMarkdownRef.current, serialized, markdownDirtyRef.current, frontmatterRawRef.current);
    setFormDraft(parseStructuredMarkdown(titleDraftRef.current, md));
    setWriteMode("form");
  };

  const enterEditMode = () => {
    setTitleDraft(title);
    setFormDraft(parseStructuredMarkdown(title, initialMarkdownRef.current));
    setWriteMode("form");
    setIsEditing(true);
  };

  const exitEditMode = async () => {
    await doSave();
    setIsEditing(false);
  };

  const verifyPage = async () => {
    if (!onVerify || isVerifying) return;
    setIsVerifying(true);
    try {
      await onVerify();
    } finally {
      setIsVerifying(false);
    }
  };

  const statusText = useMemo(() => {
    if (saveState === "saving") return "Saving...";
    if (saveState === "error") return "Save failed";
    if (lastSaved) return `Saved ${lastSaved}`;
    return "Saved";
  }, [saveState, lastSaved]);

  const readPresentation = useMemo(() => {
    const parsed = parseFrontmatter(initialMarkdown);
    const split = splitTrailingSources(parsed.body);
    const renderedBody = wikilinksToMarkdown(split.body, scopePath, knownPages);
    return {
      body: renderedBody,
      sources: split.sources,
      sourceCount: split.count,
      chips: buildMetadataChips(parsed.metadata),
    };
  }, [initialMarkdown, knownPages, scopePath]);

  const markdownComponents = useMemo<Components>(() => ({
    h2({ children, ...props }) {
      const id = slugifyHeading(textFromChildren(children));
      return <h2 id={id} {...props}>{children}</h2>;
    },
    h3({ children, ...props }) {
      const id = slugifyHeading(textFromChildren(children));
      return <h3 id={id} {...props}>{children}</h3>;
    },
    a({ children, href, title: linkTitle, ...props }) {
      const missing = linkTitle === "missing-wikilink";
      return (
        <a
          href={href}
          className={missing ? "text-[var(--muted-foreground)] underline decoration-dashed underline-offset-4" : undefined}
          title={missing ? "Missing page" : linkTitle}
          {...props}
        >
          {children}
        </a>
      );
    },
  }), []);

  const renderSection = (section: StructuredSection, index: number) => {
    const move = (direction: -1 | 1) => {
      updateForm((form) => {
        const target = index + direction;
        if (target < 0 || target >= form.sections.length) return form;
        const [item] = form.sections.splice(index, 1);
        if (item) form.sections.splice(target, 0, item);
        return form;
      });
    };

    return (
      <div key={section.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] p-[var(--space-3)]">
        <div className="mb-[var(--space-2)] flex items-center justify-between gap-[var(--space-2)]">
          <div className="text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
            {section.kind === "markdown" ? "Markdown block" : "Section"}
          </div>
          <div className="flex items-center gap-[var(--space-1)]">
            <button
              type="button"
              aria-label="Move section up"
              title="Move up"
              disabled={index === 0}
              onClick={() => move(-1)}
              className="rounded-[var(--radius-sm)] p-[var(--space-1)] hover:bg-[var(--muted)] disabled:opacity-40"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              aria-label="Move section down"
              title="Move down"
              disabled={index === formDraft.sections.length - 1}
              onClick={() => move(1)}
              className="rounded-[var(--radius-sm)] p-[var(--space-1)] hover:bg-[var(--muted)] disabled:opacity-40"
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              aria-label="Remove section"
              title="Remove"
              onClick={() => updateForm((form) => {
                form.sections.splice(index, 1);
                return form;
              })}
              className="rounded-[var(--radius-sm)] p-[var(--space-1)] hover:bg-[var(--muted)]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {section.kind === "section" ? (
          <div className="space-y-[var(--space-2)]">
            <input
              value={section.title}
              onChange={(e) => updateForm((form) => {
                const current = form.sections[index];
                if (current?.kind === "section") current.title = e.target.value;
                return form;
              })}
              className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] font-medium focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
            <textarea
              value={section.content}
              onChange={(e) => updateForm((form) => {
                const current = form.sections[index];
                if (current?.kind === "section") current.content = e.target.value;
                return form;
              })}
              rows={5}
              className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)] leading-6 focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
          </div>
        ) : (
          <textarea
            value={section.content}
            onChange={(e) => updateForm((form) => {
              const current = form.sections[index];
              if (current?.kind === "markdown") current.content = e.target.value;
              return form;
            })}
            rows={8}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)] leading-6 focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
          />
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
        <div className="flex items-start justify-between gap-[var(--space-3)]">
          <div className="min-w-0">
            <h2 className="truncate text-[var(--font-size-lg)] font-semibold leading-tight">{title}</h2>
            {!isEditing && (readPresentation.chips.length > 0 || unreviewed) && (
              <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-1)]">
                {unreviewed && (
                  <span className="rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--muted)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--accent)]">
                    Unreviewed
                  </span>
                )}
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
            <div className="flex shrink-0 items-center gap-[var(--space-2)]">
              {onToggleFollow && (
                <button
                  onClick={onToggleFollow}
                  disabled={isFollowBusy}
                  className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60"
                >
                  <Bell size={14} />
                  {isFollowing ? "Following" : "Follow"}
                  {isFollowing && <Check size={14} />}
                </button>
              )}
              {unreviewed && !readOnly && (
                <button
                  onClick={verifyPage}
                  disabled={isVerifying}
                  className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)] disabled:opacity-60"
                >
                  <ShieldCheck size={14} /> {isVerifying ? "Verifying..." : "Mark verified"}
                </button>
              )}
              {!readOnly && (
                <button
                  onClick={enterEditMode}
                  className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-sm)] hover:bg-[var(--muted)]"
                >
                  <Edit3 size={14} /> Edit
                </button>
              )}
            </div>
          )}
        </div>

        {isEditing && (
          <div className="mt-[var(--space-2)] flex flex-wrap items-center justify-between gap-[var(--space-2)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => switchWriteMode("form")}
                  className={`min-h-[32px] px-[var(--space-2)] ${writeMode === "form" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "hover:bg-[var(--muted)]"}`}
                >
                  Form
                </button>
                <button
                  type="button"
                  onClick={() => switchWriteMode("markdown")}
                  className={`min-h-[32px] border-l border-[var(--border)] px-[var(--space-2)] ${writeMode === "markdown" ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "hover:bg-[var(--muted)]"}`}
                >
                  Markdown
                </button>
              </div>
              <div>{readOnly ? "Read only" : "Autosaves as you work"}</div>
            </div>
            <div className={saveState === "error" ? "text-[var(--destructive)]" : ""}>{statusText}</div>
          </div>
        )}
      </div>

      {isEditing ? (
        writeMode === "markdown" ? (
          <div
            className="bn-container flex-1 overflow-auto p-[var(--space-2)]"
            onScroll={() => window.dispatchEvent(new Event("scroll"))}
          >
            <BlockNoteView editor={editor} editable={!readOnly} onChange={handleEditorChange} />
          </div>
        ) : (
          <div className="flex-1 space-y-[var(--space-3)] overflow-auto p-[var(--space-3)]">
            <label className="block text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
              Title
              <input
                value={titleDraft}
                onChange={(e) => {
                  setTitleDraft(e.target.value);
                  markTitleDirty();
                }}
                className="mt-[var(--space-1)] w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] normal-case text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
            </label>

            <label className="block text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
              Aliases
              <textarea
                value={formDraft.aliases.join(", ")}
                onChange={(e) => updateForm((form) => {
                  form.aliases = parseAliasList(e.target.value);
                  return form;
                })}
                rows={2}
                className="mt-[var(--space-1)] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] normal-case text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
            </label>

            <label className="block text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
              Definition
              <textarea
                value={formDraft.definition}
                onChange={(e) => updateForm((form) => {
                  form.definition = e.target.value;
                  return form;
                })}
                rows={3}
                className="mt-[var(--space-1)] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] normal-case leading-6 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
            </label>

            <label className="block text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">
              Details
              <textarea
                value={formDraft.details}
                onChange={(e) => updateForm((form) => {
                  form.details = e.target.value;
                  return form;
                })}
                rows={5}
                className="mt-[var(--space-1)] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--border)] bg-transparent px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-sm)] normal-case leading-6 text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
            </label>

            <div className="space-y-[var(--space-2)]">
              <div className="flex items-center justify-between gap-[var(--space-2)]">
                <div className="text-[var(--font-size-xs)] font-medium uppercase text-[var(--muted-foreground)]">Sections</div>
                <button
                  type="button"
                  onClick={() => updateForm((form) => {
                    form.sections.push(newSection());
                    return form;
                  })}
                  className="inline-flex min-h-[36px] items-center gap-[var(--space-1)] rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]"
                >
                  <Plus size={14} /> Add section
                </button>
              </div>
              {formDraft.sections.length === 0 ? (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border)] px-[var(--space-3)] py-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
                  No sections yet.
                </div>
              ) : (
                <div className="space-y-[var(--space-2)]">
                  {formDraft.sections.map(renderSection)}
                </div>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="docs-read-body mx-auto w-full max-w-[75ch] flex-1 overflow-auto px-[var(--space-3)] py-[var(--space-3)] text-[var(--font-size-base)] leading-6">
            {readPresentation.body.trim() ? (
              <ReactMarkdown components={markdownComponents}>{readPresentation.body}</ReactMarkdown>
            ) : (
              <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">This page is empty.</div>
            )}
          </div>
          {readPresentation.sources && (
            <details className="border-t border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <summary className="cursor-pointer text-[var(--font-size-sm)] font-medium text-[var(--muted-foreground)]">
                Sources ({readPresentation.sourceCount})
              </summary>
              <div className="docs-read-body mt-[var(--space-2)] text-[var(--font-size-sm)] leading-6">
                <ReactMarkdown components={markdownComponents}>{readPresentation.sources}</ReactMarkdown>
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
