"use client";

import { useState } from "react";
import type { BriefOutput } from "@/types";
import BlockerCard from "@/components/BlockerCard";
import DecisionSurface from "@/components/DecisionSurface";
import ActivityFeed from "@/components/ActivityFeed";

const IS_DEV =
  typeof process !== "undefined" && process.env.NODE_ENV !== "production";

const NARRATIVE_LABELS: Record<string, string> = {
  granite:      "IBM Granite",
  openai:       "OpenAI fallback",
  "rule-based": "rule-based",
};

export default function BriefDisplay({ brief }: { brief: BriefOutput }) {
  const [activeTab, setActiveTab] = useState<"brief" | "gap">("brief");

  const modeLabel = NARRATIVE_LABELS[brief.narrativeSource] ?? "rule-based";
  const generatedAt = new Date(brief.generatedAt).toLocaleTimeString();

  return (
    <div>
      {/* ── mode-badge ────────────────────────────────────────────────────── */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fog)",
        background: "var(--slate-2)",
        border: "1px solid var(--hairline)",
        padding: "4px 10px",
        borderRadius: 999,
        marginBottom: 20,
      }}>
        {/* pulse dot */}
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--signal)", flexShrink: 0 }} />
        {modeLabel} · generated {generatedAt}
      </div>

      {/* ── Dev-only source diagnostic ────────────────────────────────────── */}
      {IS_DEV && brief.sourceCounts && (
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fog)",
          marginBottom: 16,
          opacity: 0.7,
        }}>
          Sources: Notion ({brief.sourceCounts.notion})
          {" · "}
          GitHub ({brief.sourceCounts.github})
        </div>
      )}

      {/* ── Decision surface ──────────────────────────────────────────────── */}
      {brief.topDecision && <DecisionSurface decision={brief.topDecision} />}

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, borderBottom: "1px solid var(--hairline)" }}>
        {(["brief", "gap"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: activeTab === tab ? "var(--paper)" : "var(--fog)",
              background: "none",
              border: "none",
              padding: "10px 4px",
              marginRight: 20,
              cursor: "pointer",
              position: "relative",
              // active underline via box-shadow trick since inline styles can't do ::after
              boxShadow: activeTab === tab ? "inset 0 -2px 0 var(--signal)" : "none",
            }}
          >
            {tab === "brief" ? "Situation brief" : "Reported vs. reality"}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────────── */}
      {activeTab === "brief" && (
        <div>
          {/* tab-content prose */}
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fog)", margin: "0 0 28px" }}>
            {brief.summary || "No summary generated."}
          </p>

          {/* section-label */}
          {brief.topRisks.length > 0 && (
            <>
              <h2 style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--fog)",
                margin: "0 0 14px",
                fontWeight: 400,
              }}>
                Top risks ({brief.topRisks.length})
              </h2>

              {/* risks-grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 14,
                marginBottom: 32,
              }}>
                {brief.topRisks.map((blocker) => (
                  <BlockerCard key={blocker.activityId} blocker={blocker} />
                ))}
              </div>
            </>
          )}

          {brief.topRisks.length === 0 && (
            <p style={{ fontSize: 14, color: "var(--fog)", fontStyle: "italic" }}>No blockers detected.</p>
          )}
        </div>
      )}

      {activeTab === "gap" && (
        <p style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fog)", margin: "0 0 28px" }}>
          {brief.reportedVsReal || "No gap analysis generated."}
        </p>
      )}

      {/* ── Activity feed ─────────────────────────────────────────────────── */}
      <ActivityFeed activities={brief.allActivities} />
    </div>
  );
}
