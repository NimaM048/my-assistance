// Mochi's care coach: every so often it rests its eyes, drinks some water or
// stretches — and invites you to do it together. In the evening it offers to
// wrap up the day.
//
// It only counts time you're actually here (see core/activity): a long pause
// is already a break, so the clocks start over. It never interrupts an
// approval, a question, a file drop or (unless you ask) a focus session, and
// one reminder never follows another too closely.
//
// A 30-second timer is all it costs; it does nothing while you're away.

import { idleFor } from "../core/activity";
import { Bridge, broadcast } from "../core/bridge";
import { CARE, CARE_KINDS, carePrefs, type CareKind } from "../core/care";
import { reviewFor, workDayKey } from "../core/review";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { IslandViewName } from "../core/layout";
import type { BotEngine } from "../mochi/engine";
import { XP, awardXp } from "../mochi/growth";

export interface CareIsland {
  engine: BotEngine;
  show(): void;
  close(): void;
  pin(on: boolean): void;
  ensureRunning(): void;
}

/** Views that mean "you're in the middle of something" — never cover them. */
const BUSY_VIEWS: ReadonlySet<IslandViewName> = new Set(["approval", "question", "upload", "uploading", "choose", "prompt", "project", "mail", "settings", "greeting"]);

const TICK_MS = 30_000;
const MIN_GAP = 8 * 60_000;
const ACC_KEY = "coucou.care.acc";
type Acc = Record<(typeof CARE_KINDS)[number], number>;

export class CareCoach {
  /** Active minutes since each reminder last happened. */
  private acc: Acc = { eyes: 0, water: 0, stretch: 0 };
  private lastTick = Date.now();
  private lastShown = 0;
  private timers: number[] = [];

  constructor(private isl: CareIsland) {
    // Survive a restart of the app within the same session of work.
    try {
      const saved = JSON.parse(localStorage.getItem(ACC_KEY) ?? "null") as { at: number; acc: Acc } | null;
      if (saved && Date.now() - saved.at < 20 * 60_000) this.acc = { ...this.acc, ...saved.acc };
    } catch { /* fresh start */ }
    window.setInterval(() => this.tick(), TICK_MS);
    // The view went away without an answer (auto-close, a click elsewhere): that's a "later".
    State.subscribe(() => {
      const c = State.care;
      if (!c || (State.view === "care" && State.mode === "expanded")) return;
      // The island is still opening onto the reminder.
      if (Date.now() - c.startedAt < 1500) return;
      if (c.phase === "ask") this.later(c.kind, false);
      else if (c.phase === "doing") this.stop(false);
      else this.clear();
    });
  }

  private tick() {
    const now = Date.now();
    const minutes = Math.min(5, (now - this.lastTick) / 60_000);
    this.lastTick = now;
    const p = carePrefs.read();
    if (!p.enabled) return;

    const idle = idleFor();
    if (idle > 15 * 60_000) {
      // Away for a while: that was a break for the eyes and the back.
      this.acc.eyes = 0;
      this.acc.stretch = 0;
      if (idle > 45 * 60_000) this.acc.water = 0;
      this.save();
      return;
    }
    // A few quiet minutes might be reading; don't count them, don't nag.
    if (idle > 5 * 60_000) return;
    for (const k of CARE_KINDS) if (p[k] > 0) this.acc[k] += minutes;
    this.save();

    if (State.care || now - this.lastShown < MIN_GAP || this.busy()) return;
    if (!p.duringFocus && focusRunning()) return;

    // The evening review comes first, once a day.
    if (p.review && new Date().getHours() >= p.reviewHour && !reviewFor() && localStorage.getItem("coucou.review.nudged") !== workDayKey()) {
      localStorage.setItem("coucou.review.nudged", workDayKey());
      this.show("review");
      return;
    }
    let best: (typeof CARE_KINDS)[number] | null = null;
    let ratio = 1;
    for (const k of CARE_KINDS) {
      if (p[k] <= 0) continue;
      const r = this.acc[k] / p[k];
      if (r >= ratio) { ratio = r; best = k; }
    }
    if (best) this.show(best);
  }

  private busy(): boolean {
    if (State.paused || State.fileDragOver || State.pendingApproval) return true;
    if (State.mode === "expanded" && BUSY_VIEWS.has(State.view)) return true;
    const agent = State.tasks.find((t) => t.id === "integration_claude")?.state;
    return agent === "approval" || agent === "question";
  }

