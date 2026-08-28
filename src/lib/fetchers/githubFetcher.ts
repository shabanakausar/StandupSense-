import { Octokit } from "@octokit/rest";
import type { NormalizedActivity, ActivityStatus } from "@/types";

// ─── Octokit client ───────────────────────────────────────────────────────────

/**
 * Lazily initialised so the module can be imported without env vars present
 * (e.g. during DEMO_MODE runs).
 */
function getClient(): { octokit: Octokit; owner: string; repo: string } {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Add it to .env.local.\n" +
        "Classic PAT: needs 'repo' scope (private repo) or 'public_repo' scope (public repo).\n" +
        "Fine-grained PAT: needs 'Contents: Read-only' and 'Pull requests: Read-only'.\n" +
        "NOTE: 'repo:read' does NOT exist as a classic PAT scope."
    );
  }
  if (!owner || !repo) {
    throw new Error(
      "GITHUB_OWNER and GITHUB_REPO must both be set in .env.local."
    );
  }

  return {
    octokit: new Octokit({ auth: token }),
    owner,
    repo,
  };
}

// ─── Question extraction ──────────────────────────────────────────────────────

/**
 * Splits text into sentences and returns those ending in "?".
 * The same heuristic used in notionFetcher — sentences are where humans write
 * decision-style open questions.
 */
function extractQuestions(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length > 5);
}

/** Deduplicates an array of strings by exact match */
function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ─── PR status normalisation ──────────────────────────────────────────────────

type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

/**
 * Derives ActivityStatus from the set of review states on a PR.
 * Returns "blocked" if any reviewer requested changes,
 * "in_progress" if no reviews exist yet,
 * "done" if approved.
 */
function deriveStatusFromReviews(
  reviewStates: ReviewState[]
): ActivityStatus {
  if (reviewStates.some((s) => s === "CHANGES_REQUESTED")) return "blocked";
  if (reviewStates.some((s) => s === "APPROVED")) return "done";
  return "in_progress";
}

// ─── Error handling helpers ───────────────────────────────────────────────────

/**
 * Extracts the HTTP status from an Octokit error response.
 */
function getOctokitStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return null;
}

/**
 * Wraps a GitHub API call and translates common HTTP errors into clear messages.
 * Also respects the Retry-After header on 403 rate-limit responses.
 */
async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const status = getOctokitStatus(err);

    if (status === 401) {
      throw new Error(
        `GitHub API returned 401 Unauthorized (${context}). ` +
          "Check that GITHUB_TOKEN is valid and has not expired."
      );
    }
    if (status === 403) {
      // Could be rate-limited or missing scope
      const retryAfter =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { headers?: Record<string, string> } }).response
          ?.headers?.["retry-after"];
      if (typeof retryAfter === "string") {
        const delay = parseInt(retryAfter, 10) * 1000;
        console.warn(
          `[githubFetcher] Rate limited — waiting ${retryAfter}s before retry`
        );
        await new Promise((r) => setTimeout(r, delay));
        return fn(); // one retry
      }
      throw new Error(
        `GitHub API returned 403 Forbidden (${context}). ` +
          "Check that your token has the required scope: " +
          "'repo' (private), 'public_repo' (public), or fine-grained " +
          "'Contents: Read-only' + 'Pull requests: Read-only'."
      );
    }
    throw err;
  }
}

// ─── Fetch PR inline review comments ─────────────────────────────────────────

/**
 * GET /repos/{owner}/{repo}/pulls/{pull_number}/comments
 *
 * These are inline comments attached to specific lines in the diff —
 * code-level nitpicks left during a review. Also a source of open questions
 * but less common for decision-style ones.
 */
async function fetchPRReviewCommentQuestions(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string[]> {
  const comments = await withErrorHandling(
    () =>
      octokit.paginate(octokit.rest.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
    `pulls.listReviewComments #${pullNumber}`
  );
  return comments.flatMap((c) => extractQuestions(c.body));
}

// ─── Fetch PR general discussion comments ────────────────────────────────────

/**
 * GET /repos/{owner}/{repo}/issues/{pull_number}/comments
 *
 * These are top-level conversation comments on the PR thread — the PRIMARY
 * source of decision-style questions (e.g. "should we use Stripe or Paddle?").
 * Every GitHub PR is internally also an issue, which is why this uses the
 * issues endpoint.
 */
async function fetchPRDiscussionCommentQuestions(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string[]> {
  const comments = await withErrorHandling(
    () =>
      octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
      }),
    `issues.listComments #${pullNumber}`
  );
  return comments.flatMap((c) => extractQuestions(c.body ?? ""));
}

// ─── Fetch open PRs ───────────────────────────────────────────────────────────

/**
 * Fetches all open PRs for the configured repo, enriches each with review
 * status and open questions from both comment sources, and maps to
 * NormalizedActivity with kind: "pull_request".
 */
async function fetchOpenPRs(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<NormalizedActivity[]> {
  // List all open PRs (paginated)
  const prs = await withErrorHandling(
    () =>
      octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state: "open",
        per_page: 100,
      }),
    "pulls.list"
  );

  if (prs.length === 0) {
    console.info("[githubFetcher] No open PRs found.");
    return [];
  }

  // Enrich each PR concurrently (bounded to 5 at a time)
  const CONCURRENCY = 5;
  const activities: NormalizedActivity[] = [];

  for (let i = 0; i < prs.length; i += CONCURRENCY) {
    const batch = prs.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (pr) => {
        // Fetch reviews to determine status
        const reviews = await withErrorHandling(
          () =>
            octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: pr.number,
            }),
          `pulls.listReviews #${pr.number}`
        );
        const reviewStates = reviews.data.map(
          (r) => r.state as ReviewState
        );

        // Fetch questions from both comment endpoints in parallel
        const [reviewQuestions, discussionQuestions] = await Promise.all([
          fetchPRReviewCommentQuestions(octokit, owner, repo, pr.number),
          fetchPRDiscussionCommentQuestions(octokit, owner, repo, pr.number),
        ]);

        // Also extract questions from the PR body itself
        const bodyQuestions = extractQuestions(pr.body ?? "");

        const openQuestions = dedup([
          ...bodyQuestions,
          ...reviewQuestions,
          ...discussionQuestions,
        ]);

        // Sanitize the PR title: GitHub occasionally returns titles that contain
        // concatenated sentences (e.g. "Title .Second sentence"). Take only the
        // content before the first mid-sentence period+space or period+newline
        // to avoid garbage in the Decision Surface and blocker cards.
        const sanitizedTitle = pr.title
          .split(/\s*\.\s+(?=[A-Z])/)  // split at ". Capital" boundaries
          [0]                            // keep only the first fragment
          .trim();

        const activity: NormalizedActivity = {
          id: String(pr.number),
          source: "github",
          kind: "pull_request",
          title: sanitizedTitle,
          status: deriveStatusFromReviews(reviewStates),
          owner: pr.user?.login ?? null,
          createdAt: pr.created_at,
          lastUpdatedAt: pr.updated_at,
          dueDate: null, // PRs don't have due dates
          url: pr.html_url,
          openQuestions,
          dependsOn: [], // GitHub PRs don't have explicit dependencies in the API
          rawTags: pr.labels?.map((l) => l.name ?? "") ?? [],
        };

        return activity;
      })
    );

    activities.push(...batchResults);
  }

  return activities;
}

