// Little health reminders — Mochi rests its eyes, drinks water and stretches
// with you. Preferences are shared by every window (Settings edits them, the
// island acts on them) and stay on this PC.

import { sharedStore } from "./shared";

export type CareKind = "eyes" | "water" | "stretch" | "review";

export interface CarePrefs {
  enabled: boolean;
  /** Minutes of activity between reminders; 0 turns that reminder off. */
  eyes: number;
  water: number;
  stretch: number;
  /** Also remind during a focus session (off: wait for the break). */
  duringFocus: boolean;
  /** Evening nudge to review the day, from this hour on (if you haven't yet). */
  review: boolean;
  reviewHour: number;
}

export const carePrefs = sharedStore<CarePrefs>("coucou.care.v1", () => ({
  enabled: true, eyes: 20, water: 60, stretch: 50, duringFocus: false, review: true, reviewHour: 18,
}), (p) => ({
  enabled: p.enabled !== false,
  eyes: clampMinutes(p.eyes, 20),
  water: clampMinutes(p.water, 60),
  stretch: clampMinutes(p.stretch, 50),
  duringFocus: p.duringFocus === true,
  review: p.review !== false,
  reviewHour: Number.isFinite(Number(p.reviewHour)) ? Math.max(15, Math.min(23, Math.round(Number(p.reviewHour)))) : 18,
}));

function clampMinutes(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n <= 0 ? 0 : Math.max(10, Math.min(180, Math.round(n)));
}

export interface CareInfo {
  emoji: string;
  title: string;
  sub: string;
  /** Guided seconds after "Start" (0 = just "Done"). */
  seconds: number;
  /** Steps shown during the guided part, evenly spaced. */
  steps?: string[];
  start: string;
}

export const CARE: Record<CareKind, CareInfo> = {
  eyes: {
    emoji: "👀", title: "Rest your eyes", sub: "Look at something far away — about six metres — for 20 seconds.",
    seconds: 20, steps: ["Look far away…", "Let your eyes go soft…", "Blink slowly…"], start: "Start 20 s",
  },
  water: {
    emoji: "💧", title: "Time for some water", sub: "A few sips — Mochi is having some too.",
    seconds: 0, start: "Done",
  },
  stretch: {
    emoji: "🙆", title: "Stretch with Mochi", sub: "Stand up for half a minute. Your back will thank you.",
    seconds: 30, steps: ["Reach up high", "Roll your shoulders", "Look left, then right", "Shake it out!"], start: "Let's go",
  },
  review: {
    emoji: "🌙", title: "Wrap up your day?", sub: "Two minutes with Mochi: what went well, and what comes first tomorrow.",
    seconds: 0, start: "Open the review",
  },
};

/** The reminders that repeat through the day (the review is once, in the evening). */
export const CARE_KINDS = ["eyes", "water", "stretch"] as const;

export const CARE_INTERVALS: Record<(typeof CARE_KINDS)[number], number[]> = {
  eyes: [0, 20, 30, 45],
  water: [0, 45, 60, 90],
  stretch: [0, 30, 50, 75],
};
