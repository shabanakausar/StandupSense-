"use client";

import { useState } from "react";
import type { BriefOutput } from "@/types";
import StandupInput from "@/components/StandupInput";
import BriefDisplay from "@/components/BriefDisplay";
import SignalLine from "@/components/SignalLine";

export default function Home() {
  const [standupNotes, setStandupNotes] = useState("");
  const [brief, setBrief] = useState<BriefOutput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ standupNotes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setBrief((await res.json()) as BriefOutput);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  const hasHighSeverity = (brief?.topRisks ?? []).some((r) => r.severity === "high");

  return (
    <div style={{ background: "var(--ink)", color: "var(--paper)", minHeight: "100vh" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "40px 24px 64px" }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div className="brand">
            <h1 style={{ fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
              StandupSense
            </h1>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--fog)", margin: 0 }}>
              honest team status{" "}
              <span style={{ color: "var(--signal)", margin: "0 6px" }}>·</span>
              IBM Granite
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {brief && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fog)" }}>
                {new Date(brief.generatedAt).toLocaleTimeString()}
              </span>
            )}
            {brief && (
              <button
                onClick={handleGenerate}
                disabled={loading}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "transparent",
                  border: "1px solid var(--hairline-strong)",
                  color: "var(--paper)",
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  padding: "7px 14px",
                  borderRadius: "var(--radius)",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.5 : 1,
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  if (!loading) {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--slate)";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--signal-border)";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--hairline-strong)";
                }}
              >
                {/* Refresh icon from mockup */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <path d="M1 4v6h6M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
                {loading ? "refreshing…" : "refresh"}
              </button>
            )}
          </div>
        </header>

        {/* ── Signal line ────────────────────────────────────────────────── */}
        <SignalLine key={brief?.generatedAt ?? "idle"} hasHighSeverity={hasHighSeverity} />

        {/* ── Input row (textarea + button side-by-side, mockup layout) ──── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
          <StandupInput
            value={standupNotes}
            onChange={setStandupNotes}
            loading={loading}
          />
          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{
              background: "var(--signal)",
              color: "#0A2622",
              border: "none",
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              fontWeight: 600,
              padding: "0 20px",
              borderRadius: "var(--radius)",
              cursor: loading ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
              opacity: loading ? 0.6 : 1,
              transition: "filter 0.15s",
            }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.filter = "brightness(1.08)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = ""; }}
          >
            {loading ? "generating…" : "Generate brief"}
          </button>
        </div>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {error && (
          <div style={{ background: "var(--high-bg)", border: "1px solid var(--high-text)", color: "var(--high-text)", borderRadius: "var(--radius)", padding: "12px 16px", fontSize: 14, marginBottom: 20 }}>
            <strong>Error: </strong>{error}
          </div>
        )}

        {/* ── Loading skeleton ───────────────────────────────────────────── */}
        {loading && !brief && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ height: 120, borderRadius: 12, background: "var(--signal-bg)", border: "1px solid var(--signal-border)", animation: "pulse 1.5s ease-in-out infinite" }} />
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 100, borderRadius: "var(--radius)", background: "var(--slate)", border: "1px solid var(--hairline)", animation: "pulse 1.5s ease-in-out infinite" }} />
            ))}
          </div>
        )}

        {/* ── Brief ──────────────────────────────────────────────────────── */}
        {brief && !loading && <BriefDisplay brief={brief} />}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--hairline)", fontSize: 12, color: "var(--fog)", textAlign: "center" }}>
          StandupSense · IBM AI Builders Challenge · Wild Card theme
        </footer>
      </div>
    </div>
  );
}
