import type {
  NormalizedActivity,
  DetectedBlocker,
  SurfacedDecision,
  BlockerDetectionResult,
  ActivitySource,
} from "@/types";

// ─── Time helpers ─────────────────────────────────────────────────────────────

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

function daysUntil(isoDate: string): number {
  return (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
}

function hoursSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

// ─── Rule implementations ─────────────────────────────────────────────────────

/**
 * STALE_TASK — Notion
 * A task has been "in progress" for 3+ days with no update.
 * Severity: medium
 */
function ruleStaleTask(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "notion") return null;
  if (a.status !== "in_progress") return null;
  if (daysSince(a.lastUpdatedAt) < 3) return null;

  const days = Math.floor(daysSince(a.lastUpdatedAt));
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "STALE_TASK",
    severity: "medium",
    reason: `In progress for ${days} days with no updates (last edited ${days}d ago).`,
    suggestedAction: `Check in with ${a.owner ?? "the assignee"} — is this actually moving?`,
    url: a.url,
  };
}

/**
 * AT_RISK_DUE — Notion
 * A task is due within 2 days and not yet done.
 * Severity: high
 */
function ruleAtRiskDue(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "notion") return null;
  if (!a.dueDate) return null;
  if (a.status === "done") return null;
  const days = daysUntil(a.dueDate);
  if (days < 0 || days > 2) return null; // past-due handled by PAST_DUE rule

  const label = days < 1 ? "today" : `in ${Math.ceil(days)} day(s)`;
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "AT_RISK_DUE",
    severity: "high",
    reason: `Due ${label} and status is "${a.status}".`,
    suggestedAction: `Confirm with ${a.owner ?? "the assignee"} whether this will ship on time.`,
    url: a.url,
  };
}

/**
 * PAST_DUE — Notion
 * A task's due date has passed and it is not done.
 * Severity: high
 */
function rulePastDue(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "notion") return null;
  if (!a.dueDate) return null;
  if (a.status === "done") return null;
  if (daysUntil(a.dueDate) >= 0) return null;

  const overdue = Math.floor(Math.abs(daysUntil(a.dueDate)));
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "PAST_DUE",
    severity: "high",
    reason: `Was due ${overdue} day(s) ago and is still "${a.status}".`,
    suggestedAction: `Escalate or rescope — this task is ${overdue}d overdue with no resolution.`,
    url: a.url,
  };
}

/**
 * OPEN_DEPENDENCY — Notion
 * A task depends on another task that isn't done yet.
 * Severity: high
 */
function ruleOpenDependency(
  a: NormalizedActivity,
  allActivities: NormalizedActivity[]
): DetectedBlocker | null {
  if (a.source !== "notion") return null;
  if (a.dependsOn.length === 0) return null;

  // Find any dependency that is not done
  const blockers = a.dependsOn
    .map((depId) => allActivities.find((x) => x.id === depId))
    .filter((dep): dep is NormalizedActivity => !!dep && dep.status !== "done");

  if (blockers.length === 0) return null;

  const titles = blockers.map((b) => `"${b.title}"`).join(", ");
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "OPEN_DEPENDENCY",
    severity: "high",
    reason: `Blocked by ${blockers.length} incomplete dependency(ies): ${titles}.`,
    suggestedAction: `Resolve the blocking task(s) first, or decide whether this dependency can be bypassed.`,
    url: a.url,
  };
}

/**
 * NO_PR_REVIEW — GitHub
 * A PR has been open for 48+ hours with no review activity.
 * Severity: medium
 */
function ruleNoPRReview(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "github") return null;
  if (a.kind !== "pull_request") return null;
  // If status is "blocked" (changes requested) or "done" (approved), a review exists
  if (a.status !== "in_progress") return null;
  if (hoursSince(a.createdAt) < 48) return null;

  const hours = Math.floor(hoursSince(a.createdAt));
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "NO_PR_REVIEW",
    severity: "medium",
    reason: `PR #${a.id} has been open for ${hours}h with no review.`,
    suggestedAction: `Assign a reviewer or ping the team — this PR is aging without feedback.`,
    url: a.url,
  };
}

/**
 * PR_STUCK — GitHub
 * A PR has changes requested but no new commits in 48+ hours.
 * Severity: high — this means the author hasn't addressed the feedback.
 */
function rulePRStuck(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "github") return null;
  if (a.kind !== "pull_request") return null;
  if (a.status !== "blocked") return null; // "blocked" = changes_requested
  if (hoursSince(a.lastUpdatedAt) < 48) return null;

  const hours = Math.floor(hoursSince(a.lastUpdatedAt));
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "PR_STUCK",
    severity: "high",
    reason: `PR #${a.id} has "changes requested" and no new commits in ${hours}h.`,
    suggestedAction: `${a.owner ?? "Author"} needs to address review feedback or close this PR.`,
    url: a.url,
  };
}

/**
 * STALE_BRANCH — GitHub
 * A branch has had no commits in 7+ days.
 * Severity: low — could be abandoned work or a forgotten experiment.
 */
