import type { DetectedBlocker } from "@/types";

const SEV_STYLE: Record<DetectedBlocker["severity"], { text: string; bg: string; label: string }> = {
  high:   { text: "var(--high-text)", bg: "var(--high-bg)", label: "high" },
  medium: { text: "var(--med-text)",  bg: "var(--med-bg)",  label: "medium" },
  low:    { text: "var(--low-text)",  bg: "var(--low-bg)",  label: "low" },
};

const SOURCE_LABELS: Record<string, string> = {
  notion: "Notion",
  github: "GitHub",
};

export default function BlockerCard({ blocker }: { blocker: DetectedBlocker }) {
  const s = SEV_STYLE[blocker.severity];

  return (
    <div style={{
      background: "var(--slate)",
      border: "1px solid var(--hairline)",
      borderRadius: 12,
      padding: "16px 18px",
    }}>
      {/* risk-top */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {/* severity-badge */}
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          padding: "2px 8px",
          borderRadius: 5,
          background: s.bg,
          color: s.text,
        }}>
          {s.label}
        </span>
        {/* risk-type */}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fog)" }}>
          {SOURCE_LABELS[blocker.source] ?? blocker.source} · {blocker.type}
        </span>
      </div>

      {/* risk-title */}
      <p style={{ fontSize: 14.5, fontWeight: 500, margin: "0 0 6px", lineHeight: 1.4 }}>
        {blocker.activityTitle}
      </p>

      {/* risk-reason */}
      <p style={{ fontSize: 13, color: "var(--fog)", lineHeight: 1.55, margin: "0 0 12px" }}>
        {blocker.reason}
      </p>

      {/* risk-action row */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        fontSize: 12.5,
        color: "var(--paper)",
        borderTop: "1px solid var(--hairline)",
        paddingTop: 10,
      }}>
        {/* Arrow icon from mockup */}
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--signal)" strokeWidth="2"
          style={{ flexShrink: 0, marginTop: 2, width: 12, height: 12 }}>
          <path d="M5 12h14M12 5l7 7-7 7" />
        </svg>
        {blocker.suggestedAction}
      </div>

      {/* risk-view link */}
      <a
        href={blocker.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "inline-block", marginTop: 10, fontSize: 12, color: "var(--signal)", textDecoration: "none" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
      >
        View in {SOURCE_LABELS[blocker.source] ?? blocker.source} →
      </a>
    </div>
  );
}
