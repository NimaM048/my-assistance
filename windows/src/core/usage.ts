// How close Claude Code and Codex are to their usage limits, from the local
// logs Rust reads (src-tauri/src/usage.rs). Mochi gets more tired the closer
// it gets, and naps — with a countdown — when the limit is hit.
//
// Only refreshed while the island is on screen, so a hidden island stays idle.

import { Bridge, type UsageSnapshot } from "./bridge";

export interface UsageBar {
  /** 0…1, or null when there is nothing to compare against yet. */
  pct: number | null;
  /** True when pct is a guess (Claude) rather than the provider's own number (Codex). */
  estimate: boolean;
  todayTokens: number;
  resetsAt: number | null;
  /** Codex also has a weekly window. */
  weeklyPct?: number | null;
  weeklyResetsAt?: number | null;
}

export interface UsageView {
  claude: UsageBar | null;
  codex: UsageBar | null;
  /** 0…1 — how worn out Mochi looks. */
  tired: number;
  /** A limit that's been hit and when it lifts. */
  limit: { source: "claude" | "codex"; resetsAt: number | null } | null;
}

/** Local midnight, in ms — Rust has no idea what time zone you're in. */
export function localMidnight(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Claude Code says when a limit lifts as "3pm", "3:30pm (Europe/Paris)",
 * "15:00" or a unix time. Returns the next such moment after `after`.
 */
export function parseResetHint(hint: string | null | undefined, after: number): number | null {
  if (!hint) return null;
  const trimmed = hint.trim();
  if (/^\d{9,13}$/.test(trimmed)) {
    const n = Number(trimmed);
    return n < 1e11 ? n * 1000 : n;
  }
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(trimmed);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const d = new Date(after);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= after) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Turns the raw snapshot into bars, tiredness and an active limit. */
export function viewOf(s: UsageSnapshot | null, now = Date.now()): UsageView {
  let claude: UsageBar | null = null;
  let codex: UsageBar | null = null;
  let limit: UsageView["limit"] = null;

  if (s?.claude) {
    const c = s.claude;
    const running = c.blockResetsAt != null && c.blockResetsAt > now;
    // The busiest window of the last week stands in for the limit; a window
    // that is already busier than that is "nearly there", never "over".
    const pct = running && c.blockPeak > 0 ? Math.min(0.97, c.blockTokens / Math.max(c.blockPeak, c.blockTokens * 1.03)) : running ? null : 0;
    claude = { pct, estimate: true, todayTokens: c.todayTokens, resetsAt: running ? c.blockResetsAt : null };
    if (c.limitHitAt != null) {
      const resetsAt = parseResetHint(c.limitResetHint, c.limitHitAt) ?? c.blockResetsAt ?? null;
      if (resetsAt == null || resetsAt > now) {
        limit = { source: "claude", resetsAt };
        claude.pct = 1;
        claude.resetsAt = resetsAt;
      }
    }
  }

  if (s?.codex) {
    const x = s.codex;
    const primaryLive = x.primary && (x.primary.resetsAt == null || x.primary.resetsAt > now);
    const weeklyLive = x.secondary && (x.secondary.resetsAt == null || x.secondary.resetsAt > now);
    codex = {
      pct: primaryLive ? Math.min(1, x.primary!.usedPercent / 100) : x.primary ? 0 : null,
      estimate: false,
      todayTokens: x.todayTokens,
      resetsAt: primaryLive ? x.primary!.resetsAt : null,
      weeklyPct: weeklyLive ? Math.min(1, x.secondary!.usedPercent / 100) : x.secondary ? 0 : null,
      weeklyResetsAt: weeklyLive ? x.secondary!.resetsAt : null,
    };
    if (!limit) {
      if (primaryLive && x.primary!.usedPercent >= 100) limit = { source: "codex", resetsAt: x.primary!.resetsAt };
      else if (weeklyLive && x.secondary!.usedPercent >= 100) limit = { source: "codex", resetsAt: x.secondary!.resetsAt };
    }
  }

  // Tired from about half-way up; the estimate counts a little less than the real thing.
  const level = Math.max(
    (claude?.pct ?? 0) * 0.85,
    codex?.pct ?? 0,
    (codex?.weeklyPct ?? 0) * 0.9,
  );
  const tired = limit ? 1 : Math.max(0, Math.min(1, (level - 0.5) / 0.45));
  return { claude, codex, tired, limit };
}

/** "1.2M", "830k", "950". */
export function tokensLabel(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}

/** "2h 14m", "38m", "45s". */
export function countdownLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Keeps a fresh snapshot while the island is visible. */
export class UsageWatcher {
  snapshot: UsageSnapshot | null = null;
  private timer: number | null = null;
  private inflight = false;
  private lastFetch = 0;

  constructor(private onChange: () => void) {}

  async refresh(force = false) {
    if (this.inflight || (!force && Date.now() - this.lastFetch < 15_000)) return;
    this.inflight = true;
    try {
      const snap = await Bridge.usageSnapshot(localMidnight());
      this.lastFetch = Date.now();
      if (snap) {
        this.snapshot = snap;
        this.onChange();
      }
    } finally {
      this.inflight = false;
    }
  }

  /** On while the island is on screen, off while it's hidden. */
  setActive(on: boolean) {
    if (on && this.timer == null) {
      void this.refresh();
      this.timer = window.setInterval(() => void this.refresh(), 60_000);
    } else if (!on && this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
