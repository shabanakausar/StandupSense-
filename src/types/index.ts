// ─── Source / Status / Kind enums ────────────────────────────────────────────

export type ActivitySource = "notion" | "github";
export type ActivityStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "done"
  | "stale";
export type ActivityKind = "task" | "pull_request" | "branch";

// ─── Narrative path tracking ──────────────────────────────────────────────────

/** Which code path generated the free-text narrative fields. */
export type NarrativeSource = "granite" | "openai" | "rule-based";

// ─── Core normalized activity ─────────────────────────────────────────────────

/**
 * The single shared shape that both the Notion fetcher and the GitHub fetcher
 * must produce. Every downstream module (blocker detector, Granite client,
 * frontend) works against this type only — never against raw API responses.
 */
export interface NormalizedActivity {
  /** Unique ID — Notion page ID or GitHub PR number / branch name */
  id: string;
  source: ActivitySource;
  kind: ActivityKind;
  title: string;
  status: ActivityStatus;
  /** Assignee (Notion) or PR author (GitHub), or null if not available */
  owner: string | null;
  createdAt: string; // ISO 8601
  lastUpdatedAt: string; // ISO 8601 — primary field for staleness checks
  dueDate: string | null; // ISO 8601 or null
  /** Deep link back to the source item */
  url: string;
  /**
   * Sentences ending in "?" extracted from:
   * - Notion: page content blocks + threaded page comments
   * - GitHub: inline review comments + general PR discussion comments
   */
  openQuestions: string[];
  /** Notion relation IDs of tasks this item depends on */
  dependsOn: string[];
  /** Labels, tags, or extra properties preserved for context */
  rawTags: string[];
}

// ─── Blocker detection ────────────────────────────────────────────────────────

/**
 * A single detected risk/blocker produced by blockerDetector.ts.
 * All fields are set deterministically — Granite never writes to this type.
 */
export interface DetectedBlocker {
  activityId: string;
  activityTitle: string;
  source: ActivitySource;
  /** Rule ID that fired, e.g. "STALE_TASK", "NO_PR_REVIEW" */
  type: string;
  severity: "high" | "medium" | "low";
  /** Human-readable explanation of why this rule fired */
  reason: string;
  /** One-line recommended action for the team */
  suggestedAction: string;
  url: string;
}

export interface SurfacedDecision {
  activityId: string;
  activityTitle: string;
  source: ActivitySource;
  /** The specific unresolved question text */
  question: string;
  /** Surrounding context to help the team resolve it in one sitting */
  context: string;
  url: string;
}

export interface BlockerDetectionResult {
  /** All detected blockers, sorted high → medium → low severity */
  blockers: DetectedBlocker[];
  /** Single most important unresolved decision, or null if none found */
  topDecision: SurfacedDecision | null;
}

// ─── Narrative (Granite / OpenAI / rule-based output) ────────────────────────

/**
 * The ONLY thing graniteClient.generateNarrative() returns.
 * Granite does not regenerate topRisks or topDecision — those come from the
 * deterministic detector and are merged into BriefOutput in chain.ts.
 */
export interface NarrativeResult {
  summary: string;
  reportedVsReal: string;
  /** Set directly by whichever code path ran — never inferred by the caller */
  source: NarrativeSource;
}

// ─── Final brief output ───────────────────────────────────────────────────────

/**
 * The complete pipeline output. Assembled in chain.ts by merging:
 *   - NarrativeResult (summary, reportedVsReal, narrativeSource)
 *   - BlockerDetectionResult (topRisks, topDecision) — passed through unchanged
 *
 * Granite never writes topRisks or topDecision, so url / activityId / source
 * fields are always present and always match the detector's output exactly.
 */
export interface BriefOutput {
  generatedAt: string; // ISO 8601
  /** 3-4 sentence honest summary — written by Granite / OpenAI / template */
  summary: string;
  /** Top 3 blockers by severity — directly from BlockerDetectionResult */
  topRisks: DetectedBlocker[];
  /** Single most important decision — directly from BlockerDetectionResult */
  topDecision: SurfacedDecision | null;
  /** Gap analysis between standup notes and actual data — written by LLM */
  reportedVsReal: string;
  /** Which path produced the narrative: "granite" | "openai" | "rule-based" */
  narrativeSource: NarrativeSource;
  /** Convenience boolean: narrativeSource !== "granite" */
  fallbackUsed: boolean;
  /** Raw LLM response text, preserved for debugging */
  rawLLMResponse: string;
  /**
   * The full merged activity list from both fetchers — every Notion task and
   * GitHub PR/branch that was pulled. Used by ActivityFeed to show the raw
   * data that fed into the analysis.
   */
  allActivities: NormalizedActivity[];
  /** Per-source item counts for dev diagnostics (notion / github). */
  sourceCounts: { notion: number; github: number };
}
