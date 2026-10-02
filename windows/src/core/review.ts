// The end-of-day review and tomorrow's first step — kept on this PC, shared by
// the Hub (where you write it) and the island (which reminds you in the morning).

import { sharedStore } from "./shared";

export interface DayReview {
  /** 1 (rough) … 5 (great), or null if skipped. */
  mood: number | null;
  /** One thing that went well. */
  proud: string;
  /** What you said comes first tomorrow. */
  first: string | null;
  firstTaskId: string | null;
  at: number;
}

export interface ReviewState {
  days: Record<string, DayReview>;
}

export const reviewStore = sharedStore<ReviewState>("coucou.review.v1", () => ({ days: {} }), (raw) => ({
  days: raw.days && typeof raw.days === "object" ? raw.days : {},
}));

/** Local calendar day, YYYY-MM-DD. */
export function dayKeyOf(ts = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The working day a moment belongs to: it rolls over at 5 am, so a review written at 1 am counts for the evening before. */
export function workDayKey(ts = Date.now()): string {
  return dayKeyOf(ts - 5 * 3_600_000);
}

export function reviewFor(day = workDayKey()): DayReview | null {
  return reviewStore.read().days[day] ?? null;
}

export function saveReview(day: string, review: DayReview) {
  reviewStore.write((s) => {
    const days = { ...s.days, [day]: review };
    // Keep about two months.
    const keys = Object.keys(days).sort();
    while (keys.length > 62) delete days[keys.shift()!];
    return { days };
  });
}

/** What you planned to do first today (from last night's review), if anything. */
export function firstUpToday(): string | null {
  return lastNightsReview()?.first ?? null;
}

/** Last night's review (the one that planned today). */
export function lastNightsReview(): DayReview | null {
  return reviewFor(workDayKey(Date.now() - 86_400_000));
}

export const MOODS = ["😫", "😕", "😐", "🙂", "🤩"];

// ── Agent sessions per day (for the review) ───────────────────────────────────

const AGENT_KEY = "coucou.agent.days.v1";

/** Counts a finished Claude Code / Codex turn for today. */
export function countAgentSession() {
  try {
    const days = JSON.parse(localStorage.getItem(AGENT_KEY) ?? "{}") as Record<string, number>;
    const day = dayKeyOf();
    days[day] = (days[day] ?? 0) + 1;
    for (const k of Object.keys(days).sort().slice(0, -14)) delete days[k];
    localStorage.setItem(AGENT_KEY, JSON.stringify(days));
  } catch { /* not important */ }
}

export function agentSessionsOn(day = dayKeyOf()): number {
  try {
    return (JSON.parse(localStorage.getItem(AGENT_KEY) ?? "{}") as Record<string, number>)[day] ?? 0;
  } catch {
    return 0;
  }
}
