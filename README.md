# StandupSense

**IBM AI Builders Challenge — Wild Card Theme: AI Co-workers / Workflow Orchestration / Decision Intelligence**

---

## The Problem

Small teams run daily or weekly standups where status updates are often optimistic fiction. Blockers go unspoken. Decisions get raised in threads, never resolved, and quietly block progress for days. Nobody has a Chief of Staff to catch this.

The result: a PR sits unreviewed for 72 hours while the standup says "nearly done." A task has been "in progress" for a week with no commits. A design decision is buried in a PR comment with no reply.

---

## The Solution

StandupSense is a single-workflow AI agent that:

1. **Pulls real activity data** from Notion (task status, due dates, last-edited timestamps) and GitHub (open PRs, review status, commit activity, stale branches)
2. **Cross-references that data** against what the team said in their last standup notes
3. **Detects blockers automatically** using deterministic rules — stale tasks, unreviewed PRs, stuck branches, overdue items, open dependencies
4. **Generates an honest Situation Brief** — a short, accurate summary of real progress vs. reported progress
5. **Surfaces the single most important unresolved decision** blocking the team right now, with context, so it can be resolved in one sitting

---

## AI Approach and Architecture

### Deterministic blocker detection (no AI)
Eight rule-based checks run first, before any LLM call:

| Rule | Trigger |
|---|---|
| STALE_TASK | Notion task "in progress" with no update in 3+ days |
| AT_RISK_DUE | Task due within 2 days and not done |
| PAST_DUE | Task past its due date |
| OPEN_DEPENDENCY | Task blocked by an incomplete dependency |
| NO_PR_REVIEW | PR open 48+ hours with no review |
| PR_STUCK | PR with changes requested, no new commits in 48h |
| STALE_BRANCH | Branch with no commits in 7+ days |
| CROSS_SYSTEM_MISMATCH | Notion task references GitHub work but no matching PR exists |

This makes the demo reliable and the logic auditable — the same input always produces the same detection result.

### IBM Granite (via watsonx)
Granite receives the standup notes and blocker list as context and generates two free-text fields:
- **summary** — a 3–4 sentence honest assessment of where the team stands
- **reportedVsReal** — one paragraph on the gap between stated progress and actual data

Prompt: system prompt instructs Granite to act as a sharp, calm chief of staff. No filler language. Cite specific task names and PR numbers.

### Narrative source tracking
Three fallback paths, each surfaced in the UI:
1. **IBM Granite** (`narrativeSource: "granite"`) — primary
2. **OpenAI gpt-4o-mini** (`narrativeSource: "openai"`) — if `OPENAI_API_KEY` is set and Granite is unavailable
3. **Rule-based templates** (`narrativeSource: "rule-based"`) — if both LLMs fail; the brief still renders, `fallbackUsed: true`

**Pipeline architecture:**

```
Standup notes (text input)
        │
        ▼
┌─────────────────────────────────────────────┐
│              LangChain Pipeline             │
│                                             │
│  Notion Fetcher → GitHub Fetcher            │
│         │               │                  │
│         └────────┬───────┘                  │
│                  ▼                          │
│         Data Normalizer (NormalizedActivity[])│
│                  │                          │
│                  ▼                          │
│         Blocker Detector (deterministic)    │
│                  │                          │
│                  ▼                          │
│         Granite Narrative Generator        │
│         (summary + reportedVsReal only)     │
│                  │                          │
│                  ▼                          │
│         BriefOutput assembly (chain.ts)     │
└─────────────────────────────────────────────┘
        │
        ▼
  Next.js Dashboard (App Router)
```

**Key design decision:** IBM Granite is given the blockers as read-only context and asked to write exactly two things — a summary and a reported-vs-reality gap analysis. It does not regenerate the blocker list or decision object. Those come from the deterministic detector, which means `url`, `activityId`, and source fields are always accurate and always link back to real items.

---

## Challenge Theme

**Wild Card — AI Co-workers / Workflow Orchestration / Decision Intelligence**

StandupSense acts as an AI co-worker that does the job a good Chief of Staff would do: cross-referencing self-reported status with real system data, detecting what's actually blocked, and surfacing the one decision that needs to happen today. It orchestrates two external data sources through a LangChain pipeline, uses IBM Granite for reasoning, and produces a structured brief that replaces the optimistic fiction of a typical standup.

---

## How IBM Bob Was Used

IBM Bob (the AI assistant) was used throughout the entire development of this project:

