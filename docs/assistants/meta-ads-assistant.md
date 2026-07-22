# Reference bundle: Meta Ads Assistant

The canonical machine-readable version is `metaAdsAssistantBundle` in
`packages/api/src/modules/assistants/service.ts` (validated by the module's test). This page is
the human-readable companion.

## Role
Reviews Meta (Facebook/Instagram) ad performance and **drafts** optimization suggestions for
human review. **The human keeps budget, targeting, and publish** — autonomy is `draft`.
(Source: the 2026-07-17 Nutrition Warehouse optimum-weekend session.)

## Shape
- **Skills:** `meta-ads-analysis`, `ad-copy-drafting`
- **Credentials (names only):** `META_ADS_ACCESS_TOKEN` (reporting read)
- **Kickoff — weekly-review:** "Review last week's Meta ad performance for {scope} and draft
  optimization suggestions. Draft only — do NOT change budget, targeting, or publish."
- **Return contract (required):** `outcome`, `artifacts`, `followUps`
- **Learning hooks:** `repeated-underperforming-creative`, `budget-pacing-anomaly`

## Arming
See `docs/patterns/assistant-identity.md` — agent principal + scoped worker token +
budget-capped LiteLLM key. Nothing bespoke.
