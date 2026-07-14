"use server";

import { api, getCurrentActorPrincipalId } from "@/lib/api";
import type { AttentionItemView } from "@companyos/api";

export interface NotificationItem {
  id: string;
  title: string;
  kind: AttentionItemView["kind"];
  scopePath: string;
  createdAt: string;
}

function requireActor(actor: string | null): string {
  if (!actor) throw new Error("Your session expired. Sign in again.");
  return actor;
}

function toNotificationItem(item: AttentionItemView): NotificationItem {
  return {
    id: item.id,
    title: item.title,
    kind: item.kind,
    scopePath: item.scopePath,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt),
  };
}

export async function refreshNotificationsAction(): Promise<{ items: NotificationItem[]; total: number }> {
  const actor = requireActor(await getCurrentActorPrincipalId());
  const [items, total] = await Promise.all([
    api.listAttentionItems({ status: "open", limit: 15 }, actor),
    api.countOpenAttentionItems({ scopePath: "root", includeDescendants: true }, actor),
  ]);
  return { items: items.map(toNotificationItem), total };
}
