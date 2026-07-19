import type { AttentionItemView } from "@companyos/api";

export interface WikiQuestionClaimView {
  slug: string;
  title: string;
  quote: string;
  normalizedValue: string;
}

export interface WikiQuestionRepairView {
  slug: string;
  title: string;
  currentMd: string;
  proposedMd: string;
}

export type WikiQuestionView =
  | {
      state: "v2-contradiction";
      title: "Two wiki pages disagree";
      explanation: string;
      claims: [WikiQuestionClaimView, WikiQuestionClaimView];
      choices: [
        { id: "first"; label: string; repair: WikiQuestionRepairView },
        { id: "second"; label: string; repair: WikiQuestionRepairView },
      ];
    }
  | { state: "v2-stale"; title: "This page may be out of date"; slug: string; pageTitle: string; reviewDueAt: string; currentMd: string }
  | { state: "legacy"; title: "This older check does not include enough evidence."; pages: Array<{ slug: string; title: string }> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function claim(value: unknown): WikiQuestionClaimView | null {
  if (!isRecord(value)) return null;
  const slug = text(value.slug);
  const title = text(value.title);
  const quote = text(value.quote);
  const normalizedValue = text(value.normalizedValue);
  if (!slug || !title || !quote || !normalizedValue) return null;
  return { slug, title, quote, normalizedValue };
}

function repair(value: unknown): WikiQuestionRepairView | null {
  if (!isRecord(value)) return null;
  const slug = text(value.slug);
  const title = text(value.title);
  if (!slug || !title || typeof value.currentMd !== "string" || typeof value.proposedMd !== "string" || value.currentMd === value.proposedMd) return null;
  return { slug, title, currentMd: value.currentMd, proposedMd: value.proposedMd };
}

export function pagePreviewBody(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trimStart();
}

export function parseWikiQuestionView(item: Pick<AttentionItemView, "payload" | "title">): WikiQuestionView {
  const payload = isRecord(item.payload) ? item.payload : {};
  const legacyPages = (): Array<{ slug: string; title: string }> => {
    const pages: Array<{ slug: string; title: string }> = [];
    if (Array.isArray(payload.slugs)) {
      for (const slug of payload.slugs) {
        if (typeof slug === "string" && slug.trim()) pages.push({ slug: slug.trim(), title: slug.trim().replaceAll("-", " ") });
      }
    }
    const slug = text(payload.slug);
    if (slug && !pages.some((page) => page.slug === slug)) pages.push({ slug, title: text(payload.title) ?? slug.replaceAll("-", " ") });
    return pages;
  };

  if (payload.version === 2 && payload.type === "contradiction") {
    const rawClaims = Array.isArray(payload.claims) ? payload.claims : [];
    const claims = rawClaims.map(claim).filter(Boolean) as WikiQuestionClaimView[];
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices.find((choiceValue) => isRecord(choiceValue) && choiceValue.id === "first");
    const second = choices.find((choiceValue) => isRecord(choiceValue) && choiceValue.id === "second");
    const firstRepair = isRecord(first) ? repair(first.repair) : null;
    const secondRepair = isRecord(second) ? repair(second.repair) : null;
    const firstLabel = isRecord(first) ? text(first.label) : null;
    const secondLabel = isRecord(second) ? text(second.label) : null;
    const exactChoices = choices.length === 2
      && choices.every((choiceValue) => isRecord(choiceValue))
      && new Set(choices.map((choiceValue) => (choiceValue as Record<string, unknown>).id)).size === 2;
    const repairsMatchClaims = claims.length === 2
      && !!firstRepair
      && firstRepair.slug === claims[1]?.slug
      && firstRepair.title === claims[1]?.title
      && !!secondRepair
      && secondRepair.slug === claims[0]?.slug
      && secondRepair.title === claims[0]?.title;
    const explanation = text(payload.explanation);
    if (rawClaims.length === 2 && claims.length === 2 && exactChoices && first && second && firstRepair && secondRepair && firstLabel && secondLabel && repairsMatchClaims && explanation) {
      return {
        state: "v2-contradiction",
        title: "Two wiki pages disagree",
        explanation,
        claims: [claims[0]!, claims[1]!],
        choices: [
          { id: "first", label: firstLabel, repair: firstRepair },
          { id: "second", label: secondLabel, repair: secondRepair },
        ],
      };
    }
  }

  if (payload.version === 2 && payload.type === "stale") {
    const slug = text(payload.slug);
    const pageTitle = text(payload.title);
    const reviewDueAt = text(payload.reviewDueAt);
    if (slug && pageTitle && reviewDueAt && Number.isFinite(new Date(reviewDueAt).getTime()) && typeof payload.currentMd === "string") {
      return { state: "v2-stale", title: "This page may be out of date", slug, pageTitle, reviewDueAt, currentMd: payload.currentMd };
    }
  }

  return { state: "legacy", title: "This older check does not include enough evidence.", pages: legacyPages() };
}

export function plainAttentionKindLabel(item: Pick<AttentionItemView, "kind" | "payload">): string {
  if (item.kind === "open_question") return "Open question";
  if (item.kind === "wiki_proposal") return "Suggested wiki update";
  if (item.kind === "lint_finding") return "Wiki question";
  if (item.kind === "external_gate") return "External gate";
  if (item.kind === "page_update") return "Page update";
  if (item.kind === "connection_expiry") return "Worker token";
  return "Graduation";
}

export function plainAttentionTitle(item: Pick<AttentionItemView, "kind" | "payload" | "title">): string {
  if (item.kind !== "lint_finding") return item.kind === "wiki_proposal" ? "Suggested wiki update" : item.title;
  return parseWikiQuestionView(item).title;
}
