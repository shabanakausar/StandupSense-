import { RunnableSequence, RunnableLambda } from "@langchain/core/runnables";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { fetchNotionActivities } from "@/lib/fetchers/notionFetcher";
import { fetchGithubActivities } from "@/lib/fetchers/githubFetcher";
import { detectBlockers } from "@/lib/blockerDetector";
import { generateNarrative } from "@/lib/graniteClient";
import type { BriefOutput, NormalizedActivity } from "@/types";

// ─── Types for chain state ────────────────────────────────────────────────────

interface ChainInput {
  standupNotes: string;
}

interface WithActivities extends ChainInput {
  activities: NormalizedActivity[];
  fetchErrors: string[];
  sourceCounts: { notion: number; github: number };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

const CACHE_DIR = join(process.cwd(), "cache");
const LAST_RUN_PATH = join(CACHE_DIR, "last-run.json");
const DEMO_FIXTURE_PATH = join(CACHE_DIR, "demo-fixture.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  timestamp: number;
  activities: NormalizedActivity[];
}

function readCache(): NormalizedActivity[] | null {
  if (!existsSync(LAST_RUN_PATH)) return null;
  try {
    const raw = readFileSync(LAST_RUN_PATH, "utf-8");
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null; // stale
    return entry.activities;
  } catch {
    return null;
  }
}

function writeCache(activities: NormalizedActivity[]): void {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    const entry: CacheEntry = { timestamp: Date.now(), activities };
    writeFileSync(LAST_RUN_PATH, JSON.stringify(entry, null, 2), "utf-8");
  } catch (err) {
    console.warn("[chain] Could not write activity cache:", err);
  }
}

function loadDemoFixture(): NormalizedActivity[] {
  if (!existsSync(DEMO_FIXTURE_PATH)) {
    throw new Error(
      "DEMO_MODE is enabled but cache/demo-fixture.json does not exist. " +
        "Run Sub-Task 8 to generate the fixture file."
    );
  }
  const raw = readFileSync(DEMO_FIXTURE_PATH, "utf-8");
  const fixture = JSON.parse(raw) as { activities: NormalizedActivity[] };
  return fixture.activities;
}

// ─── Chain steps ──────────────────────────────────────────────────────────────

/**
 * Step 1: Fetch activities from Notion and GitHub in parallel.
 *
 * If either fetcher fails, we log the error and continue with an empty array
 * for that source — the brief will still run with partial data and the
 * fetchErrors field will note what was unavailable.
 *
 * In DEMO_MODE, skips all API calls and loads from cache/demo-fixture.json.
 */
const fetchStep = RunnableLambda.from(
  async (input: ChainInput): Promise<WithActivities> => {
    const fetchErrors: string[] = [];

    // DEMO_MODE: skip live API calls
    if (process.env.DEMO_MODE === "true") {
      console.info("[chain] DEMO_MODE enabled — loading from demo-fixture.json");
      const activities = loadDemoFixture();
      const notion = activities.filter((a) => a.source === "notion").length;
      const github = activities.filter((a) => a.source === "github").length;
      console.log(`[fetch] notion: ${notion} items`);
      console.log(`[fetch] github: ${github} items`);
      return { ...input, activities, fetchErrors, sourceCounts: { notion, github } };
    }

    // Check for a fresh cache first
    const cached = readCache();
    if (cached) {
      console.info("[chain] Using cached activity data (< 1 hour old).");
      const notion = cached.filter((a) => a.source === "notion").length;
      const github = cached.filter((a) => a.source === "github").length;
      console.log(`[fetch] notion: ${notion} items (cached)`);
      console.log(`[fetch] github: ${github} items (cached)`);
      return { ...input, activities: cached, fetchErrors, sourceCounts: { notion, github } };
    }

    // Fetch live data in parallel
    const [notionResult, githubResult] = await Promise.allSettled([
      fetchNotionActivities(),
      fetchGithubActivities(),
    ]);

    const notionActivities =
      notionResult.status === "fulfilled"
        ? notionResult.value
        : (fetchErrors.push(
            `Notion fetch failed: ${notionResult.reason instanceof Error ? notionResult.reason.message : String(notionResult.reason)}`
          ),
          []);

    const githubActivities =
      githubResult.status === "fulfilled"
        ? githubResult.value
        : (fetchErrors.push(
            `GitHub fetch failed: ${githubResult.reason instanceof Error ? githubResult.reason.message : String(githubResult.reason)}`
          ),
          []);

    console.log(`[fetch] notion: ${notionActivities.length} items`);
    console.log(`[fetch] github: ${githubActivities.length} items`);

    const activities = [...notionActivities, ...githubActivities];
    writeCache(activities);

    return {
      ...input,
      activities,
      fetchErrors,
      sourceCounts: { notion: notionActivities.length, github: githubActivities.length },
    };
  }
);

/**
 * Step 2: Run the deterministic blocker detection rules.
 * No AI involved — same input always produces same output.
 */
const detectStep = RunnableLambda.from(
  (input: WithActivities) => ({
    ...input,
    detectionResult: detectBlockers(input.activities),
  })
);

/**
 * Step 3: Generate the narrative (summary + reportedVsReal) via Granite/OpenAI/fallback.
 * topRisks and topDecision come from the detector, not from the LLM.
 */
const narrativeStep = RunnableLambda.from(
  async (
    input: WithActivities & {
      detectionResult: ReturnType<typeof detectBlockers>;
    }
  ) => {
    const narrativeResult = await generateNarrative(
      input.standupNotes,
      input.detectionResult
    );
    return { ...input, narrativeResult };
  }
);

/**
 * Step 4: Assemble the final BriefOutput.
 *
 * topRisks and topDecision are passed through from the detector unchanged —
 * url, activityId, and source fields are always present and always correct.
 * Granite only contributes summary and reportedVsReal.
 */
const assembleStep = RunnableLambda.from(
  (
    input: WithActivities & {
      detectionResult: ReturnType<typeof detectBlockers>;
      narrativeResult: Awaited<ReturnType<typeof generateNarrative>>;
    }
  ): BriefOutput => {
    const { detectionResult, narrativeResult, fetchErrors, sourceCounts } = input;

    // If any fetcher failed, prepend a note to summary
    const summaryPrefix =
      fetchErrors.length > 0
        ? `⚠️ Note: ${fetchErrors.join("; ")}. Analysis is based on partial data.\n\n`
        : "";

    return {
      generatedAt: new Date().toISOString(),
      summary: summaryPrefix + narrativeResult.summary,
      topRisks: detectionResult.blockers.slice(0, 3),
      topDecision: detectionResult.topDecision,
      reportedVsReal: narrativeResult.reportedVsReal,
      narrativeSource: narrativeResult.source,
      fallbackUsed: narrativeResult.source !== "granite",
      rawLLMResponse: "",
      // Full activity list — powers the ActivityFeed raw data drawer
      allActivities: input.activities,
      sourceCounts,
    };
  }
);

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the full StandupSense pipeline:
 *   fetch → detect → generate narrative → assemble BriefOutput
 *
 * Usage:
 *   const brief = await runStandupChain(standupNotesText);
 */
export async function runStandupChain(
  standupNotes: string
): Promise<BriefOutput> {
  const chain = RunnableSequence.from([
    fetchStep,
    detectStep,
    narrativeStep,
    assembleStep,
  ]);

  return chain.invoke({ standupNotes });
}
