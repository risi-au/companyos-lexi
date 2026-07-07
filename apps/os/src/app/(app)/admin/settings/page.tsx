import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { revokeLiteLlmKeyAction, setLiteLlmBudgetAction } from "@/modules/admin/actions";
import { LiteLlmMintForm } from "@/modules/admin/LiteLlmMintForm";

function money(value: number | null | undefined): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default async function AdminSettingsPage() {
  const actor = await getCurrentActorPrincipalId();
  if (!actor) return null;
  const [settings, llm] = await Promise.all([
    api.getAdminSettings(actor),
    api.getAdminLiteLlmState(actor),
  ]);

  return (
    <div className="space-y-[var(--space-5)]">
      <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Instance</div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-[var(--space-2)] text-[var(--font-size-sm)]">
            <dt className="text-[var(--muted-foreground)]">Name</dt>
            <dd>{settings.instanceName}</dd>
            <dt className="text-[var(--muted-foreground)]">Skills repo</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.skillsRepo ?? "-"}</dd>
            <dt className="text-[var(--muted-foreground)]">Root scope</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.rootScopeId ?? "-"}</dd>
          </dl>
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Integrations</div>
          <div className="grid grid-cols-2 gap-[var(--space-2)] text-[var(--font-size-sm)]">
            {Object.entries(settings.integrations).map(([name, present]) => (
              <div key={name} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                <span>{name}</span>
                <span className="text-[var(--muted-foreground)]">{present ? "configured" : "missing"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="space-y-[var(--space-4)]">
        <div>
          <h2 className="text-[var(--font-size-xl)] font-semibold tracking-[-0.01em]">LLM & keys</h2>
          <div className="mt-[var(--space-1)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            LiteLLM virtual keys, aliases, provider key presence, and spend. Agent-side token usage is in <Link href="/admin/mcp" className="text-[var(--primary)]">MCP Manager</Link>; probes are in <Link href="/admin/health" className="text-[var(--primary)]">Health</Link>.
          </div>
        </div>

        {llm.notice ? (
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            {llm.notice}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-[var(--space-4)] xl:grid-cols-[360px_1fr]">
          <LiteLlmMintForm defaultBudgetUsd={llm.defaultBudgetUsd} configured={llm.configured} />

          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[980px] text-left text-[var(--font-size-sm)]">
              <thead className="border-b border-[var(--border)] text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Alias</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Budget</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Spend</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Env</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Per-model spend</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {llm.keys.map((key) => (
                  <tr key={key.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <div>{key.alias ?? "-"}</div>
                      <div className="font-mono text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{key.createdAt ?? "-"}</div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">{money(key.budgetUsd)} {key.budgetDuration ?? ""}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">{money(key.spendUsd)}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)] font-mono text-[var(--font-size-xs)]">{key.sourceEnvNames.join(", ") || "-"}</td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      {key.modelSpend.length === 0 ? "-" : key.modelSpend.map((spend) => (
                        <div key={spend.model} className="font-mono text-[var(--font-size-xs)]">{spend.model}: {money(spend.spendUsd)}</div>
                      ))}
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="flex flex-wrap gap-[var(--space-2)]">
                        <form action={setLiteLlmBudgetAction} className="flex gap-[var(--space-1)]">
                          <input type="hidden" name="key" value={key.id} />
                          <input type="hidden" name="alias" value={key.alias ?? ""} />
                          <input name="budgetUsd" type="number" min="0" step="0.01" defaultValue={key.budgetUsd ?? llm.defaultBudgetUsd} className="w-24 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)]" />
                          <button className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)]">Set</button>
                        </form>
                        <form action={revokeLiteLlmKeyAction}>
                          <input type="hidden" name="key" value={key.id} />
                          <input type="hidden" name="alias" value={key.alias ?? ""} />
                          <button className="rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {llm.keys.length === 0 ? <tr><td colSpan={6} className="px-[var(--space-3)] py-[var(--space-4)] text-[var(--muted-foreground)]">No keys returned.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Aliases</div>
            <div className="space-y-[var(--space-2)]">
              {llm.aliases.map((alias) => (
                <div key={alias.alias} className="font-mono text-[var(--font-size-xs)]">{alias.alias} -&gt; {alias.model}{alias.provider ? ` (${alias.provider})` : ""}</div>
              ))}
              {llm.aliases.length === 0 ? <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No aliases returned.</div> : null}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Provider env keys</div>
            <div className="grid grid-cols-2 gap-[var(--space-2)] text-[var(--font-size-xs)]">
              {llm.providerKeys.map((key) => (
                <div key={key.name} className="flex justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)]">
                  <span className="font-mono">{key.name}</span>
                  <span className="text-[var(--muted-foreground)]">{key.present ? "present" : "missing"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Spend by model</div>
            <div className="space-y-[var(--space-2)]">
              {llm.spendByModel.map((spend) => (
                <div key={spend.model} className="flex justify-between gap-[var(--space-3)] text-[var(--font-size-xs)]">
                  <span className="font-mono">{spend.model}</span>
                  <span>{money(spend.spendUsd)}</span>
                </div>
              ))}
              {llm.spendByModel.length === 0 ? <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No spend returned.</div> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
