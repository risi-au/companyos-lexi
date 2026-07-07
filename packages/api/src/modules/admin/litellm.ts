export const DEFAULT_LITELLM_MONTHLY_BUDGET_USD = 25;

export interface LiteLlmAdminConfig {
  baseUrl?: string | null;
  masterKey?: string | null;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface LiteLlmVirtualKey {
  id: string;
  alias: string | null;
  createdAt: string | null;
  budgetUsd: number | null;
  budgetDuration: string | null;
  spendUsd: number;
  modelSpend: Array<{ model: string; spendUsd: number }>;
  models: string[];
  revoked: boolean;
  sourceEnvNames: string[];
}

export interface LiteLlmModelAlias {
  alias: string;
  model: string;
  provider: string | null;
}

export interface LiteLlmProviderKeyPresence {
  name: string;
  present: boolean;
}

export interface LiteLlmAdminState {
  configured: boolean;
  notice: string | null;
  defaultBudgetUsd: number;
  budgetBootstrap: {
    checkedEnvNames: string[];
    updatedEnvNames: string[];
    skippedEnvNames: string[];
  };
  keys: LiteLlmVirtualKey[];
  aliases: LiteLlmModelAlias[];
  providerKeys: LiteLlmProviderKeyPresence[];
  spendByModel: Array<{ model: string; spendUsd: number }>;
}

export interface MintLiteLlmKeyInput {
  alias: string;
  budgetUsd?: number | null;
  models?: string[];
}

export interface LiteLlmKeyMutationResult {
  key: string | null;
  alias: string | null;
}

type JsonObject = Record<string, unknown>;

const ENV_KEY_NAMES = ["LITELLM_EMBED_KEY", "BRAIN_LITELLM_API_KEY"] as const;
const PROVIDER_ENV_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "AZURE_API_KEY",
  "COHERE_API_KEY",
] as const;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function getFetch(config: LiteLlmAdminConfig): typeof fetch {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is required for LiteLLM admin calls");
  return fetchImpl;
}

