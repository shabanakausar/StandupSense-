import { getIAMToken } from "@/lib/tokenManager";
import { parseNarrativeResponse } from "@/lib/briefFormatter";
import type { BlockerDetectionResult, NarrativeResult } from "@/types";

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt for the narrative generation call.
 *
 * Granite's scope is deliberately narrow: it receives the standup notes and
 * the already-computed blocker list as READ-ONLY context and returns exactly
 * two free-text fields. It does NOT regenerate topRisks or topDecision —
 * those come from blockerDetector.ts and are merged in chain.ts.
 *
 * This separation prevents schema drift: url, activityId, and source fields
 * on DetectedBlocker/SurfacedDecision are always from the detector, never
 * from an LLM that might paraphrase them differently or drop them.
 */
const SYSTEM_PROMPT = `You are a sharp, calm chief of staff. You do not use filler language.

You have been given:
1. The team's self-reported standup notes (what they said is happening)
2. A structured list of blockers and risks already detected from real system data
   (Notion task activity and GitHub PR/commit data)

Do NOT restate, reformat, or regenerate the blocker list or decision item.
That work is already done. Your only job is to write two things:

(a) summary — a 3-4 sentence honest assessment of where the team actually stands.
    Be specific: cite task names and PR numbers from the blocker data.
    Do not be harsh, do not be optimistic. Just be accurate.

(b) reportedVsReal — one paragraph analyzing the gap between what the team
    reported in standup and what the data actually shows. If the standup notes
    are consistent with the data, say so plainly. If they are not, name the
    specific discrepancies without editorializing.

Output valid JSON with exactly these two keys and no others:
{ "summary": "...", "reportedVsReal": "..." }`;

// ─── Payload builder ──────────────────────────────────────────────────────────

function buildPromptBody(
  standupNotes: string,
  detectionResult: BlockerDetectionResult
): string {
  const blockerLines = detectionResult.blockers
    .map(
      (b, i) =>
        `${i + 1}. [${b.severity.toUpperCase()}] ${b.activityTitle} — ${b.reason}`
    )
    .join("\n");

  const decisionLine = detectionResult.topDecision
    ? `Open decision: "${detectionResult.topDecision.question}" (from "${detectionResult.topDecision.activityTitle}")`
    : "No open decisions detected.";

  return [
    `STANDUP NOTES:\n${standupNotes || "(no standup notes provided)"}`,
    `\nDETECTED BLOCKERS (${detectionResult.blockers.length} total):\n${blockerLines || "(none)"}`,
    `\n${decisionLine}`,
  ].join("\n");
}

// ─── Granite (watsonx) call ───────────────────────────────────────────────────