1. **Planning the architecture** — Bob produced the full system architecture diagram, file structure, normalized data schema, and the list of required API endpoints with correct scopes (including catching `repo:read` as a non-existent GitHub scope and the missing Notion comments endpoint)
2. **Generating the data fetchers** — Bob wrote `notionFetcher.ts` and `githubFetcher.ts` with pagination, error handling, both Notion comment sources, and both GitHub comment endpoints (inline review + general discussion)
3. **Building the blocker detector** — Bob implemented all 8 detection rules as deterministic named functions with severity ranking and deduplication
4. **Designing the AI integration** — Bob identified the design flaw in asking Granite to regenerate structured fields it shouldn't own, and restructured `graniteClient.ts` so Granite only writes narrative while the detector owns all structured data
5. **Building the IAM token manager** — Bob designed the in-memory cache + 60-second pre-expiry refresh to prevent silent 401 failures mid-demo
6. **Building the frontend** — Bob wrote all five React components and the main page with loading skeletons, severity color-coding, and the amber `DecisionSurface` callout
7. **Writing this README** — Bob generated this document

---

## Setup

### Prerequisites
- Node.js 18+
- A Notion workspace with an Internal Integration
- A GitHub Personal Access Token
- An IBM Cloud account with a watsonx project

### 1. Clone and install

```bash
git clone https://github.com/your-org/standupsense
cd standupsense
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Notion
NOTION_TOKEN=secret_...           # From https://notion.so/my-integrations
NOTION_DATABASE_ID=...            # From your database URL
NOTION_STATUS_PROP=Status         # Exact property name in your DB
NOTION_DUE_DATE_PROP=Due Date
NOTION_ASSIGNEE_PROP=Assignee

# GitHub
# Classic PAT: needs "repo" (private repo) or "public_repo" (public repo)
# Fine-grained PAT: needs "Contents: Read-only" + "Pull requests: Read-only"
# NOTE: "repo:read" does NOT exist as a classic PAT scope
GITHUB_TOKEN=ghp_...
GITHUB_OWNER=your-org
GITHUB_REPO=your-repo

# IBM watsonx
# Verify your model: GET /ml/v1/foundation_model_specs?version=2023-05-29
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=https://us-south.ml.cloud.ibm.com
WATSONX_MODEL_ID=ibm/granite-3-2b-instruct
```

**Notion integration setup:**
1. Go to [notion.so/my-integrations](https://notion.so/my-integrations)
2. Create an Internal Integration
3. Enable **Read content** AND **Read comments** capabilities (the comments endpoint returns 403 without this)
4. Share your task database with the integration

### 3. Run in demo mode (no live API calls needed)

```bash
DEMO_MODE=true npm run dev
```

Open [localhost:3000](http://localhost:3000), paste the sample standup notes from `cache/demo-fixture.json`'s `_standupNotes` field, and click Generate Brief.

### 4. Run with live data

```bash
npm run dev
```

### 5. Test the fetchers

```bash
# With live credentials:
npx ts-node --project tsconfig.json scripts/testFetchers.ts

# With demo fixture:
DEMO_MODE=true npx ts-node --project tsconfig.json scripts/testFetchers.ts
```

---

## What's Next

These features are scoped out of the MVP intentionally and are the natural next extensions:

- **Slack integration** — pull standup notes directly from a Slack channel instead of manual text input; post the brief back to the channel automatically
- **Email digest** — send the Situation Brief as a daily email to team leads
- **Multi-team support** — connect multiple Notion databases and GitHub repos under a single workspace, with per-team briefs
- **Decision log** — track surfaced decisions over time so the team can see what was resolved and what was deferred
- **Persistent storage** — store briefs in a database so the team can review history and track whether blockers were resolved
- **Automated scheduling** — run the pipeline on a schedule (daily at 9am) rather than requiring a manual trigger

---

## Pre-Submission Checklist

- [ ] IBM SkillsBuild learning activity completed
- [ ] GitHub repository set to Public (not Private) — [github.com/shabanakausar/StandupSense-](https://github.com/shabanakausar/StandupSense-)
- [ ] Demo video recorded (≤3 minutes) and publicly accessible
- [ ] Submission page published with team details + GitHub link + video link
- [ ] Notion test data reseeded with realistic near-term dates (not the original 600+ day placeholder values)
- [ ] Confirmed GitHub fetcher returns real PR/branch data (run with live credentials and check `[fetch] github:` log line — should be > 0)
- [ ] Confirmed which narrative source (Granite/OpenAI/rule-based) is actually firing — check server logs for `[graniteClient]` lines after next run