function ruleStaleBranch(a: NormalizedActivity): DetectedBlocker | null {
  if (a.source !== "github") return null;
  if (a.kind !== "branch") return null;
  if (daysSince(a.lastUpdatedAt) < 7) return null;

  const days = Math.floor(daysSince(a.lastUpdatedAt));
  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source,
    type: "STALE_BRANCH",
    severity: "low",
    reason: `Branch "${a.title}" has had no commits in ${days} days.`,
    suggestedAction: `Decide: merge, rebase, or delete this branch to keep the repo clean.`,
    url: a.url,
  };
}

/**
 * CROSS_SYSTEM_MISMATCH — Both sources
 * A Notion task title references "PR", "#", or a branch-like name, but no
 * matching open GitHub PR or recent branch exists.
 * Severity: medium
 */
function ruleCrossSystemMismatch(
  a: NormalizedActivity,
  allActivities: NormalizedActivity[]
): DetectedBlocker | null {
  if (a.source !== "notion") return null;
  if (a.status === "done") return null;

  // Heuristic: task title contains PR-related keywords
  const prKeywords = /\bpr\b|pull.?request|#\d+|branch/i;
  if (!prKeywords.test(a.title)) return null;

  const githubItems = allActivities.filter((x) => x.source === "github");
  if (githubItems.length === 0) return null;

  // Check if any GitHub item title loosely matches this task's title
  // (shared words, ignoring common stop words)
  const taskWords = new Set(
    a.title
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3 && !["with", "that", "this", "from", "have"].includes(w))
  );

  const hasMatch = githubItems.some((g) => {
    const githubWords = g.title.toLowerCase().split(/\W+/);
    return githubWords.some((w) => w.length > 3 && taskWords.has(w));
  });

  if (hasMatch) return null; // Found a plausible match — not a mismatch

  return {
    activityId: a.id,
    activityTitle: a.title,
    source: a.source as ActivitySource,
    type: "CROSS_SYSTEM_MISMATCH",
    severity: "medium",
    reason: `Task references GitHub work but no matching open PR or branch was found.`,
    suggestedAction: `Verify the PR exists and is linked. If work hasn't started, update the task status.`,
    url: a.url,
  };
}

// ─── Severity ordering ────────────────────────────────────────────────────────

const SEVERITY_ORDER: Record<DetectedBlocker["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ─── Top decision selection ───────────────────────────────────────────────────

/**
 * Selects the single most important unresolved decision from the activity list.
 *
 * Priority:
 * 1. Activity with openQuestions that also has a high-severity blocker
 * 2. Activity with openQuestions that has any blocker
 * 3. Any activity with openQuestions (even if no blocker)
 */
function selectTopDecision(
  activities: NormalizedActivity[],
  blockers: DetectedBlocker[]
): SurfacedDecision | null {
  const blockerMap = new Map(blockers.map((b) => [b.activityId, b]));

  const withQuestions = activities.filter((a) => a.openQuestions.length > 0);
  if (withQuestions.length === 0) return null;

  // Sort: prefer activities with high-severity blockers, then any blocker, then by question count
  const ranked = withQuestions.sort((a, b) => {
    const ba = blockerMap.get(a.id);
    const bb = blockerMap.get(b.id);
    const sa = ba ? SEVERITY_ORDER[ba.severity] : 99;
    const sb = bb ? SEVERITY_ORDER[bb.severity] : 99;
    if (sa !== sb) return sa - sb;
    return b.openQuestions.length - a.openQuestions.length;
  });

  const top = ranked[0];
  const question = top.openQuestions[0];

  // Use surrounding questions as context, or fall back to the task title
  const context =
    top.openQuestions.length > 1
      ? `Also related: ${top.openQuestions.slice(1, 3).join(" | ")}`
      : `From ${top.source === "github" ? `PR #${top.id}` : `task "${top.title}"`}`;

  return {
    activityId: top.id,
    activityTitle: top.title,
    source: top.source,
    question,
    context,
    url: top.url,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all 8 blocker-detection rules against the normalized activity array.
 *
 * Returns:
 * - blockers: all detected issues, sorted high → medium → low, deduplicated
 *   per activity (only the highest-severity rule fires per item)
 * - topDecision: the single most important unresolved question, or null
 *
 * This is purely deterministic — no AI involved. Same input always produces
 * the same output, making the demo reliable and the logic auditable.
 */
export function detectBlockers(
  activities: NormalizedActivity[]
): BlockerDetectionResult {
  const rawResults: DetectedBlocker[] = [];

  for (const a of activities) {
    const candidates: DetectedBlocker[] = [
      ruleStaleTask(a),
      ruleAtRiskDue(a),
      rulePastDue(a),
      ruleOpenDependency(a, activities),
      ruleNoPRReview(a),
      rulePRStuck(a),
      ruleStaleBranch(a),
      ruleCrossSystemMismatch(a, activities),
    ].filter((r): r is DetectedBlocker => r !== null);

    if (candidates.length === 0) continue;

    // Keep only the highest-severity rule per activity to avoid duplicates
    candidates.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );
    rawResults.push(candidates[0]);
  }

  // Sort the full list: high → medium → low
  const blockers = rawResults.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const topDecision = selectTopDecision(activities, blockers);

  return { blockers, topDecision };
}