async function callGranite(
  standupNotes: string,
  detectionResult: BlockerDetectionResult
): Promise<string> {
  const watsonxUrl = process.env.WATSONX_URL;
  const projectId = process.env.WATSONX_PROJECT_ID;
  const modelId = process.env.WATSONX_MODEL_ID ?? "ibm/granite-4-h-small";

  if (!watsonxUrl || !projectId) {
    throw new Error(
      "WATSONX_URL and WATSONX_PROJECT_ID must be set in .env.local."
    );
  }

  console.log("[graniteClient] Fetching IAM token…");
  const iamToken = await getIAMToken();
  console.log("[graniteClient] IAM token acquired. Calling watsonx endpoint…");

  const promptBody = buildPromptBody(standupNotes, detectionResult);

  // Granite 4 (granite-4-h-small) uses the /text/chat endpoint with messages[].
  // Granite 3 and older use /text/generation with a single input string.
  // We detect by model ID prefix and route accordingly.
  const isGranite4 = modelId.includes("granite-4");

  let response: Response;

  if (isGranite4) {
    const endpoint = `${watsonxUrl}/ml/v1/text/chat?version=2023-05-29`;
    console.log(`[graniteClient] Using chat endpoint for ${modelId}`);
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${iamToken}`,
      },
      body: JSON.stringify({
        model_id: modelId,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: promptBody },
        ],
        parameters: {
          decoding_method: "greedy",
          max_new_tokens: 600,
          repetition_penalty: 1.1,
        },
        project_id: projectId,
      }),
    });
  } else {
    const endpoint = `${watsonxUrl}/ml/v1/text/generation?version=2023-05-29`;
    console.log(`[graniteClient] Using generation endpoint for ${modelId}`);
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${promptBody}`;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${iamToken}`,
      },
      body: JSON.stringify({
        model_id: modelId,
        input: fullPrompt,
        parameters: {
          decoding_method: "greedy",
          max_new_tokens: 600,
          repetition_penalty: 1.1,
        },
        project_id: projectId,
      }),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    console.error(
      `[graniteClient] watsonx HTTP ${response.status} — model: ${modelId}`,
      `\nResponse body: ${body}`
    );
    throw new Error(
      `watsonx API returned HTTP ${response.status}. ` +
        `Model: ${modelId}. Response: ${body}`
    );
  }

  const data = await response.json();

  // Chat endpoint: { choices: [{ message: { content: string } }] }
  // Generation endpoint: { results: [{ generated_text: string }] }
  const generated: string | undefined = isGranite4
    ? data?.choices?.[0]?.message?.content
    : data?.results?.[0]?.generated_text;

  if (!generated) {
    throw new Error(
      "watsonx response did not contain generated text. " +
        `Raw response: ${JSON.stringify(data)}`
    );
  }

  return generated;
}

// ─── OpenAI fallback call ─────────────────────────────────────────────────────

async function callOpenAI(
  standupNotes: string,
  detectionResult: BlockerDetectionResult
): Promise<string> {
  // Dynamic import so the openai package is only loaded if actually needed
  console.log("[graniteClient] Attempting OpenAI fallback (gpt-4o-mini)…");
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const promptBody = buildPromptBody(standupNotes, detectionResult);

  const completion = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: promptBody },
    ],
    max_tokens: 600,
    temperature: 0.3,
    response_format: { type: "json_object" },
  });

  return completion.choices[0]?.message?.content ?? "";
}

// ─── Rule-based fallback ──────────────────────────────────────────────────────

/**
 * Generates template narrative from the blocker data alone — no LLM involved.
 * Called when both Granite and OpenAI fail or are unavailable.
 *
 * Returns the same { summary, reportedVsReal } shape so chain.ts assembly
 * is identical across all three paths.
 */
function buildRuleBasedNarrative(
  detectionResult: BlockerDetectionResult
): { summary: string; reportedVsReal: string } {
  const { blockers, topDecision } = detectionResult;

  if (blockers.length === 0) {
    return {
      summary:
        "No blockers or risks were detected in the current activity data. " +
        "All tracked tasks and pull requests appear to be progressing normally.",
      reportedVsReal:
        "The standup notes could not be analyzed automatically. " +
        "No discrepancies were detected based on available data.",
    };
  }

  const highCount = blockers.filter((b) => b.severity === "high").length;
  const topItems = blockers
    .slice(0, 3)
    .map((b) => `"${b.activityTitle}" (${b.reason})`)
    .join("; ");

  const summary =
    `The team has ${blockers.length} active blocker(s), ` +
    `${highCount} of which are high severity. ` +
    `Top items: ${topItems}. ` +
    (topDecision
      ? `An unresolved decision is pending on "${topDecision.activityTitle}".`
      : "No open decisions were detected.");

  const reportedVsReal =
    "Automated analysis flagged risks that may not have been reflected in standup notes. " +
    `${highCount > 0 ? `${highCount} high-severity issue(s) require immediate attention. ` : ""}` +
    "Manual review of the activity feed is recommended for full context.";

  return { summary, reportedVsReal };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generates the two free-text narrative fields for the Situation Brief.
 *
 * Tries three paths in order:
 * 1. IBM Granite via watsonx (source: "granite")
 * 2. OpenAI gpt-4o-mini if OPENAI_API_KEY is set (source: "openai")
 * 3. Rule-based template if both LLMs fail (source: "rule-based")
 *
 * Each path sets source directly — chain.ts never has to infer which ran.
 *
 * Granite does NOT generate topRisks or topDecision. Those are passed through
 * unchanged from blockerDetector.ts and merged in chain.ts.
 */
export async function generateNarrative(
  standupNotes: string,
  detectionResult: BlockerDetectionResult
): Promise<NarrativeResult> {
  // ── Path 1: Granite ────────────────────────────────────────────────────────
  if (process.env.WATSONX_API_KEY) {
    console.log("[graniteClient] WATSONX_API_KEY present — attempting Granite path.");
    try {
      const rawText = await callGranite(standupNotes, detectionResult);
      console.log("[graniteClient] Granite call succeeded.");
      return parseNarrativeResponse(rawText, "granite");
    } catch (err) {
      console.error(
        "[graniteClient] Granite call FAILED — falling through to OpenAI fallback.",
        err
      );
    }
  } else {
    console.warn("[graniteClient] WATSONX_API_KEY is not set — skipping Granite path.");
  }

  // ── Path 2: OpenAI ────────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    console.log("[graniteClient] OPENAI_API_KEY present — attempting OpenAI fallback.");
    try {
      const rawText = await callOpenAI(standupNotes, detectionResult);
      console.log("[graniteClient] OpenAI fallback succeeded.");
      return parseNarrativeResponse(rawText, "openai");
    } catch (err) {
      console.error(
        "[graniteClient] OpenAI fallback FAILED — falling through to rule-based.",
        err
      );
    }
  } else {
    console.warn("[graniteClient] OPENAI_API_KEY is not set — skipping OpenAI fallback.");
  }

  // ── Path 3: Rule-based ────────────────────────────────────────────────────
  console.warn(
    "[graniteClient] All LLM paths unavailable — using rule-based narrative."
  );
  const { summary, reportedVsReal } =
    buildRuleBasedNarrative(detectionResult);
  return { summary, reportedVsReal, source: "rule-based" };
}
