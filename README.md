# StandupSense

**IBM AI Builders Challenge — Wild Card Theme: AI Co-workers / Workflow Orchestration / Decision Intelligence**
# StandupSense

**Honest team status, powered by real data — not standup optimism.**

Built with IBM Bob for the IBM AI Builders Challenge — Wild Card Theme.

---

## Problem Statement

Small teams and startups run daily or weekly standups where status updates are often optimistic rather than accurate. A task marked "basically done" might not have moved in days. A decision that needs to be made can sit unresolved in a pull request comment for a week without anyone noticing. Nobody catches this gap — large companies have a Chief of Staff or Operations team to track it; small teams have nothing.

The result: talented people doing important work, falling behind not because of skill, but because of coordination blind spots that nobody is actively watching.

## Solution Description

StandupSense is an AI Chief of Staff for small teams. It connects directly to **Notion** (tasks) and **GitHub** (pull requests, code activity) — not self-reported status — and:

1. Detects real blockers using deterministic rules (overdue tasks, stale pull requests, unresolved dependencies)
2. Optionally compares this against a team's own standup notes to surface the gap between what was *reported* and what the data *shows*
3. Uses **IBM Granite** to write a plain-language summary and highlight the single most important decision the team needs to resolve today
4. Surfaces everything in a clean dashboard — including a direct link back to the real Notion task or GitHub PR behind every risk

## AI Approach and Architecture

StandupSense is built around one deliberate design decision: **blocker detection is deterministic, AI narration is separate.**

```
Notion Fetcher ──┐
                 ├──▶ Normalizer ──▶ Blocker Detector ──▶ chain.ts assembly ──▶ BriefOutput
GitHub Fetcher ──┘         │            (rule-based,           │
                            │             no AI)                │
                            │                                   │
                     Standup Notes ──────────▶ Granite Reasoning ┘
                     (optional)              (summary +
                                              reportedVsReal
                                              ONLY)
```

**Why this separation matters:** the AI never generates the list of risks or the flagged decision — those come exclusively from deterministic rules run against real Notion and GitHub data (overdue dates, stale PRs, missing reviews, open dependencies). IBM Granite's only responsibility is writing two pieces of plain-language narrative on top of facts that are already established: a summary, and a comparison between reported status and actual data. This means the system can never hallucinate a blocker that doesn't exist — the AI is the narrator, not the source of truth.

**Reliability chain:** every brief generation attempts IBM Granite first, falls back to an alternate model if Granite is unavailable, and falls back again to a rule-based template if both AI paths fail — so a usable brief is always produced, even during an API outage.

### Blocker Detection Rules

| Rule | Source | Trigger | Severity |
|---|---|---|---|
| `STALE_TASK` | Notion | In progress, not updated in 3+ days | Medium |
| `AT_RISK_DUE` | Notion | Due within 2 days, not done | High |
| `PAST_DUE` | Notion | Due date passed, not done | High |
| `OPEN_DEPENDENCY` | Notion | Blocked by an incomplete dependency | High |
| `NO_PR_REVIEW` | GitHub | PR open 48+ hours, no review | Medium |
| `PR_STUCK` | GitHub | Changes requested, no new commits in 48h | High |
| `STALE_BRANCH` | GitHub | No commits in 7+ days, not merged | Low |
| `CROSS_SYSTEM_MISMATCH` | Both | Notion task references GitHub work with no matching PR | Medium |

## Selected Challenge Theme

**Wild Card Theme** — AI co-workers, workflow orchestration, and decision intelligence.

## How IBM Bob Was Used

This project was built end-to-end with IBM Bob, across its full development lifecycle:

- **Plan mode** — architecting the pipeline, defining the normalized data schema shared between Notion and GitHub, and identifying the highest-risk technical unknowns before writing any code
- **Code mode** — implementing both API fetchers, the deterministic blocker-detection engine, the IAM token manager for watsonx authentication, the Granite client with its fallback chain, the LangChain orchestration, and the full frontend dashboard
- **Iterative debugging** — Bob added structured logging throughout the pipeline (fetch counts per source, Granite/watsonx error details, IAM token lifecycle) that made it possible to diagnose and fix a series of real integration issues during development: an incorrectly formatted watsonx project ID, a missing service association between the project and its inference runtime, and an outdated model ID — each identified precisely from logs Bob added, not guessed at
- **Ask mode** — generating and refining this README

## Tech Stack

- **Frontend:** Next.js (App Router) + React + Tailwind CSS
- **AI:** IBM Granite (`ibm/granite-4-h-small`) via watsonx.ai Runtime
- **Orchestration:** LangChain (`RunnableSequence`)
- **Data sources:** Notion API, GitHub REST API (via Octokit)
- **Dev environment:** IBM Bob

## Demo Scenario

To demonstrate StandupSense with realistic data, this project is connected to a sample team working on a website redesign, tracked across Notion (tasks) and GitHub (code).

**Sample standup notes used:**
```
Payment integration / checkout is basically done, just polishing.
Website redesign is moving along fine, should wrap up soon.
No blockers to flag today.
```

**What the connected data actually shows:**
- The website redesign task is overdue and still marked "in progress"
- An unresolved decision — whether to use Stripe or Paddle for payments — is sitting in an open, unmerged pull request, never mentioned in standup

**What StandupSense surfaces:** a clear, plain-language gap analysis identifying both issues, plus a direct link back to the real GitHub PR containing the unresolved decision.

## Setup Instructions

### 1. Clone and install

```bash
git clone <this-repo-url>
cd standupsense
npm install
```

### 2. Notion setup

1. Create an Internal Integration at `notion.so/my-integrations` (now labeled "Connections")
2. Enable both **Read content** and **Read comments** capabilities
3. Share your target database with the integration (database `•••` menu → Connections)
4. Copy your database ID from its URL

### 3. GitHub setup

Generate a **classic PAT** with `repo` scope (private repos) or `public_repo` scope (public repos), or a **fine-grained PAT** with `Contents: Read-only` + `Pull requests: Read-only` permissions.

### 4. watsonx setup

1. Create a project at `dataplatform.cloud.ibm.com`
2. Associate a **watsonx.ai Runtime** service instance with your project (Manage → Services & integrations → Associate service) — this step is required and easy to miss; a project without this returns a `403` error on every Granite call
3. Generate an API key at `cloud.ibm.com/iam/apikeys`
4. Confirm your available model ID via Prompt Lab or the `foundation_model_specs` endpoint — model availability varies by account and region

### 5. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NOTION_TOKEN=
NOTION_DATABASE_ID=
NOTION_STATUS_PROP=Status
NOTION_DUE_DATE_PROP=Due date
NOTION_ASSIGNEE_PROP=Assignee

GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=

WATSONX_API_KEY=
WATSONX_PROJECT_ID=
WATSONX_URL=https://us-south.ml.cloud.ibm.com
WATSONX_MODEL_ID=ibm/granite-4-h-small

DEMO_MODE=false
```

### 6. Run

```bash
npm run dev
```

Open `http://localhost:3000`, paste in standup notes (optional), and click **Generate brief**.

## What's Next

- **Slack integration** — surface decisions and blockers from team chat, not just PRs and tasks
- **Gmail integration** — detect unanswered client emails and stale external threads as a third blocker source, extending the same deterministic-detection-plus-AI-narrative architecture to unstructured communication data
- **Multi-team support** — currently scoped to a single workspace; next step is per-team configuration

