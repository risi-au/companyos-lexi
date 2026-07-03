import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createRecord,
  getRecord,
  listRecords,
  getScope,
  getChildren,
  getSubtree,
  listModules,
  requireAccess,
  createTask,
  completeTask,
  updateTask,
  listTasks,
  writeMetrics,
  queryMetrics,
  listMetricNames,
  saveDashboard,
  getDashboard,
  listDashboards,
  revertDashboard,
  getWidgetVocabulary,
  saveDoc,
  getDoc,
  listDocs,
  listDocRevisions,
  revertDoc,
  saveCanvas,
  getCanvas,
  listCanvases,
  PlaneClient,
  GitHubClient,
  provisionScope,
  registerCapability,
  reportRun,
  listCapabilities,
  listCapabilityRuns,
  listAlerts,
  syncSkills,
  listSkills,
  getSkill,
  skillsContextSection,
  type DB,
  AccessDeniedError,
  AlertValidationError,
  ScopeNotFoundError,
  CapabilityNotFoundError,
  SkillNotFoundError,
  RecordNotFoundError,
  DashboardValidationError,
  DocumentNotFoundError,
  CanvasNotFoundError,
  CanvasSizeError,
} from "@companyos/api";

export interface CreateServerOptions {
  db: DB;
  principalId: string | null;
  planeClient?: PlaneClient | null;
  githubClient?: GitHubClient | null;
}

