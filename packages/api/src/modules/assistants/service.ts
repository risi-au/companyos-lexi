import { z } from "zod";

/**
 * Assistant bundle contract (M13-01). A bundle is the portable definition of a standing
 * assistant: its role, the skills it uses, the credentials it needs (NAMES ONLY — never
 * values), how it is kicked off, the minimum wrap-up it must return, and the signals that
 * graduate into durable memory. Bundle instances live in the skills repo and sync via
 * sync_skills; this schema is the canonical, machine-checkable contract.
 */
export const assistantBundleSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  role: z.object({
    title: z.string().min(1),
    summary: z.string().min(1),
    /** Default posture: observe/diagnose, draft-for-review, or act (proxied by approvals). */
    autonomy: z.enum(["observe", "draft", "act"]).default("draft"),
  }),
  /** Skill names the assistant relies on (resolved via the skills index). */
  skillsManifest: z.array(z.string().min(1)),
  /** Credential requirements — NAMES ONLY. Values live in the vault, never in a bundle. */
  credentials: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
    })
  ),
  /** Named kickoff prompt templates the assistant can be armed with. */
  kickoffTemplates: z.array(
    z.object({
      name: z.string().min(1),
      prompt: z.string().min(1),
    })
  ),
  /** The minimum structured wrap-up this assistant must return. */
  returnContract: z.object({
    required: z.array(z.string().min(1)),
  }),
  /** Optional signals that should graduate into wiki memory over time. */
  learningHooks: z.array(z.string().min(1)).optional(),
});

export type AssistantBundle = z.infer<typeof assistantBundleSchema>;

/** Validate and normalize an assistant bundle. */
export function parseAssistantBundle(data: unknown): AssistantBundle {
  return assistantBundleSchema.parse(data);
}

/**
 * Reference bundle: Meta Ads Assistant (M13-07). Drafted from the 2026-07-17
 * Nutrition Warehouse "optimum-weekend" session. Reviews Meta (Facebook/Instagram) ad
 * performance and DRAFTS optimization suggestions; the human keeps budget, targeting, and
 * publish (autonomy = draft).
 */
export const metaAdsAssistantBundle: AssistantBundle = {
  id: "meta-ads-assistant",
  version: "1.0.0",
  role: {
    title: "Meta Ads Assistant",
    summary:
      "Reviews Meta (Facebook/Instagram) ad performance and drafts optimization suggestions for human review.",
    autonomy: "draft",
  },
  skillsManifest: ["meta-ads-analysis", "ad-copy-drafting"],
  credentials: [
    {
      name: "META_ADS_ACCESS_TOKEN",
      description: "Meta Ads API token (reporting read only)",
    },
  ],
  kickoffTemplates: [
    {
      name: "weekly-review",
      prompt:
        "Review last week's Meta ad performance for {scope} and draft optimization suggestions. Draft only — do NOT change budget, targeting, or publish.",
    },
  ],
  returnContract: {
    required: ["outcome", "artifacts", "followUps"],
  },
  learningHooks: ["repeated-underperforming-creative", "budget-pacing-anomaly"],
};
