import { Client, isFullPage } from "@notionhq/client";
import type {
  PageObjectResponse,
  PartialPageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import type { NormalizedActivity, ActivityStatus } from "@/types";

// ─── Notion client ────────────────────────────────────────────────────────────

/**
 * Lazily initialised so module-level code doesn't throw if env vars are absent
 * (e.g. during DEMO_MODE runs where this file is imported but never called).
 */
function getClient(): Client {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error(
      "NOTION_TOKEN is not set. Add it to .env.local. " +
        "Create an Internal Integration at https://notion.so/my-integrations"
    );
  }
  return new Client({ auth: token });
}

// ─── Status normalisation ─────────────────────────────────────────────────────

/**
 * Maps whatever status values YOUR Notion database uses to our ActivityStatus
 * enum. Driven by env vars so no code changes are needed if you rename statuses.
 *
 * Defaults assume a standard Notion setup — override with env vars:
 *   NOTION_STATUS_MAP_IN_PROGRESS="In Progress,Doing,In flight,WIP"
 *   NOTION_STATUS_MAP_DONE="Done,Complete,Shipped,Closed"
 *   NOTION_STATUS_MAP_BLOCKED="Blocked,On Hold"
 */
function buildStatusMap(): Record<string, ActivityStatus> {
  const toList = (envKey: string, defaults: string[]) =>
    (process.env[envKey] ?? defaults.join(","))
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  const map: Record<string, ActivityStatus> = {};

  toList("NOTION_STATUS_MAP_IN_PROGRESS", [
    "In Progress",
    "Doing",
    "In flight",
    "WIP",
  ]).forEach((v) => (map[v] = "in_progress"));

  toList("NOTION_STATUS_MAP_DONE", [
    "Done",
    "Complete",
    "Shipped",
    "Closed",
  ]).forEach((v) => (map[v] = "done"));

  toList("NOTION_STATUS_MAP_BLOCKED", ["Blocked", "On Hold"]).forEach(
    (v) => (map[v] = "blocked")
  );

  return map;
}

function normaliseStatus(raw: string | null | undefined): ActivityStatus {
  if (!raw) return "not_started";
  const statusMap = buildStatusMap();
  return statusMap[raw.trim().toLowerCase()] ?? "not_started";
}

// ─── Property helpers ─────────────────────────────────────────────────────────

type PageProps = PageObjectResponse["properties"];

/** Read a plain-text title property */
function getTitle(props: PageProps, key: string): string {
  const prop = props[key];
  if (!prop || prop.type !== "title") return "(untitled)";
  return prop.title.map((t) => t.plain_text).join("") || "(untitled)";
}

/** Read a select property value */
function getSelect(props: PageProps, key: string): string | null {
  const prop = props[key];
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name ?? null;
}

/** Read a status property value (Notion's native Status type) */
function getStatus(props: PageProps, key: string): string | null {
  const prop = props[key];
  if (!prop || prop.type !== "status") return null;
  return prop.status?.name ?? null;
}

/** Read a date property — returns start date string or null */
function getDate(props: PageProps, key: string): string | null {
  const prop = props[key];
  if (!prop || prop.type !== "date") return null;
  return prop.date?.start ?? null;
}

/** Read a people property — returns first person's name or null */
function getPerson(props: PageProps, key: string): string | null {
  const prop = props[key];
  if (!prop || prop.type !== "people") return null;
  const first = prop.people[0];
  if (!first) return null;
  // Full user objects have a name; partial objects may not
  return "name" in first ? (first.name ?? null) : null;
}

/** Read a relation property — returns array of related page IDs */
function getRelations(props: PageProps, key: string): string[] {
  const prop = props[key];
  if (!prop || prop.type !== "relation") return [];
  return prop.relation.map((r) => r.id);
}

/** Read a multi-select property — returns array of tag names */
function getMultiSelect(props: PageProps, key: string): string[] {
  const prop = props[key];
  if (!prop || prop.type !== "multi_select") return [];
  return prop.multi_select.map((s) => s.name);
}

// ─── Question extraction ──────────────────────────────────────────────────────

/**
 * Splits text into sentences and returns those ending in "?".
 * Simple heuristic — good enough for detecting open questions in standup data.
 */
function extractQuestions(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith("?") && s.length > 5);
}

// ─── Block content extraction ─────────────────────────────────────────────────

/**
 * Pulls plain text from a single Notion block (paragraph, heading, bullet, etc.)
 */
function blockToText(
  block: BlockObjectResponse | PartialBlockObjectResponse
): string {
  if (!("type" in block)) return "";
  const b = block as BlockObjectResponse;
  const richTextTypes = [
    "paragraph",
    "heading_1",
    "heading_2",
    "heading_3",
    "bulleted_list_item",
    "numbered_list_item",
    "quote",
    "callout",
    "toggle",
  ] as const;

  for (const type of richTextTypes) {
    const section = (b as Record<string, unknown>)[type] as
      | { rich_text: Array<{ plain_text: string }> }
      | undefined;
    if (section?.rich_text) {
      return section.rich_text.map((rt) => rt.plain_text).join("");
    }
  }
  return "";
}

// ─── API helpers ──────────────────────────────────────────────────────────────

/**
 * Fetches all content blocks for a page and returns sentences containing "?".
 */
async function fetchBlockQuestions(
  notion: Client,
  pageId: string
): Promise<string[]> {
  const questions: string[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of response.results) {
      questions.push(...extractQuestions(blockToText(block)));
    }
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return questions;
}

