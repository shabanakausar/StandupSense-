/**
 * StandupInput — just the textarea.
 * The Generate brief button lives in page.tsx next to it (input-row flex layout).
 */

interface StandupInputProps {
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
}

export default function StandupInput({ value, onChange, loading }: StandupInputProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      placeholder="Paste standup notes here (optional)"
      rows={2}
      style={{
        flex: 1,
        background: "var(--slate)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        color: "var(--paper)",
        fontFamily: "var(--font-sans)",
        fontSize: 14,
        padding: "12px 14px",
        minHeight: 44,
        resize: "none",
        outline: "none",
        transition: "border-color 0.15s",
      }}
      onFocus={(e) => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = "var(--signal-border)"; }}
      onBlur={(e)  => { (e.currentTarget as HTMLTextAreaElement).style.borderColor = "var(--hairline)"; }}
    />
  );
}
