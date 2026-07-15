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

const CONNECTION_EXPIRY_SWEEP_THROTTLE_MS = 5 * 60 * 1000;
let lastConnectionExpirySweepAt = 0;

function triggerConnectionExpirySweep(): void {
  const now = Date.now();
  if (now - lastConnectionExpirySweepAt < CONNECTION_EXPIRY_SWEEP_THROTTLE_MS) return;
  lastConnectionExpirySweepAt = now;
  try {
    void api.ensureConnectionExpiryAttention().catch(() => {
      /* The bell must stay available even if the sweep fails. */
    });
  } catch {
    /* The bell must stay available even if the sweep fails. */
  }
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
  triggerConnectionExpirySweep();
  const [items, total] = await Promise.all([
    api.listAttentionItems({ status: "open", limit: 15 }, actor),
    api.countOpenAttentionItems({ scopePath: "root", includeDescendants: true }, actor),
  ]);
  return { items: items.map(toNotificationItem), total };
}
