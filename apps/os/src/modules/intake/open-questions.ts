export type OpenQuestionTag = "decision" | "unknown";

export interface OpenQuestionEntry {
  t: string;
  tag: OpenQuestionTag | null;
  done: boolean;
  answer: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEntry(value: unknown): OpenQuestionEntry | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t ? { t, tag: null, done: false, answer: null } : null;
  }
  if (!isRecord(value)) return null;

  const t = String(value.t ?? value.question ?? value.title ?? value.text ?? "").trim();
  if (!t) return null;
  const answer = typeof value.answer === "string" && value.answer.trim() ? value.answer.trim() : null;
  return {
    t,
    tag: value.tag === "decision" || value.tag === "unknown" ? value.tag : null,
    done: value.done === true,
    answer,
  };
}

export function parseOpenQuestionEntries(value: unknown): OpenQuestionEntry[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed !== value) return parseOpenQuestionEntries(parsed);
    } catch {
      /* Treat non-JSON strings as newline-delimited questions. */
    }
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .map((t) => ({ t, tag: null, done: false, answer: null }));
  }
  if (Array.isArray(value)) {
    return value.map(normalizeEntry).filter((item): item is OpenQuestionEntry => !!item);
  }
  if (isRecord(value)) {
    const direct = normalizeEntry(value);
    if (direct) return [direct];
    return Object.entries(value).flatMap(([key, item]) => {
      const normalized = normalizeEntry(item);
      if (normalized) return [normalized];
      if (typeof item === "string" && item.trim()) {
        return [{ t: `${key}: ${item.trim()}`, tag: null, done: false, answer: null }];
      }
      return [];
    });
  }
  return [];
}

export function serializeOpenQuestionEntries(entries: OpenQuestionEntry[]): string {
  return JSON.stringify(entries);
}