  /** Shows a reminder now (the playground uses this too). */
  show(kind: CareKind) {
    this.clearTimers();
    State.care = { kind, phase: "ask", startedAt: Date.now(), xp: 0 };
    this.lastShown = Date.now();
    this.isl.show();
    const e = this.isl.engine;
    if (kind === "eyes") e.triggerEmote("yawn");
    else if (kind === "water") e.triggerEmote("curious");
    else if (kind === "stretch") e.triggerEmote("stretch");
    else e.triggerEmote("sleepy");
    Sound.play("blip");
    this.isl.ensureRunning();
    // Unanswered for a minute and a half: ask again a bit later.
    this.later(kind, false, 90_000);
  }

  action(a: "start" | "done" | "later" | "skip" | "stop") {
    const c = State.care;
    if (!c) return;
    switch (a) {
      case "start": return this.start(c.kind);
      case "done": return c.kind === "review" ? this.openReview() : this.finish(c.kind);
      case "later": return this.later(c.kind, true);
      case "skip":
        if (c.kind !== "review") this.acc[c.kind] = 0;
        this.save();
        this.clear();
        this.isl.close();
        return;
      case "stop": return this.stop(true);
    }
  }

  private start(kind: CareKind) {
    const info = CARE[kind];
    if (!info.seconds) { this.finish(kind); return; }
    this.clearTimers();
    State.care = { kind, phase: "doing", startedAt: Date.now(), xp: 0 };
    this.isl.pin(true);
    State.notify();
    const e = this.isl.engine;
    const ms = info.seconds * 1000;
    const steps = info.steps ?? [];
    // Mochi does it with you, step by step.
    const moves: Record<string, string[]> = {
      eyes: ["lookAround", "sleepy", "wink"],
      stretch: ["stretch", "spin", "lookAround", "dance"],
    };
    const list = moves[kind] ?? [];
    steps.forEach((_, i) => {
      this.timers.push(window.setTimeout(() => {
        const m = list[i % Math.max(1, list.length)];
        if (m) e.triggerEmote(m as Parameters<BotEngine["triggerEmote"]>[0], ms / steps.length / 1000);
        this.isl.ensureRunning();
      }, (i * ms) / steps.length));
    });
    this.timers.push(window.setTimeout(() => this.finish(kind), ms));
  }

  private finish(kind: CareKind) {
    this.clearTimers();
    if (kind !== "review") this.acc[kind] = 0;
    this.save();
    const xp = awardXp(XP.care, "care", { capGroup: "care", dailyCap: 30 })?.amount ?? 0;
    State.care = { kind, phase: "done", startedAt: Date.now(), xp };
    this.isl.pin(false);
    const e = this.isl.engine;
    e.triggerEmote(kind === "water" ? "happy" : "love");
    if (kind === "water") e.emit("bubble", 10);
    else e.burst("sparkle", 10);
    Sound.play("approve");
    State.notify();
    this.isl.ensureRunning();
    this.timers.push(window.setTimeout(() => {
      if (State.care?.phase === "done") {
        this.clear();
        this.isl.close();
      }
    }, 2600));
  }

  /** Snooze: come back in about ten minutes of activity. */
  private later(kind: CareKind, close: boolean, delay = 0) {
    const apply = () => {
      if (State.care?.kind !== kind || State.care.phase !== "ask") return;
      const p = carePrefs.read();
      if (kind !== "review") this.acc[kind] = Math.max(0, p[kind] - 10);
      this.save();
      this.clear();
      if (close || delay) this.isl.close();
    };
    if (delay) this.timers.push(window.setTimeout(apply, delay));
    else apply();
  }

  private stop(close: boolean) {
    const c = State.care;
    if (!c) return;
    if (c.kind !== "review") this.acc[c.kind] = 0;
    this.save();
    this.isl.pin(false);
    this.clear();
    if (close) this.isl.close();
  }

  private openReview() {
    this.clear();
    this.isl.close();
    void Bridge.openHubWindow();
    // The Hub may still be loading: ask twice.
    broadcast("hub-open-review", {});
    window.setTimeout(() => broadcast("hub-open-review", {}), 1500);
  }

  private clear() {
    this.clearTimers();
    if (!State.care) return;
    State.care = null;
    State.notify();
  }

  private clearTimers() {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
  }

  private save() {
    try {
      localStorage.setItem(ACC_KEY, JSON.stringify({ at: Date.now(), acc: this.acc }));
    } catch { /* not important */ }
  }
}

function focusRunning(): boolean {
  try {
    const d = JSON.parse(localStorage.getItem("coucou.focus.v1") ?? "null") as { running?: boolean; mode?: string } | null;
    return !!d?.running && d.mode === "focus";
  } catch {
    return false;
  }
}
