"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, RefreshCw, Save, Trash2, X } from "lucide-react";
import {
  deleteCredentialAction,
  listCredentialsAction,
  setCredentialAction,
} from "./actions";

type AccessRole = "owner" | "admin" | "editor" | "agent" | "viewer" | string;

interface CredentialRow {
  id: string;
  name: string;
  description: string;
  setAt: string | Date;
  updatedAt: string | Date;
  lastAccessedAt: string | Date | null;
  hasValue: true;
}

export interface RequiredCredential {
  name: string;
  whatFor?: string;
  loginMethodNotes?: string;
}

function canManage(access: AccessRole | null): boolean {
  return access === "owner" || access === "admin";
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function existingByName(rows: CredentialRow[], name: string): CredentialRow | undefined {
  return rows.find((row) => row.name.toLowerCase() === name.toLowerCase());
}

export function CredentialsPanel({
  scopePath,
  initialAccess,
  requiredCredentials = [],
  setupMode = false,
}: {
  scopePath: string;
  initialAccess: AccessRole | null;
  requiredCredentials?: RequiredCredential[];
  setupMode?: boolean;
}) {
  const [rows, setRows] = useState<CredentialRow[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mayManage = canManage(initialAccess);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listCredentialsAction(scopePath) as CredentialRow[]);
      setError(null);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  }, [scopePath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function clearForm() {
    setName("");
    setDescription("");
    setValue("");
  }

  async function onSave() {
    setSubmitting(true);
    setError(null);
    try {
      await setCredentialAction({
        scopePath,
        name: name.trim(),
        description: description.trim(),
        value,
      });
      clearForm();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save credential");
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(row: CredentialRow) {
    if (!confirm(`Delete credential "${row.name}"?`)) return;
    setError(null);
    try {
      await deleteCredentialAction({ scopePath, name: row.name });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete credential");
    }
  }

  function fillFromRequired(required: RequiredCredential) {
    setName(required.name);
    setDescription(required.whatFor || "");
    setValue("");
  }

  function edit(row: CredentialRow) {
    setName(row.name);
    setDescription(row.description);
    setValue("");
  }

  return (
    <div className="space-y-[var(--space-4)]">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-4)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
          <div className="flex items-center gap-[var(--space-2)]">
            <KeyRound size={18} />
            <div>
              <div className="text-[var(--font-size-sm)] font-medium">{setupMode ? "Setup credentials" : "Credential vault"}</div>
              <div className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Values are write-only in the OS UI.</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Refresh credentials"
            title="Refresh credentials"
            onClick={refresh}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {error && (
          <div className="mb-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--destructive)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--destructive)]">
            {error}
          </div>
        )}

        {requiredCredentials.length > 0 && (
          <div className="mb-[var(--space-4)] space-y-[var(--space-2)]">
            <div className="text-[var(--font-size-xs)] font-medium text-[var(--muted-foreground)]">Requested during intake</div>
            <div className="grid gap-[var(--space-2)]">
              {requiredCredentials.map((required) => {
                const existing = existingByName(rows, required.name);
                return (
                  <div key={required.name} className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)]">
                    <div className="min-w-0">
                      <div className="text-[var(--font-size-sm)] font-medium">{required.name}</div>
                      <div className="mt-1 text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                        {required.whatFor || "No use specified."}
                        {required.loginMethodNotes ? ` | ${required.loginMethodNotes}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-[var(--space-2)]">
                      <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">{existing ? "set" : "unset"}</span>
                      {mayManage && (
                        <button
                          type="button"
                          onClick={() => fillFromRequired(required)}
                          className="rounded-[var(--radius-sm)] border border-[var(--border)] px-[var(--space-2)] py-[var(--space-1)] text-[var(--font-size-xs)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                        >
                          {existing ? "Update" : "Set"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!mayManage ? (
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] py-[var(--space-2)] text-[var(--font-size-sm)] text-[var(--muted-foreground)]">
            Admin access is required to add, update, or delete credentials.
          </div>
        ) : (
          <div className="grid gap-[var(--space-3)] lg:grid-cols-[220px_1fr_240px_auto_auto]">
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Description</label>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-[var(--font-size-xs)] text-[var(--muted-foreground)]">Value</label>
              <input
                type="password"
                autoComplete="new-password"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--background)] px-[var(--space-3)] text-[var(--font-size-sm)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={submitting || !name.trim() || !value}
                onClick={onSave}
                className="inline-flex h-10 items-center gap-[var(--space-2)] rounded-[var(--radius-sm)] bg-[var(--primary)] px-[var(--space-3)] text-[var(--font-size-sm)] text-[var(--primary-foreground)] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <Save size={15} />
                Save
              </button>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                aria-label="Clear credential form"
                title="Clear credential form"
                onClick={clearForm}
                className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
        <div className="mb-[var(--space-3)] text-[var(--font-size-sm)] font-medium">This scope&apos;s credentials</div>
        {loading ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">Loading credentials...</div>
        ) : rows.length === 0 ? (
          <div className="text-[var(--font-size-sm)] text-[var(--muted-foreground)]">No credentials set for this scope.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[var(--font-size-sm)]">
              <thead className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">
                <tr>
                  <th className="pb-[var(--space-2)] font-medium">Name</th>
                  <th className="pb-[var(--space-2)] font-medium">Description</th>
                  <th className="pb-[var(--space-2)] font-medium">Status</th>
                  <th className="pb-[var(--space-2)] font-medium">Updated</th>
                  <th className="pb-[var(--space-2)] font-medium">Last accessed</th>
                  <th className="pb-[var(--space-2)] font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--border)]">
                    <td className="py-[var(--space-2)] font-medium">{row.name}</td>
                    <td className="py-[var(--space-2)] text-[var(--muted-foreground)]">{row.description || "-"}</td>
                    <td className="py-[var(--space-2)]">set</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.updatedAt)}</td>
                    <td className="py-[var(--space-2)] tabular-nums">{formatDate(row.lastAccessedAt)}</td>
                    <td className="py-[var(--space-2)]">
                      {mayManage ? (
                        <div className="flex gap-[var(--space-2)]">
                          <button
                            type="button"
                            aria-label={`Edit ${row.name}`}
                            title={`Edit ${row.name}`}
                            onClick={() => edit(row)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${row.name}`}
                            title={`Delete ${row.name}`}
                            onClick={() => onDelete(row)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--destructive)] text-[var(--destructive)] hover:bg-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--font-size-xs)] text-[var(--muted-foreground)]">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
