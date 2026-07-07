import { describe, expect, it } from "vitest";
import {
  assembleExternalPack,
  parseFramingQuestions,
  parsePastedIntakePacket,
} from "./index";

describe("wizard contract helpers", () => {
  it("defaults new packet fields and strips credential value-shaped extras", () => {
    const parsed = parsePastedIntakePacket([
      "Brief",
      "```json",
      JSON.stringify({
        packet_md: "Ready",
        required_credentials: [{ name: "VPS SSH", whatFor: "Deploys", loginMethodNotes: "Rishi grants access", value: "secret" }],
        external_systems: [{ name: "CRM", purpose: "Lead trail", notes: "Existing" }],
      }),
      "```",
    ].join("\n"));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.packet.required_credentials).toEqual([{ name: "VPS SSH", whatFor: "Deploys", loginMethodNotes: "Rishi grants access" }]);
    expect(JSON.stringify(parsed.packet.required_credentials)).not.toContain("secret");
    expect(parsed.packet.external_systems).toEqual([{ name: "CRM", purpose: "Lead trail", notes: "Existing" }]);
  });

  it("parses framing question keys from template markdown", () => {
    const questions = parseFramingQuestions(`---
slug: new-project
title: New project
kind: framing
applies_to: project
---

## Framing questions

- project_kind: What kind?
- plane: Needs Plane?`);

    expect(questions).toEqual([
      { key: "project_kind", question: "What kind?" },
      { key: "plane", question: "Needs Plane?" },
    ]);
  });

  it("assembles v2 pack sections with history, accepted patterns, and MCP pointers", () => {
    const pack = assembleExternalPack({
      intakeId: "intake-1",
      scopePath: "client/build",
      scopeName: "Build",
      briefing: "Operate carefully.",
      templateBody: "Interview template",
      answers: { reason: "Converted lead", plane: "yes" },
      reason: "Converted lead",
      structuralContext: "Parent chain: client",
      relatedHistory: [{ type: "record", id: "rec-1", title: "Sales call", scopePath: "sales", snippet: "Promised launch" }],
      reusePatterns: [{ slug: "pattern-build", title: "Build pattern", summary: "Use repo setup", reusable: true, sourceScopePath: "old/build", sourceVisible: true }],
      acceptedPattern: "pattern-build",
    });

    expect(pack.pasteBack).toContain("## Briefing");
    expect(pack.pasteBack).toContain("Converted lead");
    expect(pack.pasteBack).toContain("Sales call");
    expect(pack.pasteBack).toContain("Accepted pattern: pattern-build");
    expect(pack.mcp).toContain("get_context");
    expect(pack.mcp).toContain("search");
  });
});
