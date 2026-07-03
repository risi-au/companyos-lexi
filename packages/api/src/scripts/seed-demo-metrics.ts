import { config as loadEnv } from "dotenv";
import { pathToFileURL } from "url";
loadEnv({ path: ["../../.env", ".env"], quiet: true });
import { createDb } from "@companyos/db";
import { scopes, principals, grants } from "@companyos/db";
import { eq, and } from "drizzle-orm";
// DB type avoided at top to prevent static resolution/cycle in db package build; use any for script boundary.

const SCOPE_PATH = "airbuddy";
const SEED_PRINCIPAL_NAME = "Demo Seeder";

function seededRandom(seed: string): number {
  // Simple deterministic hash-based pseudo random [0,1)
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  // fold to [0,1)
  return (h >>> 0) / 4294967296;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface GenerateDemoOptions {
  db: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  scopePath?: string;
  principalId?: string; // if provided, use directly (for test PGlite)
  days?: number;
  endDate?: Date;
}

export async function generateDemoMetrics(options: GenerateDemoOptions): Promise<{ written: number }> {
  const {
    db,
    scopePath = SCOPE_PATH,
    principalId: providedPrincipal,
    days = 90,
    endDate = new Date(),
  } = options;

  // dynamic to avoid package cycle between db and api for scripts/tests
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { writeMetrics } = (await import("../modules/metrics/service")) as any;

  let actorPrincipalId = providedPrincipal;

  if (!actorPrincipalId) {
    // ensure scope
    let [scope] = await db
      .select()
      .from(scopes)
      .where(eq(scopes.path, scopePath))
      .limit(1);

    if (!scope) {
      [scope] = await db
        .insert(scopes)
        .values({
          slug: scopePath,
          path: scopePath,
          name: "AirBuddy",
          type: "project",
          status: "active",
          settings: {},
        })
        .returning();
    }
    if (!scope) throw new Error("Failed to ensure airbuddy scope");

    // ensure principal
    let [principal] = await db
      .select()
      .from(principals)
      .where(eq(principals.name, SEED_PRINCIPAL_NAME))
      .limit(1);

    if (!principal) {
      [principal] = await db
        .insert(principals)
        .values({
          kind: "human",
          name: SEED_PRINCIPAL_NAME,
          status: "active",
        })
        .returning();
    }
    if (!principal) throw new Error("Failed to ensure seeder principal");

    // ensure owner grant
    const [existingGrant] = await db
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.principalId, principal.id),
          eq(grants.scopeId, scope.id)
        )
      )
      .limit(1);

    if (!existingGrant) {
      await db.insert(grants).values({
        principalId: principal.id,
        scopeId: scope.id,
        role: "owner",
      });
    }

    actorPrincipalId = principal.id;
  }

  if (!actorPrincipalId) throw new Error("No actor principal for demo seed");

  // build 90 days ending endDate
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  const points: Array<{ metric: string; date: string; value: number | string; dims?: Record<string, string | number | boolean | null> }> = [];

  const campaigns = ["prospecting", "retargeting"];
  const countries = ["AU", "NZ"];

  for (let i = 0; i < days; i++) {
    const d = addDays(end, - (days - 1 - i));
    const ds = dateStr(d);
    const dow = d.getUTCDay(); // 0 sun ... 6 sat ; weekend lower
    const weekFactor = 1 + 0.1 * Math.sin((i / 7) * Math.PI * 2); // weekly seasonality approx
    const trend = 1 + (i / days) * 0.25; // mild upward 25% over period

    // meta spend/impr/clicks with dims
    for (const camp of campaigns) {
      for (const ctry of countries) {
        const baseSeed = `${ds}-${camp}-${ctry}`;
        // spend ~ 80-180 base * factors
        let spend = 120 * (0.7 + seededRandom(baseSeed + "-spend") * 0.8) * weekFactor * trend;
        if (dow === 0 || dow === 6) spend *= 0.6;
        points.push({ metric: "meta.spend", date: ds, value: Math.round(spend * 100) / 100, dims: { campaign: camp, country: ctry } as Record<string, string | number | boolean | null> });

        let impr = 8000 * (0.6 + seededRandom(baseSeed + "-impr") * 0.9) * weekFactor * trend;
        if (dow === 0 || dow === 6) impr *= 0.55;
        points.push({ metric: "meta.impressions", date: ds, value: Math.round(impr), dims: { campaign: camp, country: ctry } as Record<string, string | number | boolean | null> });

        let clicks = impr * (0.015 + seededRandom(baseSeed + "-click") * 0.02);
        if (dow === 0 || dow === 6) clicks *= 0.7;
        points.push({ metric: "meta.clicks", date: ds, value: Math.round(clicks), dims: { campaign: camp, country: ctry } as Record<string, string | number | boolean | null> });
      }
    }

    // google spend (no dims for simplicity)
    const gSeed = `${ds}-google`;
    let gSpend = 60 * (0.6 + seededRandom(gSeed) * 1.0) * weekFactor * trend;
    if (dow === 0 || dow === 6) gSpend *= 0.65;
    points.push({ metric: "google.spend", date: ds, value: Math.round(gSpend * 100) / 100, dims: {} as Record<string, string | number | boolean | null> });

    // ga4 sessions
    const gaSeed = `${ds}-ga4`;
    let sessions = 420 * (0.75 + seededRandom(gaSeed) * 0.7) * weekFactor * trend;
    if (dow === 0 || dow === 6) sessions *= 0.6;
    points.push({ metric: "ga4.sessions", date: ds, value: Math.round(sessions), dims: {} as Record<string, string | number | boolean | null> });

    // woo
    const wSeed = `${ds}-woo`;
    let revenue = 1850 * (0.5 + seededRandom(wSeed + "rev") * 1.2) * weekFactor * trend;
    if (dow === 0 || dow === 6) revenue *= 0.75;
    points.push({ metric: "woo.revenue", date: ds, value: Math.round(revenue * 100) / 100, dims: {} as Record<string, string | number | boolean | null> });

    let orders = Math.max(3, Math.round(revenue / 95 * (0.85 + seededRandom(wSeed + "ord") * 0.3)));
    if (dow === 0 || dow === 6) orders = Math.max(1, Math.floor(orders * 0.6));
    points.push({ metric: "woo.orders", date: ds, value: orders, dims: {} as Record<string, string | number | boolean | null> });
  }

  // writeMetrics caps at 1000 points per call — write in chunks
  let written = 0;
  for (let i = 0; i < points.length; i += 1000) {
    const chunk = points.slice(i, i + 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeMetrics(db, { scopePath, points: chunk as any[] }, actorPrincipalId);
    written += chunk.length;
  }
  return { written };
}

async function main() {
  const db = createDb();

  const res = await generateDemoMetrics({ db });

  console.log(`Seed demo metrics complete for ${SCOPE_PATH}. Wrote ${res.written} points`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