/**
 * Fetches page-level comments and returns sentences containing "?".
 *
 * Requires "Read comments" capability on the Notion integration.
 * Returns [] on 403 (missing capability) with a warning rather than throwing —
 * the rest of the data is still valid without comments.
 */
async function fetchCommentQuestions(
  notion: Client,
  pageId: string
): Promise<string[]> {
  try {
    const response = await notion.comments.list({ block_id: pageId });
    const questions: string[] = [];
    for (const comment of response.results) {
      const text = comment.rich_text.map((rt) => rt.plain_text).join("");
      questions.push(...extractQuestions(text));
    }
    return questions;
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;
    if (status === 403) {
      console.warn(
        "[notionFetcher] Comment fetch returned 403 — " +
          '"Read comments" capability is not enabled on your Notion integration. ' +
          "Enable it at https://notion.so/my-integrations then reconnect."
      );
      return [];
    }
    // Re-throw unexpected errors
    throw err;
  }
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

/**
 * Wraps an async call with a single retry on Notion rate-limit (429) responses.
 * 1-second delay before retry matches Notion's guidance.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;
    if (status === 429) {
      console.warn("[notionFetcher] Rate limited — retrying in 1s…");
      await new Promise((r) => setTimeout(r, 1000));
      return fn();
    }
    throw err;
  }
}

// ─── Page → NormalizedActivity ────────────────────────────────────────────────

async function pageToActivity(
  notion: Client,
  page: PageObjectResponse | PartialPageObjectResponse
): Promise<NormalizedActivity> {
  // Guard: we need a full page to read properties
  if (!isFullPage(page)) {
    return {
      id: page.id,
      source: "notion",
      kind: "task",
      title: "(partial page — no detail available)",
      status: "not_started",
      owner: null,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      dueDate: null,
      url: `https://notion.so/${page.id.replace(/-/g, "")}`,
      openQuestions: [],
      dependsOn: [],
      rawTags: [],
    };
  }

  const props = page.properties;

  // Property names are configurable via env vars (defaults to common conventions)
  const statusProp = process.env.NOTION_STATUS_PROP ?? "Status";
  const dueProp = process.env.NOTION_DUE_DATE_PROP ?? "Due Date";
  const assigneeProp = process.env.NOTION_ASSIGNEE_PROP ?? "Assignee";

  // Status can live in a "select" or Notion's native "status" type
  const rawStatus =
    getStatus(props, statusProp) ?? getSelect(props, statusProp);

  // Extract questions from both content blocks and page comments
  const [blockQuestions, commentQuestions] = await Promise.all([
    withRetry(() => fetchBlockQuestions(notion, page.id)),
    withRetry(() => fetchCommentQuestions(notion, page.id)),
  ]);

  // Deduplicate questions across the two sources
  const openQuestions = [
    ...new Set([...blockQuestions, ...commentQuestions]),
  ];

  return {
    id: page.id,
    source: "notion",
    kind: "task",
    title: getTitle(props, "Name") || getTitle(props, "Title"),
    status: normaliseStatus(rawStatus),
    owner: getPerson(props, assigneeProp),
    createdAt: page.created_time,
    lastUpdatedAt: page.last_edited_time,
    dueDate: getDate(props, dueProp),
    url: page.url,
    openQuestions,
    dependsOn: getRelations(props, "Depends on"),
    rawTags: getMultiSelect(props, "Tags"),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches all tasks from the configured Notion database and returns them
 * as NormalizedActivity objects.
 *
 * - Returns [] if the database is empty (not an error).
 * - Surfaces 401 as a clear error message pointing at the integration setup.
 * - Retries once on 429 with a 1-second delay.
 * - Falls back gracefully (warns, does not throw) if comment fetching fails
 *   due to a missing "Read comments" capability.
 */
export async function fetchNotionActivities(): Promise<NormalizedActivity[]> {
  const notion = getClient();
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error(
      "NOTION_DATABASE_ID is not set. Add it to .env.local. " +
        "Find it in the URL of your Notion database: notion.so/{workspace}/{DATABASE_ID}"
    );
  }

  const pages: (PageObjectResponse | PartialPageObjectResponse)[] = [];
  let cursor: string | undefined;

  // Paginate through all results
  do {
    const response = await withRetry(() =>
      notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor,
        page_size: 100,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
      })
    ).catch((err: unknown) => {
      const status =
        err &&
        typeof err === "object" &&
        "status" in err &&
        typeof (err as { status: unknown }).status === "number"
          ? (err as { status: number }).status
          : null;
      if (status === 401) {
        throw new Error(
          "Notion API returned 401 Unauthorized. " +
            "Check that NOTION_TOKEN is correct and the integration is connected to your database."
        );
      }
      throw err;
    });

    // response.results can include DatabaseObjectResponse (sub-databases) —
    // filter to page types only before passing to pageToActivity
    const pageResults = response.results.filter(
      (r): r is PageObjectResponse | PartialPageObjectResponse =>
        r.object === "page"
    );
    pages.push(...pageResults);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  if (pages.length === 0) {
    console.info(
      "[notionFetcher] Database is empty or no pages matched the query."
    );
    return [];
  }

  // Fetch detail for each page concurrently (bounded to avoid hammering the API)
  const CONCURRENCY = 5;
  const activities: NormalizedActivity[] = [];

  for (let i = 0; i < pages.length; i += CONCURRENCY) {
    const batch = pages.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((page) => withRetry(() => pageToActivity(notion, page)))
    );
    activities.push(...results);
  }

  return activities;
}
