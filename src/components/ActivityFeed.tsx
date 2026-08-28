import type { NormalizedActivity } from "@/types";

interface ActivityFeedProps {
  activities: NormalizedActivity[];
}

const SOURCE_LABEL: Record<string, string> = {
  notion: "NOTION",
  github: "GITHUB",
};

export default function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <details
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      {/* summary bar — matches mockup exactly */}
      <summary style={{
        cursor: "pointer",
        padding: "14px 18px",
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        color: "var(--fog)",
        background: "var(--slate)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        raw activity feed [{activities.length}]
        {/* Chevron icon */}
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ transition: "transform 0.15s" }}
          className="feed-chev"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>

      {/* Feed rows */}
      {activities.length === 0 && (
        <div style={{ padding: "12px 18px", background: "var(--slate-2)", borderTop: "1px solid var(--hairline)", fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fog)" }}>
          — no activity data —
        </div>
      )}
      {activities.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px",
            borderTop: "1px solid var(--hairline)",
            background: "var(--slate-2)",
            fontSize: 13,
          }}
        >
          {/* feed-source badge */}
          <span style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--fog)",
            background: "var(--ink)",
            border: "1px solid var(--hairline)",
            padding: "2px 7px",
            borderRadius: 5,
            flexShrink: 0,
            width: 58,
            textAlign: "center",
          }}>
            {SOURCE_LABEL[a.source] ?? a.source.toUpperCase()}
          </span>

          {/* feed-title */}
          <span style={{ flex: 1, color: "var(--paper)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.title}
          </span>

          {/* feed-status */}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fog)", flexShrink: 0 }}>
            {a.status.replace(/_/g, "_")}
          </span>

          {/* feed-link */}
          <a
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--signal)", textDecoration: "none", fontSize: 12, flexShrink: 0 }}
          >
            ↗
          </a>
        </div>
      ))}
    </details>
  );
}
