"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createDb } from "@companyos/db";
import { emitEvent, linkAuthUser } from "@companyos/api";
import { auth } from "@/lib/auth";

const db = createDb();

export async function submitOAuthConsentAction(formData: FormData) {
  const oauthQuery = String(formData.get("oauthQuery") || "");
  const accept = formData.get("accept") === "true";
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");

  // Derive the client and scope for the audit event from the same oauth_query
  // that the provider validates below -- NOT from separately editable hidden
  // fields, which an approver could forge to corrupt the authorization trail.
  const validatedQuery = new URLSearchParams(oauthQuery);
  const clientId = validatedQuery.get("client_id") || "";
  const requestedScope = validatedQuery.get("scope") || "";

  const client = await auth.api.getOAuthClientPublic({
    headers: requestHeaders,
    query: { client_id: clientId },
  });
  const result = await auth.api.oauth2Consent({
    headers: requestHeaders,
    body: { accept, scope: requestedScope || undefined, oauth_query: oauthQuery },
  });

  if (accept) {
    const linked = await linkAuthUser(db, {
      authUserId: session.user.id,
      email: session.user.email || null,
      name: session.user.name || session.user.email || "User",
    });
    await emitEvent(db, {
      type: "connection.authorized",
      principalId: linked.principalId,
      payload: {
        clientId,
        clientName: typeof client.name === "string" && client.name ? client.name : clientId,
        userId: session.user.id,
        principalId: linked.principalId,
        scopes: requestedScope.split(/\s+/).filter(Boolean),
      },
    });
  }

  redirect((result as { url: string }).url);
}
