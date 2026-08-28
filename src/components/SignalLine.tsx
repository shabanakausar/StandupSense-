/**
 * SignalLine — signature visual element.
 *
 * Prop: hasHighSeverity — when true renders the spike path from the mockup;
 * when false renders a flat calm line. Both animate draw-in on mount.
 *
 * SVG viewBox matches mockup exactly: "0 0 1160 40"
 * The spike path is lifted verbatim from the mockup's <path> element.
 */

interface SignalLineProps {
  hasHighSeverity: boolean;
}

// Flat line — calm baseline, no spikes
const FLAT_PATH =
  "M0,20 L1160,20";

// Spike path — verbatim from mockup HTML
const SPIKE_PATH =
  "M0,20 L300,20 C312,20 314,4 324,4 C334,4 338,36 348,36 C358,36 362,20 380,20 L640,20 C650,20 652,10 660,10 C668,10 670,30 678,30 C686,30 690,20 700,20 L1160,20";

export default function SignalLine({ hasHighSeverity }: SignalLineProps) {
  return (
    <div style={{ margin: "4px 0 28px" }}>
      <svg
        viewBox="0 0 1160 40"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 40, display: "block" }}
        aria-hidden="true"
      >
        <path
          // key on the path so React remounts it (restarting animation) when
          // severity changes between renders
          key={String(hasHighSeverity)}
          d={hasHighSeverity ? SPIKE_PATH : FLAT_PATH}
          className="signal-path"
        />
      </svg>
    </div>
  );
}
