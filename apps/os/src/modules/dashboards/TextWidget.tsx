"use client";

import React from "react";
import ReactMarkdown from "react-markdown";

interface TextWidgetProps {
  title?: string;
  markdown: string;
}

export function TextWidget({ title, markdown }: TextWidgetProps) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] h-full flex flex-col overflow-auto">
      {title && <div className="mb-[var(--space-2)] text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">{title}</div>}
      <div className="text-[var(--font-size-sm)] prose prose-sm max-w-none text-[var(--foreground)]">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    </div>
  );
}
