import { describe, expect, it } from "vitest";
import { parseOpenQuestionEntries, serializeOpenQuestionEntries, type OpenQuestionEntry } from "./open-questions";

describe("open question helpers", () => {
  it("accepts strings, object entries, and object maps", () => {
    expect(parseOpenQuestionEntries([" First? ", { question: "Second?", tag: "decision" }, { title: "Third?", tag: "unknown" }])).toEqual([
      { t: "First?", tag: null, done: false, answer: null },
      { t: "Second?", tag: "decision", done: false, answer: null },
      { t: "Third?", tag: "unknown", done: false, answer: null },
    ]);
    expect(parseOpenQuestionEntries({ owner: "Who owns this?" })).toEqual([
      { t: "Who owns this?", tag: null, done: false, answer: null },
    ]);
    expect(parseOpenQuestionEntries("- First?\n* Second?")).toEqual([
      { t: "First?", tag: null, done: false, answer: null },
      { t: "Second?", tag: null, done: false, answer: null },
    ]);
  });

  it("preserves done and answer values", () => {
    expect(parseOpenQuestionEntries([{ t: "Which plan?", done: true, answer: "Plan A" }])).toEqual([
      { t: "Which plan?", tag: null, done: true, answer: "Plan A" },
    ]);
  });

  it("round-trips serialized entries", () => {
    const entries: OpenQuestionEntry[] = [
      { t: "Who approves?", tag: "decision", done: true, answer: "The owner" },
      { t: "What is unknown?", tag: "unknown", done: false, answer: null },
    ];
    expect(parseOpenQuestionEntries(serializeOpenQuestionEntries(entries))).toEqual(entries);
  });
});
