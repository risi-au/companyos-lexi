import { z } from "zod";

// The spec format (v1) — fixed contract per M2-02 brief. Do not extend here.
export const WidgetTypeSchema = z.enum([
  "metric-card",
  "timeseries",
  "bar",
  "table",
  "tasks",
  "records",
  "text",
]);

export const GridSchema = z.object({
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(8),
});

export const QuerySchema = z.object({
  metrics: z.array(z.string().min(1)),
  agg: z.enum(["sum", "avg", "min", "max"]).optional(),
  groupBy: z.string().optional(),
  filters: z.record(z.string()).optional(),
  compare: z.literal("prev_period").optional(),
});

export const WidgetSchema = z
  .object({
    id: z.string().min(1),
    type: WidgetTypeSchema,
    title: z.string().optional(),
    grid: GridSchema,
    query: QuerySchema.optional(),
    options: z.record(z.unknown()).optional(),
  })
  .superRefine((widget, ctx) => {
    const dataTypes = ["metric-card", "timeseries", "bar", "table"] as const;
    if (dataTypes.includes(widget.type as "metric-card" | "timeseries" | "bar" | "table")) {
      if (!widget.query) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["query"],
          message: `query is required for data widget type "${widget.type}"`,
        });
      }
    }
    if (widget.type === "text") {
      const md = (widget.options as Record<string, unknown> | undefined)?.markdown;
      if (typeof md !== "string" || md.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options", "markdown"],
          message: "options.markdown (non-empty string) is required for text widget",
        });
      }
    }
  });

export const DashboardSpecSchema = z
  .object({
    version: z.literal(1),
    title: z.string(),
    range: z.object({
      default: z.enum(["7d", "30d", "90d"]),
    }),
    widgets: z.array(WidgetSchema).max(24, "widgets must not exceed 24"),
  })
  .superRefine((spec, ctx) => {
    // duplicate widget ids check
    const ids = new Set<string>();
    for (let i = 0; i < spec.widgets.length; i++) {
      const w = spec.widgets[i]!;
      if (ids.has(w.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["widgets", i, "id"],
          message: `duplicate widget id: ${w.id}`,
        });
      }
      ids.add(w.id);
    }
  });

export type DashboardSpec = z.infer<typeof DashboardSpecSchema>;
export type Widget = z.infer<typeof WidgetSchema>;

// Validation result for service use: returns typed errors list on failure.
export interface ValidationError {
  path: (string | number)[];
  message: string;
}

export function validateDashboardSpec(input: unknown): { success: true; spec: DashboardSpec } | { success: false; errors: ValidationError[] } {
  const result = DashboardSpecSchema.safeParse(input);
  if (result.success) {
    return { success: true, spec: result.data };
  }
  const errors: ValidationError[] = result.error.issues.map((iss) => ({
    path: iss.path,
    message: iss.message,
  }));
  return { success: false, errors };
}

// Small static vocabulary for agents (list_widget_types)
export function getWidgetVocabulary() {
  return {
    version: 1,
    types: [
      {
        type: "metric-card",
        description: "Single metric value with optional previous period comparison.",
        requiresQuery: true,
        queryFields: ["metrics", "agg?", "compare?"],
        options: {},
        example: {
          id: "spend",
          type: "metric-card",
          title: "Total Spend",
          grid: { x: 0, y: 0, w: 3, h: 2 },
          query: { metrics: ["meta.spend"], agg: "sum", compare: "prev_period" },
        },
      },
      {
        type: "timeseries",
        description: "Line/area chart over time for one or more metrics.",
        requiresQuery: true,
        queryFields: ["metrics", "agg?", "groupBy?"],
        options: { showLegend: "boolean?" },
        example: {
          id: "spend-over-time",
          type: "timeseries",
          title: "Spend Trend",
          grid: { x: 0, y: 2, w: 6, h: 4 },
          query: { metrics: ["meta.spend"], agg: "sum", groupBy: "date" },
        },
      },
      {
        type: "bar",
        description: "Bar chart, e.g. by dimension.",
        requiresQuery: true,
        queryFields: ["metrics", "agg?", "groupBy?"],
        options: {},
        example: {
          id: "spend-by-campaign",
          type: "bar",
          title: "Spend by Campaign",
          grid: { x: 6, y: 2, w: 6, h: 4 },
          query: { metrics: ["meta.spend"], groupBy: "campaign" },
        },
      },
      {
        type: "table",
        description: "Tabular data from query (top rows).",
        requiresQuery: true,
        queryFields: ["metrics", "agg?", "groupBy?", "filters?"],
        options: { limit: "number?" },
        example: {
          id: "recent",
          type: "table",
          title: "Top Campaigns",
          grid: { x: 0, y: 6, w: 12, h: 3 },
          query: { metrics: ["meta.spend", "meta.clicks"], agg: "sum", groupBy: "campaign" },
        },
      },
      {
        type: "tasks",
        description: "Task list widget (open/completed).",
        requiresQuery: false,
        queryFields: [],
        options: { state: '"open"|"completed"|"all"?', limit: "number?" },
        example: {
          id: "open-tasks",
          type: "tasks",
          title: "Open Tasks",
          grid: { x: 0, y: 0, w: 6, h: 4 },
          options: { state: "open", limit: 10 },
        },
      },
      {
        type: "records",
        description: "Recent records of specific kinds.",
        requiresQuery: false,
        queryFields: [],
        options: { kinds: '("changelog"|"decision"|"report"|"note")[]?', limit: "number?" },
        example: {
          id: "recent-notes",
          type: "records",
          title: "Recent Notes",
          grid: { x: 6, y: 0, w: 6, h: 4 },
          options: { kinds: ["note", "decision"], limit: 5 },
        },
      },
      {
        type: "text",
        description: "Static markdown text block.",
        requiresQuery: false,
        queryFields: [],
        options: { markdown: "string (required)" },
        example: {
          id: "overview",
          type: "text",
          title: "Overview",
          grid: { x: 0, y: 9, w: 12, h: 2 },
          options: { markdown: "## AirBuddy\nKey metrics and notes." },
        },
      },
    ],
    constraints: {
      maxWidgets: 24,
      grid: "12-col, x:0-11, y>=0, w:1-12, h:1-8",
      uniqueIds: true,
      dataWidgetsNeedQuery: true,
      textNeedsMarkdownInOptions: true,
    },
  };
}