function normalizeBaseUrl(baseUrl?: string | null): string {
  return (baseUrl || "http://localhost:4000").replace(/\/+$/, "");
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function litellmRequest(config: LiteLlmAdminConfig, path: string, init?: RequestInit): Promise<unknown> {
  if (!config.masterKey) throw new Error("LITELLM_MASTER_KEY is required");
  const response = await getFetch(config)(`${normalizeBaseUrl(config.baseUrl)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.masterKey}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`LiteLLM admin request failed: ${response.status}`);
  }
  return readJson(response);
}

function pickRows(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const object = asObject(payload);
  for (const key of keys) {
    const rows = object[key];
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

function keyToken(row: JsonObject): string | null {
  return asString(row.key) ?? asString(row.token) ?? asString(row.virtual_key) ?? asString(row.virtualKey);
}

function keyIdentifier(row: JsonObject): string {
  return asString(row.id)
    ?? asString(row.key_hash)
    ?? asString(row.keyHash)
    ?? asString(row.key_alias)
    ?? asString(row.keyAlias)
    ?? asString(row.alias)
    ?? "unknown";
}

function keyAlias(row: JsonObject): string | null {
  return asString(row.key_alias) ?? asString(row.keyAlias) ?? asString(row.alias);
}

function normalizeModelSpend(value: unknown): Array<{ model: string; spendUsd: number }> {
  const rows: Array<{ model: string; spendUsd: number }> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const object = asObject(item);
      const model = asString(object.model) ?? asString(object.model_name) ?? asString(object.name);
      const spend = asNumber(object.spend) ?? asNumber(object.spend_usd) ?? asNumber(object.cost);
      if (model) rows.push({ model, spendUsd: spend ?? 0 });
    }
    return rows;
  }
  const object = asObject(value);
  for (const [model, spend] of Object.entries(object)) {
    rows.push({ model, spendUsd: asNumber(spend) ?? 0 });
  }
  return rows;
}

function normalizeKey(rowValue: unknown, env?: Record<string, string | undefined>): LiteLlmVirtualKey {
  const row = asObject(rowValue);
  const token = keyToken(row);
  const sourceEnvNames = ENV_KEY_NAMES.filter((name) => token && env?.[name] === token);
  const modelSpend = normalizeModelSpend(row.model_spend ?? row.modelSpend ?? row.spend_by_model ?? row.spendByModel);
  const normalized: LiteLlmVirtualKey = {
    id: keyIdentifier(row),
    alias: keyAlias(row),
    createdAt: asString(row.created_at) ?? asString(row.createdAt),
    budgetUsd: asNumber(row.max_budget) ?? asNumber(row.maxBudget) ?? asNumber(row.budget),
    budgetDuration: asString(row.budget_duration) ?? asString(row.budgetDuration),
    spendUsd: asNumber(row.spend) ?? asNumber(row.spend_usd) ?? 0,
    modelSpend,
    models: asArray(row.models).map(String),
    revoked: Boolean(row.revoked ?? row.disabled ?? false),
    sourceEnvNames,
  };
  Object.defineProperty(normalized, "rawToken", { value: token, enumerable: false });
  return normalized;
}

function normalizeAliases(payload: unknown): LiteLlmModelAlias[] {
  const rows = pickRows(payload, ["data", "models", "model_info", "modelInfo"]);
  const aliases: LiteLlmModelAlias[] = [];
  for (const item of rows) {
    const row = asObject(item);
    const params = asObject(row.litellm_params ?? row.litellmParams);
    const alias = asString(row.model_name) ?? asString(row.modelName) ?? asString(row.alias);
    const model = asString(params.model) ?? asString(row.model) ?? alias;
    if (!alias || !model) continue;
    aliases.push({
      alias,
      model,
      provider: asString(params.custom_llm_provider) ?? asString(params.provider) ?? asString(row.provider),
    });
  }
  return aliases;
}

function combineSpendByModel(keys: LiteLlmVirtualKey[], payload: unknown): Array<{ model: string; spendUsd: number }> {
  const totals = new Map<string, number>();
  for (const key of keys) {
    for (const spend of key.modelSpend) {
      totals.set(spend.model, (totals.get(spend.model) ?? 0) + spend.spendUsd);
    }
  }
  const rows = pickRows(payload, ["data", "results", "spend", "models"]);
  for (const rowValue of rows) {
    const row = asObject(rowValue);
    const model = asString(row.model) ?? asString(row.model_name) ?? asString(row.name);
    const spend = asNumber(row.spend) ?? asNumber(row.spend_usd) ?? asNumber(row.cost);
    if (model) totals.set(model, (totals.get(model) ?? 0) + (spend ?? 0));
  }
  return [...totals.entries()]
    .map(([model, spendUsd]) => ({ model, spendUsd }))
    .sort((a, b) => b.spendUsd - a.spendUsd || a.model.localeCompare(b.model));
}

function providerKeys(env: Record<string, string | undefined> = process.env): LiteLlmProviderKeyPresence[] {
  return PROVIDER_ENV_NAMES.map((name) => ({ name, present: Boolean(env[name]) }));
}

function redactedMutationResult(payload: unknown): LiteLlmKeyMutationResult {
  const object = asObject(payload);
  const key = asString(object.key) ?? asString(object.token) ?? asString(asObject(object.key_info).key);
  return {
    key,
    alias: asString(object.key_alias) ?? asString(object.alias) ?? asString(asObject(object.key_info).key_alias),
  };
}

async function listVirtualKeys(config: LiteLlmAdminConfig): Promise<LiteLlmVirtualKey[]> {
  const payload = await litellmRequest(config, "/key/list?return_full_object=true");
  return pickRows(payload, ["keys", "data", "key_info", "keyInfo"]).map((row) => normalizeKey(row, config.env));
}

async function listAliases(config: LiteLlmAdminConfig): Promise<LiteLlmModelAlias[]> {
  try {
    return normalizeAliases(await litellmRequest(config, "/model/info"));
  } catch {
    return [];
  }
}

async function listSpendByModelPayload(config: LiteLlmAdminConfig): Promise<unknown> {
  try {
    return await litellmRequest(config, "/spend/models");
  } catch {
    return {};
  }
}

export async function setLiteLlmKeyBudget(
  config: LiteLlmAdminConfig,
  key: string,
  budgetUsd: number,
  budgetDuration = "30d"
): Promise<void> {
  await litellmRequest(config, "/key/update", {
    method: "POST",
    body: JSON.stringify({
      key,
      max_budget: budgetUsd,
      budget_duration: budgetDuration,
    }),
  });
}

export async function mintLiteLlmVirtualKey(
  config: LiteLlmAdminConfig,
  input: MintLiteLlmKeyInput
): Promise<LiteLlmKeyMutationResult> {
  const payload = await litellmRequest(config, "/key/generate", {
    method: "POST",
    body: JSON.stringify({
      key_alias: input.alias,
      max_budget: input.budgetUsd ?? DEFAULT_LITELLM_MONTHLY_BUDGET_USD,
      budget_duration: "30d",
      ...(input.models?.length ? { models: input.models } : {}),
    }),
  });
  return redactedMutationResult(payload);
}

export async function revokeLiteLlmVirtualKey(config: LiteLlmAdminConfig, key: string): Promise<void> {
  await litellmRequest(config, "/key/delete", {
    method: "POST",
    body: JSON.stringify({ keys: [key] }),
  });
}

export async function getLiteLlmAdminState(config: LiteLlmAdminConfig): Promise<LiteLlmAdminState> {
  const env = config.env ?? process.env;
  if (!config.masterKey) {
    return {
      configured: false,
      notice: "LITELLM_MASTER_KEY is not set. LiteLLM key management is visible but read/write calls are disabled.",
      defaultBudgetUsd: DEFAULT_LITELLM_MONTHLY_BUDGET_USD,
      budgetBootstrap: { checkedEnvNames: [...ENV_KEY_NAMES], updatedEnvNames: [], skippedEnvNames: [...ENV_KEY_NAMES] },
      keys: [],
      aliases: [],
      providerKeys: providerKeys(env),
      spendByModel: [],
    };
  }

  const keys = await listVirtualKeys({ ...config, env });
  const updatedEnvNames: string[] = [];
  const skippedEnvNames: string[] = [];
  for (const envName of ENV_KEY_NAMES) {
    const value = env[envName];
    const matchingKey = value ? keys.find((key) => (key as LiteLlmVirtualKey & { rawToken?: string | null }).rawToken === value) : undefined;
    if (!value || !matchingKey || matchingKey.budgetUsd !== null) {
      skippedEnvNames.push(envName);
      continue;
    }
    const rawToken = (matchingKey as LiteLlmVirtualKey & { rawToken?: string | null }).rawToken;
    if (!rawToken) {
      skippedEnvNames.push(envName);
      continue;
    }
    await setLiteLlmKeyBudget(config, rawToken, DEFAULT_LITELLM_MONTHLY_BUDGET_USD);
    matchingKey.budgetUsd = DEFAULT_LITELLM_MONTHLY_BUDGET_USD;
    matchingKey.budgetDuration = matchingKey.budgetDuration ?? "30d";
    updatedEnvNames.push(envName);
  }

  const [aliases, spendPayload] = await Promise.all([
    listAliases(config),
    listSpendByModelPayload(config),
  ]);

  return {
    configured: true,
    notice: null,
    defaultBudgetUsd: DEFAULT_LITELLM_MONTHLY_BUDGET_USD,
    budgetBootstrap: { checkedEnvNames: [...ENV_KEY_NAMES], updatedEnvNames, skippedEnvNames },
    keys,
    aliases,
    providerKeys: providerKeys(env),
    spendByModel: combineSpendByModel(keys, spendPayload),
  };
}
