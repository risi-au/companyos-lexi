import Link from "next/link";
import { api, getCurrentActorPrincipalId } from "@/lib/api";
import { Card, EmptyState, Table } from "@companyos/ui";
import { KeyRound, Settings } from "lucide-react";
import { ConfirmSubmitButton } from "@/modules/admin/ConfirmSubmitButton";
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
        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Instance</div>
          <dl className="grid grid-cols-[140px_1fr] gap-y-[var(--space-2)] text-[var(--font-size-sm)]">
            <dt className="text-[var(--muted-foreground)]">Name</dt>
            <dd>{settings.instanceName}</dd>
            <dt className="text-[var(--muted-foreground)]">Skills repo</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.skillsRepo ?? "-"}</dd>
            <dt className="text-[var(--muted-foreground)]">Root scope</dt>
            <dd className="font-mono text-[var(--font-size-xs)]">{settings.rootScopeId ?? "-"}</dd>
          </dl>
        </Card>
        <Card>
          <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Integrations</div>
          <div className="grid grid-cols-2 gap-[var(--space-2)] text-[var(--font-size-sm)]">
            {Object.entries(settings.integrations).map(([name, present]) => (
              <div key={name} className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)]">
                <span>{name}</span>
                <span className="text-[var(--muted-foreground)]">{present ? "configured" : "missing"}</span>
              </div>
            ))}
          </div>
        </Card>
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

          <Table
            rows={llm.keys}
            minWidth="980px"
            getRowKey={(key) => key.id}
            empty={<EmptyState icon={<KeyRound size={16} />} title="No LiteLLM keys" body="Mint a virtual key to give an agent budgeted model access." />}
            columns={[
              {
                key: "alias",
                header: "Alias",
                cell: (key) => (
                  <>
                    <div>{key.alias ?? "-"}</div>
                    <div className="font-mono text-[var(--font-size-xs)] text-[var(--mutedfg)]">{key.createdAt ?? "-"}</div>
                  </>
                ),
              },
              { key: "budget", header: "Budget", cell: (key) => `${money(key.budgetUsd)} ${key.budgetDuration ?? ""}` },
              { key: "spend", header: "Spend", cell: (key) => money(key.spendUsd) },
              { key: "env", header: "Env", className: "font-mono text-[var(--font-size-xs)]", cell: (key) => key.sourceEnvNames.join(", ") || "-" },
              {
                key: "modelSpend",
                header: "Per-model spend",
                cell: (key) => key.modelSpend.length === 0 ? "-" : key.modelSpend.map((spend) => (
                  <div key={spend.model} className="font-mono text-[var(--font-size-xs)]">{spend.model}: {money(spend.spendUsd)}</div>
                )),
              },
              {
                key: "actions",
                header: "Actions",
                cell: (key) => (
                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    <form action={setLiteLlmBudgetAction} className="flex gap-[var(--space-1)]">
                      <input type="hidden" name="key" value={key.id} />
                      <input type="hidden" name="alias" value={key.alias ?? ""} />
                      <input name="budgetUsd" type="number" min="0" step="0.01" defaultValue={key.budgetUsd ?? llm.defaultBudgetUsd} className="w-24 rounded-[var(--radius-3)] border border-[var(--border)] bg-[var(--bg)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)]" />
                      <button className="rounded-[var(--radius-3)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--hover)]">Set</button>
                    </form>
                    <form action={revokeLiteLlmKeyAction}>
                      <input type="hidden" name="key" value={key.id} />
                      <input type="hidden" name="alias" value={key.alias ?? ""} />
                      <ConfirmSubmitButton
                        title={`Revoke key ${key.alias ?? key.id}?`}
                        body="Agents using this virtual key lose access immediately. Usage history is kept."
                        confirmLabel="Revoke key"
                        className="rounded-[var(--radius-3)] border border-[var(--err)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] text-[var(--err)] hover:bg-[var(--hover)]"
                      >
                        Revoke
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                ),
              },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
          <Card>
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Aliases</div>
            <div className="space-y-[var(--space-2)]">
              {llm.aliases.map((alias) => (
                <div key={alias.alias} className="font-mono text-[var(--font-size-xs)]">{alias.alias} -&gt; {alias.model}{alias.provider ? ` (${alias.provider})` : ""}</div>
              ))}
              {llm.aliases.length === 0 ? <EmptyState icon={<Settings size={16} />} title="No aliases returned" body="Configured model aliases will appear here when LiteLLM reports them." /> : null}
            </div>
          </Card>
          <Card>
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Provider env keys</div>
            <div className="grid grid-cols-2 gap-[var(--space-2)] text-[var(--font-size-xs)]">
              {llm.providerKeys.map((key) => (
                <div key={key.name} className="flex justify-between rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)]">
                  <span className="font-mono">{key.name}</span>
                  <span className="text-[var(--muted-foreground)]">{key.present ? "present" : "missing"}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">Spend by model</div>
            <div className="space-y-[var(--space-2)]">
              {llm.spendByModel.map((spend) => (
                <div key={spend.model} className="flex justify-between gap-[var(--space-3)] text-[var(--font-size-xs)]">
                  <span className="font-mono">{spend.model}</span>
                  <span>{money(spend.spendUsd)}</span>
                </div>
              ))}
              {llm.spendByModel.length === 0 ? <EmptyState icon={<KeyRound size={16} />} title="No spend returned" body="Model spend appears after agents report usage." /> : null}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
