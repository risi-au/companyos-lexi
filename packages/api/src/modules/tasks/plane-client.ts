/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PlaneConfig {
  baseUrl: string; // e.g. http://localhost:8000 or https://api.plane.so
  apiToken: string;
  workspaceSlug: string;
}

export type FetchLike = (input: string, init?: any) => Promise<Response>;

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}/api/v1/workspaces${p}`;
}

export class PlaneClient {
  constructor(
    private readonly config: PlaneConfig,
    private readonly fetchImpl: FetchLike = (globalThis as any).fetch
  ) {
    if (!this.fetchImpl) {
      throw new Error("fetch implementation required for PlaneClient");
    }
  }

  private get headers() {
    return {
      "X-API-Key": this.config.apiToken,
      "Content-Type": "application/json",
    } as Record<string, string>;
  }

  private url(path: string): string {
    // path should start after /workspaces/{slug} e.g. /projects/...
    return joinUrl(this.config.baseUrl, `/${this.config.workspaceSlug}${path}`);
  }

  private async request<T>(path: string, init?: any): Promise<T> {
    const res = await this.fetchImpl(this.url(path), {
      ...init,
      headers: { ...this.headers, ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Plane API ${init?.method || "GET"} ${path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  // GET /projects/
  async getProjects(): Promise<any[]> {
    const data: any = await this.request(`/projects/`);
    return Array.isArray(data) ? data : (data.results || []);
  }

  // POST /projects/
  async createProject(name: string, identifier?: string): Promise<any> {
    const body: Record<string, unknown> = { name };
    if (identifier) body.identifier = identifier;
    return this.request(`/projects/`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // GET /projects/{project_id}/states/
  async getStates(projectId: string): Promise<any[]> {
    const data: any = await this.request(`/projects/${projectId}/states/`);
    return Array.isArray(data) ? data : (data.results || []);
  }

  // POST /projects/{project_id}/labels/
  async createLabel(projectId: string, name: string, color = "#64748b"): Promise<any> {
    const body = { name, color };
    return this.request(`/projects/${projectId}/labels/`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // GET /projects/{project_id}/labels/
  async listLabels(projectId: string): Promise<any[]> {
    const data: any = await this.request(`/projects/${projectId}/labels/`);
    return Array.isArray(data) ? data : (data.results || []);
  }

  // POST /projects/{project_id}/work-items/
  async createIssue(
    projectId: string,
    data: {
      name: string;
      description_html?: string;
      state?: string;
      priority?: string;
      labels?: string[];
      target_date?: string;
    }
  ): Promise<any> {
    const body: any = { name: data.name };
    if (data.description_html) body.description_html = data.description_html;
    if (data.state) body.state = data.state;
    if (data.priority) body.priority = data.priority;
    if (data.labels) body.labels = data.labels;
    if (data.target_date) body.target_date = data.target_date;
    return this.request(`/projects/${projectId}/work-items/`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // PATCH /projects/{project_id}/work-items/{issue_id}/
  async updateIssue(
    projectId: string,
    issueId: string,
    data: {
      name?: string;
      description_html?: string;
      state?: string;
      priority?: string;
      labels?: string[];
      target_date?: string;
    }
  ): Promise<any> {
    const body: any = {};
    if (data.name !== undefined) body.name = data.name;
    if (data.description_html !== undefined) body.description_html = data.description_html;
    if (data.state !== undefined) body.state = data.state;
    if (data.priority !== undefined) body.priority = data.priority;
    if (data.labels !== undefined) body.labels = data.labels;
    if (data.target_date !== undefined) body.target_date = data.target_date;
    return this.request(`/projects/${projectId}/work-items/${issueId}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  // GET single work item
  async getIssue(projectId: string, issueId: string): Promise<any> {
    return this.request(`/projects/${projectId}/work-items/${issueId}/`);
  }

  // GET list with optional filter support (simple query for label or state)
  async listIssues(
    projectId: string,
    filters?: { label?: string; labels?: string[]; state_group?: string; state?: string }
  ): Promise<any[]> {
    let q = `/projects/${projectId}/work-items/`;
    const params: string[] = [];
    if (filters?.state) params.push(`state=${encodeURIComponent(filters.state)}`);
    if (filters?.state_group) params.push(`state_group=${encodeURIComponent(filters.state_group)}`);
    if (filters?.label) params.push(`labels=${encodeURIComponent(filters.label)}`);
    if (filters?.labels && filters.labels.length) {
      // plane may support repeated or comma, use first for mock simplicity or labels= 
      params.push(`labels=${encodeURIComponent(filters.labels[0]!)}`);
    }
    if (params.length) q += `?${params.join("&")}`;
    const data: any = await this.request(q);
    return Array.isArray(data) ? data : (data.results || []);
  }
}
