import { describe, it, expect } from "vitest";
import {
  parseAssistantBundle,
  metaAdsAssistantBundle,
  type AssistantBundle,
} from "./service";

describe("assistants", () => {
  describe("parseAssistantBundle", () => {
    it("accepts a valid bundle", () => {
      const valid: AssistantBundle = {
        id: "test-assistant",
        version: "1.0.0",
        role: {
          title: "Test Assistant",
          summary: "A test assistant",
          autonomy: "draft",
        },
        skillsManifest: ["skill-one", "skill-two"],
        credentials: [{ name: "TEST_CRED", description: "A test credential" }],
        kickoffTemplates: [
          { name: "template-one", prompt: "Do something with {scope}" },
        ],
        returnContract: { required: ["outcome", "artifacts"] },
        learningHooks: ["test-hook"],
      };

      const result = parseAssistantBundle(valid);
      expect(result).toEqual(valid);
    });

    it("rejects a bundle missing required fields", () => {
      const invalid = {
        id: "test-assistant",
        // missing version, role, etc.
      };

      expect(() => parseAssistantBundle(invalid)).toThrow();
    });

    it("rejects a bundle with invalid autonomy", () => {
      const invalid = {
        id: "test-assistant",
        version: "1.0.0",
        role: {
          title: "Test",
          summary: "Test",
          autonomy: "invalid-value", // not observe/draft/act
        },
        skillsManifest: [],
        credentials: [],
        kickoffTemplates: [],
        returnContract: { required: [] },
      };

      expect(() => parseAssistantBundle(invalid)).toThrow();
    });
  });

  describe("metaAdsAssistantBundle", () => {
    it("is a valid bundle", () => {
      expect(() => parseAssistantBundle(metaAdsAssistantBundle)).not.toThrow();
    });

    it("has the expected shape", () => {
      expect(metaAdsAssistantBundle.id).toBe("meta-ads-assistant");
      expect(metaAdsAssistantBundle.role.autonomy).toBe("draft");
      expect(metaAdsAssistantBundle.skillsManifest).toContain(
        "meta-ads-analysis"
      );
      expect(
        metaAdsAssistantBundle.credentials.map((c) => c.name)
      ).toContain("META_ADS_ACCESS_TOKEN");
    });
  });
});
