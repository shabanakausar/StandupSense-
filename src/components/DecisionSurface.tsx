import type { SurfacedDecision } from "@/types";

const SOURCE_LABELS: Record<string, string> = {
  notion: "Notion task",
  github: "GitHub PR",
};

export default function DecisionSurface({ decision }: { decision: SurfacedDecision }) {
  const sourceLabel = SOURCE_LABELS[decision.source] ?? decision.source;

  return (
    <div style={{
      background: "var(--signal-bg)",
      border: "1px solid var(--signal-border)",
      borderRadius: 12,
      padding: "22px 26px",
      marginBottom: 28,
    }}>
      {/* decision-label */}
      <p style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--signal)",
        margin: "0 0 6px",
      }}>
        Decision needed today
      </p>

      {/* decision-source */}
      <p style={{ fontSize: 13, color: "var(--fog)", margin: "0 0 12px" }}>
        {sourceLabel}: {decision.activityTitle}
      </p>

      {/* decision-question — largest text, weight 500 */}
      <p style={{ fontSize: 19, fontWeight: 500, lineHeight: 1.4, margin: "0 0 10px" }}>
        {decision.question}
      </p>

      {/* decision-context */}
      <p style={{ fontSize: 13, color: "var(--fog)", lineHeight: 1.6, margin: "0 0 14px" }}>
        {decision.context}
      </p>

      {/* decision-link */}
      <a
        href={decision.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 13,
          color: "var(--signal)",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
      >
        Open in {sourceLabel} →
      </a>
    </div>
  );
}