// ─── Fetch branch activity ────────────────────────────────────────────────────

/**
 * Fetches all branches and the date of their most recent commit.
 * Maps each to NormalizedActivity with kind: "branch".
 *
 * Used to detect stale work: branches with no commits in 7+ days
 * that have not been merged into the default branch.
 */
async function fetchBranchActivity(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<NormalizedActivity[]> {
  // Get all branches
  const branches = await withErrorHandling(
    () =>
      octokit.paginate(octokit.rest.repos.listBranches, {
        owner,
        repo,
        per_page: 100,
      }),
    "repos.listBranches"
  );

  // Collect head SHAs of merged PRs to exclude already-merged branches
  const mergedPRHeads = await withErrorHandling(
    () =>
      octokit.paginate(octokit.rest.pulls.list, {
        owner,
        repo,
        state: "closed",
        per_page: 100,
      }),
    "pulls.list (closed)"
  ).then((prs) =>
    new Set(prs.filter((p) => p.merged_at).map((p) => p.head.sha))
  );

  const CONCURRENCY = 5;
  const activities: NormalizedActivity[] = [];

  for (let i = 0; i < branches.length; i += CONCURRENCY) {
    const batch = branches.slice(i, i + CONCURRENCY);

    const batchResults = await Promise.all(
      batch.map(async (branch) => {
        // Skip the default branch — it's never "stale work"
        if (["main", "master", "develop"].includes(branch.name)) return null;

        // Skip branches already represented in merged PRs
        if (mergedPRHeads.has(branch.commit.sha)) return null;

        // Get the commit date from the branch's HEAD commit
        const commitData = await withErrorHandling(
          () =>
            octokit.rest.repos.getCommit({
              owner,
              repo,
              ref: branch.commit.sha,
            }),
          `repos.getCommit ${branch.name}`
        );

        const lastCommitAt =
          commitData.data.commit.committer?.date ??
          commitData.data.commit.author?.date ??
          new Date().toISOString();

        const activity: NormalizedActivity = {
          id: `branch:${branch.name}`,
          source: "github",
          kind: "branch",
          title: branch.name,
          status: "in_progress", // branches are "in progress" until merged
          owner: commitData.data.committer?.login ?? null,
          createdAt: lastCommitAt, // best approximation — branches have no created_at
          lastUpdatedAt: lastCommitAt,
          dueDate: null,
          url: `https://github.com/${owner}/${repo}/tree/${branch.name}`,
          openQuestions: [],
          dependsOn: [],
          rawTags: [],
        };

        return activity;
      })
    );

    activities.push(
      ...(batchResults.filter(Boolean) as NormalizedActivity[])
    );
  }

  return activities;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches open PRs and branch activity from the configured GitHub repo and
 * returns them as NormalizedActivity objects.
 *
 * - Returns [] if there are no open PRs or branches (not an error).
 * - Surfaces 401 (bad token) and 403 (wrong scope / rate limit) as clear errors.
 * - Respects the Retry-After header on 403 rate-limit responses.
 * - Extracts openQuestions from BOTH inline review comments and general
 *   PR discussion comments — the latter is the primary source of decision-style
 *   questions.
 */
export async function fetchGithubActivities(): Promise<NormalizedActivity[]> {
  try {
    const { octokit, owner, repo } = getClient();

    // Fetch PRs and branches in parallel
    const [prActivities, branchActivities] = await Promise.all([
      fetchOpenPRs(octokit, owner, repo),
      fetchBranchActivity(octokit, owner, repo),
    ]);

    const results = [...prActivities, ...branchActivities];
    console.log(`[githubFetcher] Fetched ${results.length} activities (${prActivities.length} PRs, ${branchActivities.length} branches) from ${owner}/${repo}`);
    return results;
  } catch (err) {
    console.error("[githubFetcher] Failed to fetch GitHub activities:", err);
    return [];
  }
}
