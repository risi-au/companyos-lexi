/* eslint-disable @typescript-eslint/no-explicit-any */
export type FetchLike = (input: string, init?: any) => Promise<Response>;

export interface GitHubConfig {
  baseUrl?: string;
  token: string;
  org: string;
  fetch?: FetchLike;
}

export interface GitHubRepo {
  name: string;
  full_name?: string;
  private?: boolean;
}

export interface GitHubFile {
  sha: string;
  contentUtf8: string;
}

export interface GitHubTreeFile {
  path: string;
  sha: string;
}

export class OrgNotFoundError extends Error {
  constructor(public readonly org: string) {
    super(`GitHub org not found: ${org}`);
    this.name = "OrgNotFoundError";
  }
}

function encodePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

export class GitHubClient {
  readonly org: string;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: GitHubConfig) {
    this.baseUrl = (config.baseUrl || "https://api.github.com").replace(/\/+$/, "");
    this.token = config.token;
    this.org = config.org;
    this.fetchImpl = config.fetch || (globalThis as any).fetch;
    if (!this.fetchImpl) {
      throw new Error("fetch implementation required for GitHubClient");
    }
  }

  private url(path: string): string {
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${p}`;
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  private async request<T>(path: string, init?: any): Promise<{ status: number; data: T }> {
    const res = await this.fetchImpl(this.url(path), {
      ...init,
      headers: { ...this.headers, ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API ${init?.method || "GET"} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) {
      return { status: res.status, data: undefined as T };
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  async getRepo(repo: string): Promise<GitHubRepo | null> {
    const path = `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repo)}`;
    const res = await this.fetchImpl(this.url(path), { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API GET ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as GitHubRepo;
  }

  async createRepo(repo: string, options: { private: true }): Promise<GitHubRepo> {
    const path = `/orgs/${encodeURIComponent(this.org)}/repos`;
    const res = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ name: repo, private: options.private }),
    });
    if (res.status === 404) {
      throw new OrgNotFoundError(this.org);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API POST ${path} failed: ${res.status} ${text}`);
    }
    return (await res.json()) as GitHubRepo;
  }

  async listFiles(repo: string, options: { ref?: string } = {}): Promise<GitHubTreeFile[]> {
    const ref = options.ref || "HEAD";
    const path = `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const { data } = await this.request<{ tree?: { path?: string; sha?: string; type?: string }[] }>(path);
    return (data.tree || [])
      .filter((entry) => entry.type === "blob" && !!entry.path && !!entry.sha)
      .map((entry) => ({ path: entry.path!, sha: entry.sha! }));
  }

  async getFile(repo: string, path: string): Promise<GitHubFile | null> {
    const apiPath = `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`;
    const res = await this.fetchImpl(this.url(apiPath), { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GitHub API GET ${apiPath} failed: ${res.status} ${text}`);
    }
    const data = await res.json() as { sha?: string; content?: string; encoding?: string; type?: string };
    if (!data.sha || data.type === "dir") {
      throw new Error(`GitHub contents path is not a file: ${path}`);
    }
    const normalized = (data.content || "").replace(/\n/g, "");
    const contentUtf8 = Buffer.from(normalized, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    return { sha: data.sha, contentUtf8 };
  }

  async putFile(
    repo: string,
    path: string,
    contentUtf8: string,
    message: string
  ): Promise<{ written: boolean; sha?: string }> {
    const existing = await this.getFile(repo, path);
    if (existing?.contentUtf8 === contentUtf8) {
      return { written: false, sha: existing.sha };
    }

    const apiPath = `/repos/${encodeURIComponent(this.org)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`;
    const body: Record<string, unknown> = {
      message,
      content: Buffer.from(contentUtf8, "utf8").toString("base64"),
    };
    if (existing?.sha) body.sha = existing.sha;

    const { data } = await this.request<{ content?: { sha?: string } }>(apiPath, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return { written: true, sha: data?.content?.sha };
  }
}