function formatError(e: unknown): string {
  if (e instanceof AccessDeniedError) {
    return `Access denied: requires ${e.requiredRole} on ${e.scopePath}`;
  }
  if (e instanceof ScopeNotFoundError) {
    return `Scope not found: ${e.path}`;
  }
  if (e instanceof CapabilityNotFoundError) {
    return `Capability not found: ${e.capabilityName} in ${e.scopePath}`;
  }
  if (e instanceof AlertValidationError) {
    return e.message;
  }
  if (e instanceof SkillNotFoundError) {
    return `Skill not found: ${e.skillName}`;
  }
  if (e instanceof RecordNotFoundError) {
    return `Record not found: ${e.id}`;
  }
  if (e instanceof DashboardValidationError) {
    return `Dashboard validation failed: ${e.errors.map((er: { path?: (string | number)[]; message: string }) => `${(er.path || []).join(".")}: ${er.message}`).join("; ")}`;
  }
  if (e instanceof DocumentNotFoundError) {
    return `Document not found: ${e.slug} in ${e.scopePath}`;
  }
  if (e instanceof CanvasNotFoundError) {
    return `Canvas not found: ${e.slug} in ${e.scopePath}`;
  }
  if (e instanceof CanvasSizeError) {
    return `Canvas size error: ${e.message}`;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return String(e);
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

export function createServer(options: CreateServerOptions) {
  const { db, principalId, planeClient = null } = options;
  const githubClient = options.githubClient === undefined
    ? createGitHubClientFromEnv()
    : options.githubClient;

  const server = new McpServer({
    name: "companyos",
    version: "0.0.0",
  });

  // ping - no auth required for connectivity
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check / connectivity test. No authentication required.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
    })
  );

  // Helper to ensure auth for protected tools
  function ensurePrincipal(): string {
    if (!principalId) {
      throw new Error("Unauthenticated: provide a valid COS_TOKEN (cos_...)");
    }
    return principalId;
  }

  function createGitHubClientFromEnv(): GitHubClient | null {
    const token = process.env.GITHUB_TOKEN;
    const org = process.env.GITHUB_ORG;
    if (!token || !org) return null;
    return new GitHubClient({
      token,
      org,
      baseUrl: process.env.GITHUB_API_URL || undefined,
    });
  }

  // get_context
  server.registerTool(
    "get_context",
    {
      title: "Get Context",
      description:
        "Return a markdown-formatted context bundle for a scope. Includes scope identity (name/path/type/status), attached modules, child paths, matching skills, and the last 10 changelog + decision records (title + first 200 chars + date). Points to list_records/get_record and get_skill for more. Requires viewer grant on the scope (or ancestor).",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path, e.g. 'airbuddy' or 'airbuddy/marketing'"),
      }),
    },
    async ({ scope }) => {
      try {
        const actor = ensurePrincipal();
        const sc = await getScope(db, scope);
        if (!sc) {
          return {
            content: [{ type: "text", text: `Scope not found: ${scope}` }],
            isError: true,
          };
        }

        // Access will be checked by downstream calls
        const mods = await listModules(db, scope, actor);
        const children = await getChildren(db, scope);
        const childPaths = children.map((c: any) => c.path).join("\n"); // eslint-disable-line @typescript-eslint/no-explicit-any

        // last 10 of changelog + decision
        const recentCh = await listRecords(db, { scopePath: scope, kind: "changelog", limit: 10 }, actor);
        const recentDec = await listRecords(db, { scopePath: scope, kind: "decision", limit: 10 }, actor);
        const combined = [...recentCh, ...recentDec]
          .sort((a: any, b: any) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0)) // eslint-disable-line @typescript-eslint/no-explicit-any
          .slice(0, 10);

        let recordsMd = "";
        for (const r of combined) {
          const bodyStart = (r.bodyMd || "").slice(0, 200).replace(/\n/g, " ");
          const date = formatDate(r.createdAt);
          recordsMd += `- [${r.kind}] ${r.title} (${date})\n  ${bodyStart}${ (r.bodyMd || "").length > 200 ? "..." : "" }\n`;
        }
        if (!recordsMd) recordsMd = "(no recent changelog/decision records)\n";
        const skillsMd = await skillsContextSection(db, scope);

        const moduleList = mods.length
          ? mods.map((m) => `- ${m.moduleType}`).join("\n")
          : "(none attached)";

        const md = `# Context for ${scope}

**Identity**
- name: ${sc.name}
- path: ${sc.path}
- type: ${sc.type}
- status: ${sc.status}

**Modules**
${moduleList}

**Children**
${childPaths || "(none)"}

**Recent changelog/decision records (last 10)**
${recordsMd}
Use list_records / get_record for full history and other kinds.

${skillsMd}
`;

        return { content: [{ type: "text", text: md }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_tree
  server.registerTool(
    "get_tree",
    {
      title: "Get Tree",
      description:
        "Return indented text tree of the subtree (default: root). Shows paths. Viewer access required on target scope.",
      inputSchema: z.object({
        scope: z
          .string()
          .optional()
          .describe("Optional scope path to root the tree from. Defaults to root scope."),
      }),
    },
    async ({ scope }) => {
      try {
        const actor = ensurePrincipal();
        const rootPath = scope || "";
        let targetPath = rootPath;
        if (!targetPath) {
          // find a root if exists
          // try common or query minimal
          const maybeRoot = await getScope(db, "root");
          if (maybeRoot) targetPath = "root";
          else {
            // fall back to first scope or empty
            targetPath = "";
          }
        }

        if (targetPath) {
          await requireAccess(db, actor, targetPath, "viewer");
        }

        const subtree = await getSubtree(db, targetPath);
        if (subtree.length === 0 && targetPath) {
          // may be no grant or not found, but getSubtree returns []
          // still return structure
        }

        // build indented
        let treeText = targetPath ? `${targetPath}\n` : "(root)\n";
        const indent = (path: string) => {
          const depth = path ? path.split("/").length - (targetPath ? targetPath.split("/").length : 0) : 0;
          return "  ".repeat(Math.max(0, depth));
        };
        for (const s of subtree) {
          if (s.path === targetPath) continue;
          treeText += `${indent(s.path)}- ${s.path} (${s.name}, ${s.type}, ${s.status})\n`;
        }

        return { content: [{ type: "text", text: treeText.trim() || "(empty tree)" }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // log_change
  server.registerTool(
    "log_change",
    {
      title: "Log Change",
      description: "Create a changelog record under the scope. Requires editor/agent grant. Returns created id.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Target scope path"),
        title: z.string().min(1).describe("Short title for the change"),
        body_md: z.string().describe("Markdown body of the changelog entry"),
        data: z.record(z.any()).optional().describe("Optional structured data (json)"),
      }),
    },
    async ({ scope, title, body_md, data }) => {
      try {
        const actor = ensurePrincipal();
        const rec = await createRecord(
          db,
          {
            scopePath: scope,
            kind: "changelog",
            title,
            bodyMd: body_md,
            data: data || {},
          },
          actor
        );
        return {
          content: [
            { type: "text", text: `Created changelog ${rec.id} under ${scope}\nTitle: ${title}` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // log_decision
  server.registerTool(
    "log_decision",
    {
      title: "Log Decision",
      description: "Create a decision record under the scope. Requires editor/agent grant. Returns created id.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Target scope path"),
        title: z.string().min(1).describe("Decision title / summary"),
        body_md: z.string().describe("Markdown body explaining the decision and rationale"),
        data: z.record(z.any()).optional().describe("Optional structured data (json)"),
      }),
    },
    async ({ scope, title, body_md, data }) => {
      try {
        const actor = ensurePrincipal();
        const rec = await createRecord(
          db,
          {
            scopePath: scope,
            kind: "decision",
            title,
            bodyMd: body_md,
            data: data || {},
          },
          actor
        );
        return {
          content: [
            { type: "text", text: `Created decision ${rec.id} under ${scope}\nTitle: ${title}` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // save_report
  server.registerTool(
    "save_report",
    {
      title: "Save Report",
      description: "Create a report record under the scope. Requires editor/agent grant. Returns created id.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Target scope path"),
        title: z.string().min(1).describe("Report title"),
        body_md: z.string().describe("Full markdown report body"),
        data: z.record(z.any()).optional().describe("Optional structured data (json)"),
      }),
    },
    async ({ scope, title, body_md, data }) => {
      try {
        const actor = ensurePrincipal();
        const rec = await createRecord(
          db,
          {
            scopePath: scope,
            kind: "report",
            title,
            bodyMd: body_md,
            data: data || {},
          },
          actor
        );
        return {
          content: [
            { type: "text", text: `Created report ${rec.id} under ${scope}\nTitle: ${title}` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // save_note
  server.registerTool(
    "save_note",
    {
      title: "Save Note",
      description: "Create a note record under the scope. Requires editor/agent grant. Returns created id.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Target scope path"),
        title: z.string().min(1).describe("Note title"),
        body_md: z.string().describe("Markdown note body"),
      }),
    },
    async ({ scope, title, body_md }) => {
      try {
        const actor = ensurePrincipal();
        const rec = await createRecord(
          db,
          {
            scopePath: scope,
            kind: "note",
            title,
            bodyMd: body_md,
          },
          actor
        );
        return {
          content: [
            { type: "text", text: `Created note ${rec.id} under ${scope}\nTitle: ${title}` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_records
  server.registerTool(
    "list_records",
    {
      title: "List Records",
      description:
        "List recent records for a scope. Compact: id, kind, title, created date. Optional kind filter, since (ISO date), limit (max 200). Viewer required.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        kind: z
          .enum(["changelog", "decision", "report", "note"])
          .optional()
          .describe("Optional filter by record kind"),
        since: z.string().optional().describe("Optional ISO date; only records on/after this"),
        limit: z.number().int().min(1).max(200).optional().describe("Max results, default 50 clamped to 200"),
      }),
    },
    async ({ scope, kind, since, limit }) => {
      try {
        const actor = ensurePrincipal();
        const sinceDate = since ? new Date(since) : undefined;
        const recs = await listRecords(
          db,
          { scopePath: scope, kind, since: sinceDate, limit },
          actor
        );
        const lines = recs.map((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
          const d = formatDate(r.createdAt);
          return `${r.id}\t${r.kind}\t${r.title}\t${d}`;
        });
        const header = "id\tkind\ttitle\tdate\n";
        return {
          content: [{ type: "text", text: header + (lines.join("\n") || "(no records)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_record
  server.registerTool(
    "get_record",
    {
      title: "Get Record",
      description: "Fetch a single full record by its id (uuid). Includes body_md and data. Viewer on owning scope required.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Record uuid"),
      }),
    },
    async ({ id }) => {
      try {
        const actor = ensurePrincipal();
        const rec = await getRecord(db, id, actor);
        if (!rec) {
          return {
            content: [{ type: "text", text: `Record not found: ${id}` }],
            isError: true,
          };
        }
        const md = `# ${rec.title}
id: ${rec.id}
kind: ${rec.kind}
scopeId: ${rec.scopeId}
author: ${rec.authorId}
created: ${formatDate(rec.createdAt)} updated: ${formatDate(rec.updatedAt)}

${rec.bodyMd || ""}

\`\`\`json
${JSON.stringify(rec.data || {}, null, 2)}
\`\`\`
`;
        return { content: [{ type: "text", text: md }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // create_task
  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description: "Create a task backed by Plane under the scope. Requires editor/agent. Returns id + sequence + url.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path e.g. 'airbuddy' or 'airbuddy/website'"),
        title: z.string().min(1).describe("Task title"),
        description: z.string().optional().describe("Optional markdown/plain description"),
        priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional().describe("Priority"),
        due_date: z.string().optional().describe("Target/due date as YYYY-MM-DD"),
      }),
    },
    async ({ scope, title, description, priority, due_date }) => {
      try {
        const actor = ensurePrincipal();
        if (!planeClient) {
          return {
            content: [{ type: "text", text: "tasks engine not configured" }],
            isError: true,
          };
        }
        const t = await createTask(
          db,
          planeClient,
          { scopePath: scope, title, description, priority, dueDate: due_date },
          actor
        );
        return {
          content: [{ type: "text", text: `Created task ${t.id} (seq ${t.sequenceId})\n${t.url}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // complete_task
  server.registerTool(
    "complete_task",
    {
      title: "Complete Task",
      description: "Transition a task/issue to completed state in its project. Optional note writes a changelog record. Editor/agent.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path of the task"),
        issue_id: z.string().min(1).describe("Plane work-item id to complete"),
        note: z.string().optional().describe("Optional completion note (written as changelog)"),
      }),
    },
    async ({ scope, issue_id, note }) => {
      try {
        const actor = ensurePrincipal();
        if (!planeClient) {
          return {
            content: [{ type: "text", text: "tasks engine not configured" }],
            isError: true,
          };
        }
        await completeTask(db, planeClient, { issueId: issue_id, scopePath: scope, note }, actor);
        return {
          content: [{ type: "text", text: `Completed task ${issue_id}${note ? " (note recorded)" : ""}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // update_task
  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description: "Partial update of task fields. Editor/agent required.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        issue_id: z.string().min(1).describe("Plane work-item id"),
        title: z.string().optional(),
        description: z.string().optional(),
        state: z.string().optional().describe("State id or name"),
        priority: z.string().optional(),
        due_date: z.string().optional(),
      }),
    },
    async ({ scope, issue_id, title, description, state, priority, due_date }) => {
      try {
        const actor = ensurePrincipal();
        if (!planeClient) {
          return {
            content: [{ type: "text", text: "tasks engine not configured" }],
            isError: true,
          };
        }
        await updateTask(
          db,
          planeClient,
          { issueId: issue_id, scopePath: scope, title, description, state, priority, dueDate: due_date },
          actor
        );
        return {
          content: [{ type: "text", text: `Updated task ${issue_id}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_tasks
  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List tasks for scope (label-filtered in Plane). state=open|completed|all. Viewer access.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        state: z.enum(["open", "completed", "all"]).optional().describe("Filter by state group"),
        limit: z.number().int().min(1).max(200).optional().describe("Max results"),
      }),
    },
    async ({ scope, state, limit }) => {
      try {
        const actor = ensurePrincipal();
        if (!planeClient) {
          return {
            content: [{ type: "text", text: "tasks engine not configured" }],
            isError: true,
          };
        }
        const items = await listTasks(db, planeClient, { scopePath: scope, state, limit }, actor);
        const header = "id\tseq\ttitle\tstate\tdue\n";
        const lines = items.map((t: { id: string; sequenceId: string | number; title: string; state?: string; dueDate?: string | null }) => `${t.id}\t${t.sequenceId}\t${t.title}\t${t.state || ""}\t${t.dueDate || ""}`);
        return {
          content: [{ type: "text", text: header + (lines.join("\n") || "(no tasks)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // provision_scope
  server.registerTool(
    "provision_scope",
    {
      title: "Provision Scope",
      description:
        "Admin-gated deterministic onboarding. Ensures scopes, module instances, optional agent token, Plane workspace adoption/webhook, and optional GitHub workbench skeleton. Returns JSON with step statuses and manual actions.",
      inputSchema: z.object({
        scopePath: z.string().min(1).describe("Target scope path, e.g. indya or indya/marketing/seo"),
        name: z.string().optional(),
        subprojects: z.array(z.object({
          slug: z.string().min(1),
          name: z.string().min(1),
        })).optional(),
        modules: z.array(z.string().min(1)).optional(),
        agent: z.object({
          name: z.string().min(1),
          tokenName: z.string().optional(),
        }).optional(),
        planeWorkspaceSlug: z.string().optional(),
        workbench: z.object({
          repo: z.string().optional(),
        }).optional(),
      }),
    },
    async (input) => {
      try {
        const actor = ensurePrincipal();
        if (!planeClient) {
          return {
            content: [{ type: "text", text: "tasks engine not configured" }],
            isError: true,
          };
        }
        const result = await provisionScope(
          db,
          { plane: planeClient, github: githubClient },
          {
            scopePath: input.scopePath,
            name: input.name,
            subprojects: input.subprojects,
            modules: input.modules,
            agent: input.agent,
            planeWorkspaceSlug: input.planeWorkspaceSlug,
            workbench: input.workbench,
          },
          actor
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // register_capability
  server.registerTool(
    "register_capability",
    {
      title: "Register Capability",
      description:
        "Register or update an automation/capability for a scope. Idempotent by scope + name. Requires admin on the scope.",
      inputSchema: z.object({
        scopePath: z.string().min(1).describe("Scope path, e.g. indya/marketing"),
        name: z.string().min(1).describe("Capability name unique within the scope"),
        engine: z.string().min(1).describe("Engine identifier such as n8n, flowise, or custom"),
        engineRef: z.string().optional().describe("Optional engine-side id or deep-link URL"),
        tokenId: z.string().optional().describe("Optional scoped token id used by the capability"),
        description: z.string().optional(),
        status: z.enum(["active", "disabled"]).optional(),
      }),
    },
    async (input) => {
      try {
        const actor = ensurePrincipal();
        const result = await registerCapability(db, input, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // report_run
  server.registerTool(
    "report_run",
    {
      title: "Report Run",
      description:
        "Persist a run status for a registered capability. Idempotent by runRef when provided. Requires editor/agent on the scope.",
      inputSchema: z.object({
        scopePath: z.string().min(1).describe("Scope path"),
        name: z.string().min(1).describe("Registered capability name"),
        status: z.enum(["running", "success", "error"]),
        runRef: z.string().optional().describe("Optional engine-side run id for idempotent updates"),
        summary: z.string().optional(),
        startedAt: z.string().optional(),
        finishedAt: z.string().optional(),
        durationMs: z.number().int().optional(),
        payload: z.record(z.any()).optional(),
        alert: z.object({
          severity: z.enum(["info", "warning", "critical"]),
          message: z.string().min(1),
          metric: z.string().optional(),
          value: z.number().optional(),
          threshold: z.number().optional(),
        }).optional(),
      }),
    },
    async (input) => {
      try {
        const actor = ensurePrincipal();
        const result = await reportRun(db, input, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_alerts
  server.registerTool(
    "list_alerts",
    {
      title: "List Alerts",
      description: "List alert.fired events for one exact scope, newest first. Viewer required. Limit defaults to 20 and caps at 100.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Exact scope path"),
        severity: z.enum(["info", "warning", "critical"]).optional(),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async ({ scope, severity, since, limit }) => {
      try {
        const actor = ensurePrincipal();
        const result = await listAlerts(db, { scopePath: scope, severity, since, limit }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_capabilities
  server.registerTool(
    "list_capabilities",
    {
      title: "List Capabilities",
      description: "List registered capabilities for a scope with each capability's latest run. Viewer required.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
      }),
    },
    async ({ scope }) => {
      try {
        const actor = ensurePrincipal();
        const result = await listCapabilities(db, { scopePath: scope }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_capability_runs
  server.registerTool(
    "list_capability_runs",
    {
      title: "List Capability Runs",
      description: "List newest runs for a registered capability. Viewer required. Limit defaults to 50 and caps at 200.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        name: z.string().min(1).describe("Registered capability name"),
        since: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async ({ scope, name, since, limit }) => {
      try {
        const actor = ensurePrincipal();
        const result = await listCapabilityRuns(db, { scopePath: scope, name, since, limit }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // sync_skills
  server.registerTool(
    "sync_skills",
    {
      title: "Sync Skills",
      description:
        "Refresh the cached skills index from the central GitHub skills repo. Requires admin on the root scope. Uses SKILLS_REPO plus GitHub env configuration.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const actor = ensurePrincipal();
        const repo = process.env.SKILLS_REPO;
        if (!repo) {
          throw new Error("SKILLS_REPO environment variable is required for sync_skills");
        }
        if (!githubClient) {
          throw new Error("GitHub client not configured: set GITHUB_TOKEN and GITHUB_ORG");
        }
        const result = await syncSkills(db, githubClient, { repo }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_skills
  server.registerTool(
    "list_skills",
    {
      title: "List Skills",
      description: "List matching cached skills for a scope. Optional domain filter. Viewer required on the scope.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        domain: z.string().optional().describe("Optional informational domain tag filter"),
      }),
    },
    async ({ scope, domain }) => {
      try {
        const actor = ensurePrincipal();
        const result = await listSkills(db, { scope, domain }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_skill
  server.registerTool(
    "get_skill",
    {
      title: "Get Skill",
      description: "Fetch one cached skill by name, including the full SKILL.md body. Requires any valid principal.",
      inputSchema: z.object({
        name: z.string().min(1).describe("Skill name"),
      }),
    },
    async ({ name }) => {
      try {
        const actor = ensurePrincipal();
        const result = await getSkill(db, { name }, actor);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // write_metrics
  server.registerTool(
    "write_metrics",
    {
      title: "Write Metrics",
      description: "Batch write (upsert) metric points for a scope. points: array of {metric, date(YYYY-MM-DD), value, dims?}. Max 1000. Editor/agent required. Idempotent on (scope,metric,date,dims).",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        points: z.array(
          z.object({
            metric: z.string().min(1),
            date: z.string().min(1).describe("YYYY-MM-DD"),
            value: z.union([z.number(), z.string()]),
            dims: z.record(z.any()).optional(),
          })
        ).min(1).max(1000),
      }),
    },
    async ({ scope, points }) => {
      try {
        const actor = ensurePrincipal();
        const res = await writeMetrics(db, { scopePath: scope, points: points as any }, actor); // eslint-disable-line @typescript-eslint/no-explicit-any
        return {
          content: [{ type: "text", text: `Wrote ${res.written} points for metrics: ${res.metrics.join(", ")}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // query_metrics
  server.registerTool(
    "query_metrics",
    {
      title: "Query Metrics",
      description: "Query metric series. Returns compact [{metric, dim?, points: [[date, val]]}]. groupBy=date|metric|<dimKey>. filters: dims exact match. agg=sum|avg|min|max default sum. Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1),
        metrics: z.array(z.string().min(1)).min(1),
        from: z.string().min(1).describe("YYYY-MM-DD inclusive"),
        to: z.string().min(1).describe("YYYY-MM-DD inclusive"),
        groupBy: z.string().optional().describe("date | metric | dimKey e.g. campaign"),
        filters: z.record(z.string()).optional(),
        agg: z.enum(["sum", "avg", "min", "max"]).optional(),
      }),
    },
    async ({ scope, metrics: mNames, from, to, groupBy, filters, agg }) => {
      try {
        const actor = ensurePrincipal();
        const series = await queryMetrics(db, {
          scopePath: scope,
          metrics: mNames,
          from,
          to,
          groupBy,
          filters,
          agg,
        }, actor);
        // compact text output for agent consumption
        const lines: string[] = [];
        for (const s of series) {
          const dimStr = s.dim ? ` (${s.dim})` : "";
          const pts = s.points.map((p) => `${p[0]}=${p[1]}`).join(" ");
          lines.push(`${s.metric}${dimStr}: ${pts}`);
        }
        return {
          content: [{ type: "text", text: lines.join("\n") || "(no data)" }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_metric_names
  server.registerTool(
    "list_metric_names",
    {
      title: "List Metric Names",
      description: "List distinct metric names for scope with first/last observed dates. Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
      }),
    },
    async ({ scope }) => {
      try {
        const actor = ensurePrincipal();
        const names = await listMetricNames(db, { scopePath: scope }, actor);
        const lines = names.map((n: { metric?: string; firstDate?: string | null; lastDate?: string | null }) => `${n.metric || ""}\t${n.firstDate || ""}\t${n.lastDate || ""}`);
        return {
          content: [{ type: "text", text: "metric\tfirst\tlast\n" + (lines.join("\n") || "(none)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // save_dashboard
  server.registerTool(
    "save_dashboard",
    {
      title: "Save Dashboard",
      description: "Save or update a dashboard spec for a scope (name defaults to 'main'). Spec must be valid per v1 contract (see list_widget_types). Requires editor/agent. Appends revision (prunes to last 50). Returns saved id.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        name: z.string().optional().describe("Dashboard name, default 'main'"),
        spec: z.record(z.any()).describe("Dashboard spec object: {version:1, title, range:{default:'7d'|'30d'|'90d'}, widgets: [...] }"),
      }),
    },
    async ({ scope, name, spec }) => {
      try {
        const actor = ensurePrincipal();
        const saved = await saveDashboard(db, { scopePath: scope, name, spec }, actor);
        return {
          content: [{ type: "text", text: `Saved dashboard ${saved.id} (name: ${saved.name}) under ${scope}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_dashboard
  server.registerTool(
    "get_dashboard",
    {
      title: "Get Dashboard",
      description: "Fetch current dashboard spec by scope + optional name (default 'main'). Viewer access.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        name: z.string().optional().describe("Dashboard name, default 'main'"),
      }),
    },
    async ({ scope, name }) => {
      try {
        const actor = ensurePrincipal();
        const dash = await getDashboard(db, { scopePath: scope, name }, actor);
        if (!dash) {
          return {
            content: [{ type: "text", text: `Dashboard not found for ${scope} ${name || "main"}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ id: dash.id, name: dash.name, spec: dash.spec, updatedAt: dash.updatedAt }, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_dashboards
  server.registerTool(
    "list_dashboards",
    {
      title: "List Dashboards",
      description: "List all dashboards for a scope. Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
      }),
    },
    async ({ scope }) => {
      try {
        const actor = ensurePrincipal();
        const list = await listDashboards(db, { scopePath: scope }, actor);
        const lines = list.map((d: { id: string; name: string; updatedAt?: Date | string | null }) => `${d.id}\t${d.name}\t${d.updatedAt ? new Date(d.updatedAt).toISOString() : ""}`);
        return {
          content: [{ type: "text", text: "id\tname\tupdated\n" + (lines.join("\n") || "(none)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_widget_types
  server.registerTool(
    "list_widget_types",
    {
      title: "List Widget Types",
      description: "Return the widget vocabulary: types, required fields, constraints, and example widgets for each. Use before authoring specs for save_dashboard. No auth required (discovery).",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const vocab = getWidgetVocabulary();
        return {
          content: [{ type: "text", text: JSON.stringify(vocab, null, 2) }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // revert_dashboard
  server.registerTool(
    "revert_dashboard",
    {
      title: "Revert Dashboard",
      description: "Revert dashboard to a previous revision id (from list_revisions or prior saves). Requires editor/agent. Creates new head + revision entry, emits reverted.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        name: z.string().optional().describe("Dashboard name, default 'main'"),
        revision_id: z.string().min(1).describe("Revision uuid to restore as current spec"),
      }),
    },
    async ({ scope, name, revision_id }) => {
      try {
        const actor = ensurePrincipal();
        const restored = await revertDashboard(db, { scopePath: scope, name, revisionId: revision_id }, actor);
        return {
          content: [{ type: "text", text: `Reverted dashboard ${restored.id} (name: ${restored.name}) to revision ${revision_id}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // save_doc
  server.registerTool(
    "save_doc",
    {
      title: "Save Doc",
      description: "Save or update a document (markdown body). Slug optional (defaults to slugified title with -2 suffix on collision for auto). Requires editor/agent. Appends revision (prunes to 50).",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().optional().describe("Optional explicit slug [a-z0-9-]+ ; if omitted, derived from title"),
        title: z.string().min(1).describe("Document title"),
        body_md: z.string().describe("Markdown body (canonical)"),
      }),
    },
    async ({ scope, slug, title, body_md }) => {
      try {
        const actor = ensurePrincipal();
        const saved = await saveDoc(db, { scopePath: scope, slug, title, bodyMd: body_md }, actor);
        return {
          content: [{ type: "text", text: `Saved doc ${saved.id} (slug: ${saved.slug}) under ${scope}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_doc
  server.registerTool(
    "get_doc",
    {
      title: "Get Doc",
      description: "Fetch a document by scope + slug. Returns full title + body_md. Viewer required. (archived docs are fetchable).",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().min(1).describe("Document slug"),
      }),
    },
    async ({ scope, slug }) => {
      try {
        const actor = ensurePrincipal();
        const doc = await getDoc(db, { scopePath: scope, slug }, actor);
        if (!doc) {
          return {
            content: [{ type: "text", text: `Document not found: ${slug} in ${scope}` }],
            isError: true,
          };
        }
        const md = `# ${doc.title}\nslug: ${doc.slug}\nid: ${doc.id}\nupdated: ${doc.updatedAt ? new Date(doc.updatedAt).toISOString() : ""}\n\n${doc.bodyMd || ""}\n`;
        return { content: [{ type: "text", text: md }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_docs
  server.registerTool(
    "list_docs",
    {
      title: "List Docs",
      description: "List documents for scope (excludes archived by default). Compact: id, slug, title, updated. Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        include_archived: z.boolean().optional().describe("Include archived documents"),
      }),
    },
    async ({ scope, include_archived }) => {
      try {
        const actor = ensurePrincipal();
        const list = await listDocs(db, { scopePath: scope, includeArchived: !!include_archived }, actor);
        const lines = list.map((d: { id: string; slug: string; title: string; updatedAt?: Date | string | null }) => `${d.id}\t${d.slug}\t${d.title}\t${d.updatedAt ? new Date(d.updatedAt).toISOString() : ""}`);
        return {
          content: [{ type: "text", text: "id\tslug\ttitle\tupdated\n" + (lines.join("\n") || "(none)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_revisions (doc)
  server.registerTool(
    "list_doc_revisions",
    {
      title: "List Doc Revisions",
      description: "List recent revisions for a document (most recent first). Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().min(1).describe("Document slug"),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    async ({ scope, slug, limit }) => {
      try {
        const actor = ensurePrincipal();
        const revs = await listDocRevisions(db, { scopePath: scope, slug, limit }, actor);
        const lines = revs.map((r: { id: string; title: string; createdAt?: Date | string | null }) => `${r.id}\t${r.title}\t${r.createdAt ? new Date(r.createdAt).toISOString() : ""}`);
        return {
          content: [{ type: "text", text: "id\ttitle\tcreated\n" + (lines.join("\n") || "(none)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // revert_doc
  server.registerTool(
    "revert_doc",
    {
      title: "Revert Doc",
      description: "Revert a document to a prior revision id. Requires editor/agent. Appends restored content as new revision.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().min(1).describe("Document slug"),
        revision_id: z.string().min(1).describe("Revision id to restore"),
      }),
    },
    async ({ scope, slug, revision_id }) => {
      try {
        const actor = ensurePrincipal();
        const restored = await revertDoc(db, { scopePath: scope, slug, revisionId: revision_id }, actor);
        return {
          content: [{ type: "text", text: `Reverted doc ${restored.id} (slug: ${restored.slug}) to revision ${revision_id}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // save_canvas
  server.registerTool(
    "save_canvas",
    {
      title: "Save Canvas",
      description: "Save or update an Excalidraw canvas scene (JSON). Slug optional (auto from name). Requires editor/agent. Enforces 2MB size cap. Emits canvas.saved.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().optional().describe("Optional slug [a-z0-9-]; if omitted derived from name"),
        name: z.string().min(1).describe("Canvas name"),
        scene: z.record(z.any()).describe("Excalidraw serialized scene {elements, appState, files?}"),
      }),
    },
    async ({ scope, slug, name, scene }) => {
      try {
        const actor = ensurePrincipal();
        const saved = await saveCanvas(db, { scopePath: scope, slug, name, scene }, actor);
        return {
          content: [{ type: "text", text: `Saved canvas ${saved.id} (slug: ${saved.slug}) under ${scope}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // get_canvas
  server.registerTool(
    "get_canvas",
    {
      title: "Get Canvas",
      description: "Fetch canvas by scope + slug. Returns name + full scene JSON. Viewer required.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        slug: z.string().min(1).describe("Canvas slug"),
      }),
    },
    async ({ scope, slug }) => {
      try {
        const actor = ensurePrincipal();
        const cv = await getCanvas(db, { scopePath: scope, slug }, actor);
        if (!cv) {
          return {
            content: [{ type: "text", text: `Canvas not found: ${slug} in ${scope}` }],
            isError: true,
          };
        }
        const text = `# Canvas ${cv.name}\nslug: ${cv.slug}\nid: ${cv.id}\nupdated: ${cv.updatedAt ? new Date(cv.updatedAt).toISOString() : ""}\n\n${JSON.stringify(cv.scene || {}, null, 2)}\n`;
        return { content: [{ type: "text", text }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  // list_canvases
  server.registerTool(
    "list_canvases",
    {
      title: "List Canvases",
      description: "List canvases for scope (excludes archived by default). Compact id,slug,name,updated. Viewer.",
      inputSchema: z.object({
        scope: z.string().min(1).describe("Scope path"),
        include_archived: z.boolean().optional().describe("Include archived canvases"),
      }),
    },
    async ({ scope, include_archived }) => {
      try {
        const actor = ensurePrincipal();
        const list = await listCanvases(db, { scopePath: scope, includeArchived: !!include_archived }, actor);
        const lines = list.map((c: { id: string; slug: string; name: string; updatedAt?: Date | string | null }) => `${c.id}\t${c.slug}\t${c.name}\t${c.updatedAt ? new Date(c.updatedAt).toISOString() : ""}`);
        return {
          content: [{ type: "text", text: "id\tslug\tname\tupdated\n" + (lines.join("\n") || "(none)") }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Error: ${formatError(e)}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
