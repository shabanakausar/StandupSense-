/**
 * scripts/testFetchers.ts
 *
 * Manual integration test for the Notion and GitHub fetchers.
 * Calls both fetchers and prints the normalized NormalizedActivity[] output.
 *
 * Usage:
 *   # Live APIs (requires .env.local to be configured):
 *   npx ts-node --project tsconfig.json scripts/testFetchers.ts
 *
 *   # Offline (loads demo fixture instead of calling APIs):
 *   DEMO_MODE=true npx ts-node --project tsconfig.json scripts/testFetchers.ts
 */

import * as path from "path";
import * as fs from "fs";

// ─── Load .env.local manually (no dotenv dependency) ─────────────────────────

const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ─── DEMO_MODE: load fixture directly ────────────────────────────────────────

if (process.env.DEMO_MODE === "true") {
  const fixturePath = path.join(__dirname, "..", "cache", "demo-fixture.json");
  if (!fs.existsSync(fixturePath)) {
    console.error("DEMO_MODE is set but cache/demo-fixture.json does not exist.");
    process.exit(1);
  }
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8"));
  console.log("=== DEMO FIXTURE (not live data) ===");
  console.log(JSON.stringify(fixture.activities, null, 2));
  console.log(`\nTotal items: ${fixture.activities.length}`);
  process.exit(0);
}

// ─── Live mode ────────────────────────────────────────────────────────────────

async function main() {
  const { fetchNotionActivities } = await import("../src/lib/fetchers/notionFetcher");
  const { fetchGithubActivities } = await import("../src/lib/fetchers/githubFetcher");

  console.log("=== Testing Notion Fetcher ===");
  let notionActivities: unknown[] = [];
  try {
    notionActivities = await fetchNotionActivities();
    console.log(`✓ Notion: ${notionActivities.length} item(s)`);
    console.log(JSON.stringify(notionActivities, null, 2));
  } catch (err) {
    console.error("✗ Notion fetcher failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n=== Testing GitHub Fetcher ===");
  let githubActivities: unknown[] = [];
  try {
    githubActivities = await fetchGithubActivities();
    console.log(`✓ GitHub: ${githubActivities.length} item(s)`);
    console.log(JSON.stringify(githubActivities, null, 2));
  } catch (err) {
    console.error("✗ GitHub fetcher failed:", err instanceof Error ? err.message : err);
  }

  const combined = [...notionActivities, ...githubActivities];
  console.log(`\n=== Combined: ${combined.length} total ===`);

  const required = ["id","source","kind","title","status","url","lastUpdatedAt","openQuestions","dependsOn"];
  let errs = 0;
  for (const item of combined) {
    const obj = item as Record<string, unknown>;
    for (const f of required) {
      if (!(f in obj)) { console.error(`  ✗ "${obj.id}" missing: ${f}`); errs++; }
    }
  }
  if (errs === 0) console.log(`  ✓ All ${combined.length} items pass shape check`);
}

main().catch((err) => { console.error(err); process.exit(1); });
