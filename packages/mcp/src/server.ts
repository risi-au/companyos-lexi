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
  PlaneClient,
  type DB,
  AccessDeniedError,
  ScopeNotFoundError,
  RecordNotFoundError,
} from "@companyos/api";

export interface CreateServerOptions {
  db: DB;
  principalId: string | null;
  planeClient?: PlaneClient | null;
}

function formatError(e: unknown): string {
  if (e instanceof AccessDeniedError) {
    return `Access denied: requires ${e.requiredRole} on ${e.scopePath}`;
  }
  if (e instanceof ScopeNotFoundError) {
    return `Scope not found: ${e.path}`;
  }
  if (e instanceof RecordNotFoundError) {
    return `Record not found: ${e.id}`;
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

  // get_context
  server.registerTool(
    "get_context",
    {
      title: "Get Context",
      description:
        "Return a markdown-formatted context bundle for a scope. Includes scope identity (name/path/type/status), attached modules, child paths, and the last 10 changelog + decision records (title + first 200 chars + date). Points to list_records/get_record for more. Requires viewer grant on the scope (or ancestor).",
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

  return server;
}
