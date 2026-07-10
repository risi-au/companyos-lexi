"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { runAgentTurnAction, listConversationsAction, getMessagesAction } from "./actions";

type Citation = {
  slug: string;
  scopePath: string;
  revisionId?: string;
  source: "scope" | "ancestor" | "root-pattern" | "critical-facts" | "personal";
  title?: string;
};

type Msg = {
  id?: string;
  role: "user" | "assistant" | "tool";
  content: any;
  model?: string | null;
  createdAt?: string | Date;
};

type Conv = { id: string; title: string; createdAt: string | Date };

const MODELS = ["cheap", "analysis", "reasoning", "code"] as const;

function citationList(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Citation => (
    item &&
    typeof item === "object" &&
    typeof (item as Citation).slug === "string" &&
    typeof (item as Citation).scopePath === "string"
  ));
}

function CitationChips({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-1)]">
      {citations.map((citation) => (
        <Link
          key={`${citation.scopePath}:${citation.slug}`}
          href={`/s/${citation.scopePath}?tab=docs&doc=${encodeURIComponent(citation.slug)}`}
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--muted)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--muted-foreground)] hover:text-[var(--primary)]"
        >
          {citation.title ?? citation.slug}
        </Link>
      ))}
    </div>
  );
}

export function AgentChatPanel({
  scopePath,
  open,
  onClose,
}: {
  scopePath: string;
  open: boolean;
  onClose: () => void;
}) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState<(typeof MODELS)[number]>("analysis");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toolTrace, setToolTrace] = useState<any[]>([]);

  // Load conv list when opened
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const list = await listConversationsAction(scopePath);
        setConvs(list || []);
        if (list && list.length > 0 && !currentConvId) {
          setCurrentConvId(list[0]!.id);
        }
      } catch (e: any) {
        setError(e?.message || "Couldn't load chats. Reopen Ask OS and try again.");
      }
    })();
  }, [open, scopePath, currentConvId]);

  // Load messages when conv changes
  useEffect(() => {
    if (!currentConvId || !open) {
      setMessages([]);
      return;
    }
    (async () => {
      try {
        const msgs = await getMessagesAction(currentConvId);
        setMessages((msgs || []) as any);
      } catch (e: any) {
        setError(e?.message || "Couldn't load messages. Reopen the chat and try again.");
      }
    })();
  }, [currentConvId, open]);

  async function sendMessage() {
    if (!input.trim() || !scopePath) return;
    setError(null);
    const msg = input.trim();
    setInput("");

    // optimistic user msg
    setMessages((m) => [...m, { role: "user", content: { text: msg } } as Msg]);

    startTransition(async () => {
      try {
        const res = await runAgentTurnAction({
          conversationId: currentConvId || undefined,
          scopePath,
          userMessage: msg,
          model,
        });
        // update conv id if new
        if (res.conversationId && res.conversationId !== currentConvId) {
          setCurrentConvId(res.conversationId);
          // refresh list
          const list = await listConversationsAction(scopePath);
          setConvs(list || []);
        }
        setToolTrace(res.toolTrace || []);
        // reload messages for accuracy (incl persisted)
        if (res.conversationId) {
          const fresh = await getMessagesAction(res.conversationId);
          setMessages((fresh || []) as any);
        }
      } catch (e: any) {
        setError(e?.message || "The agent didn't respond. Check the model gateway in Admin Settings, then retry.");
      }
    });
  }

  function renderMessage(m: Msg, idx: number) {
    if (m.role === "user") {
      const text = (m.content as any)?.text || String(m.content);
      return (
        <div key={idx} className="ml-auto max-w-[85%] rounded-[var(--radius-md)] bg-[var(--primary)] px-3 py-2 text-[var(--font-size-sm)] text-[var(--primary-foreground)]">
          {text}
        </div>
      );
    }
    if (m.role === "tool") {
      const c = m.content as any;
      const name = c?.name || "Tool";
      return (
        <div key={idx} className="text-[10px] text-[var(--muted-foreground)] font-mono bg-[var(--muted)]/60 px-2 py-1 rounded">
          {c?.error ? `${name} failed: ${c.error}` : `${name} completed`}
        </div>
      );
    }
    // assistant
    const text = (m.content as any)?.text || (typeof m.content === "string" ? m.content : "");
    const citations = citationList((m.content as any)?.citations);
    return (
      <div key={idx} className="mr-auto max-w-[85%] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--font-size-sm)]">
        <ReactMarkdown>{text || "No reply, try again."}</ReactMarkdown>
        <CitationChips citations={citations} />
      </div>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-[var(--border)] bg-[var(--background)] shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-[var(--font-size-sm)]">Ask OS</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as any)}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-mono"
            title="Model alias"
          >
            {MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <button onClick={onClose} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">Close</button>
      </div>

      {/* Conv list */}
      <div className="flex gap-1 border-b border-[var(--border)] px-2 py-1 overflow-x-auto text-[10px]">
        {convs.length === 0 && <div className="text-[var(--muted-foreground)] px-1">No chats yet</div>}
        {convs.map((c) => (
          <button
            key={c.id}
            onClick={() => setCurrentConvId(c.id)}
            className={`whitespace-nowrap rounded px-2 py-0.5 ${currentConvId === c.id ? "bg-[var(--muted)]" : "hover:bg-[var(--muted)]/60"}`}
            title={c.title}
          >
            {c.title.slice(0, 28)}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto space-y-3 p-3 text-[var(--font-size-sm)]">
        {messages.length === 0 && (
          <div className="text-[var(--muted-foreground)] text-xs">Ask about this project: metrics, tasks, records. Answers use live data.</div>
        )}
        {messages.map((m, i) => renderMessage(m, i))}
        {isPending && <div className="text-[var(--muted-foreground)] text-xs">Working…</div>}
        {toolTrace.length > 0 && (
          <details className="text-[10px] text-[var(--muted-foreground)]">
            <summary className="cursor-pointer">Request details ({toolTrace.length})</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-[var(--muted)] p-1 text-[9px]">
              {JSON.stringify(toolTrace, null, 2)}
            </pre>
          </details>
        )}
      </div>

      {/* Error */}
      {error && <div className="mx-3 mb-1 rounded bg-[var(--destructive)]/10 px-2 py-1 text-[10px] text-[var(--destructive)]">{error}</div>}

      {/* Input */}
      <div className="border-t border-[var(--border)] p-2">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask about metrics, tasks, records…"
            className="flex-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--font-size-sm)]"
            disabled={isPending}
          />
          <button
            onClick={sendMessage}
            disabled={isPending || !input.trim()}
            className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1 text-[var(--font-size-xs)] disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <div className="mt-1 text-[9px] text-[var(--muted-foreground)]">Answers use live data from this project.</div>
      </div>
    </div>
  );
}

export default AgentChatPanel;
