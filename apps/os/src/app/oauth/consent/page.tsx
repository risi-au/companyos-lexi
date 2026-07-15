import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@companyos/ui";
import { auth } from "@/lib/auth";
import { submitOAuthConsentAction } from "./actions";

type SearchParams = Record<string, string | string[] | undefined>;

function value(params: SearchParams, key: string): string {
  const raw = params[key];
  return Array.isArray(raw) ? raw[0] || "" : raw || "";
}

function signedQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (Array.isArray(raw)) raw.forEach((item) => query.append(key, item));
    else if (raw !== undefined) query.set(key, raw);
  }
  return query.toString();
}

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const clientId = value(params, "client_id");
  if (!clientId) redirect("/sign-in");

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in?redirect=" + encodeURIComponent("/oauth/consent?" + signedQuery(params)));

  const client = await auth.api.getOAuthClientPublic({
    headers: requestHeaders,
    query: { client_id: clientId },
  });
  const clientName = typeof client.name === "string" && client.name ? client.name : clientId;
  const scope = value(params, "scope");
  const scopes = scope.split(/\s+/).filter(Boolean);
  const oauthQuery = signedQuery(params);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-[var(--space-4)]">
      <section className="w-full max-w-[520px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-6)] shadow-sm">
        <h1 className="text-[var(--font-size-2xl)] font-semibold text-[var(--foreground)]">Authorize connection</h1>
        <p className="mt-[var(--space-2)] text-[var(--font-size-md)] text-[var(--muted-foreground)]">
          <span className="font-medium text-[var(--foreground)]">{clientName}</span> wants to access your CompanyOS MCP workspace.
        </p>
        <div className="mt-[var(--space-5)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] p-[var(--space-4)]">
          <p className="text-[var(--font-size-sm)] font-medium text-[var(--foreground)]">Requested access</p>
          <ul className="mt-[var(--space-2)] list-disc pl-[var(--space-5)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {scopes.length ? scopes.map((item) => <li key={item}>{item}</li>) : <li>CompanyOS MCP access</li>}
          </ul>
        </div>
        <div className="mt-[var(--space-6)] flex justify-end gap-[var(--space-3)]">
          <form action={submitOAuthConsentAction}>
            <input type="hidden" name="oauthQuery" value={oauthQuery} />
            <Button type="submit" name="accept" value="false" variant="secondary">Deny</Button>
          </form>
          <form action={submitOAuthConsentAction}>
            <input type="hidden" name="oauthQuery" value={oauthQuery} />
            <Button type="submit" name="accept" value="true">Approve</Button>
          </form>
        </div>
      </section>
    </main>
  );
}
