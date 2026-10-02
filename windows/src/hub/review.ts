// End of the day with Mochi: what you did, how it felt, what comes first
// tomorrow. Two minutes, all on this PC. Tomorrow morning the island and the
// Focus page remind you of that first step.

import { h, clear } from "../views/dom";
import { createPortrait } from "../mochi/portrait";
import { awardXp } from "../mochi/growth";
import { MOODS, agentSessionsOn, dayKeyOf, reviewFor, reviewStore, saveReview, workDayKey } from "../core/review";
import type { FocusData, FocusTask } from "./types";

export interface ReviewHost {
  data(): FocusData;
  num(n: number): string;
  date(d: Date, o: Intl.DateTimeFormatOptions): string;
  /** The Focus page's calendar day key for a time. */
  dayKey(ts: number): string;
  /** Commits made today in your local clones, or null if none are known. */
  commitsToday(): number | null;
  /** Puts this task first tomorrow (creating it if it's new). */
  planFirst(title: string, taskId: string | null, dayKey: string): void;
  confetti(from: HTMLElement): void;
  toast(message: string): void;
  xpPop(from: HTMLElement, amount: number): void;
}

const MOOD_LABEL = ["Rough day", "Meh", "Okay", "Good day", "Great day!"];
const MOOD_EMOTE = ["shy", "pout", "curious", "happy", "celebrate"] as const;

export function openDayReview(host: ReviewHost) {
  if (document.querySelector(".rv-overlay")) return;
  // The working day rolls over at 5 am: a review at 1 am is about the evening before.
  const anchor = Date.now() - 5 * 3_600_000;
  const day = host.dayKey(anchor);
  const tomorrow = host.dayKey(anchor + 86_400_000);
  const reviewDay = workDayKey();
  const existing = reviewFor(reviewDay);
  const d = host.data();

  const isTask = (t: FocusTask) => t.kind !== "note";
  const done = d.tasks.filter((t) => isTask(t) && t.doneAt && host.dayKey(t.doneAt) === day).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  const sessions = d.sessions.filter((s) => host.dayKey(s.at) === day);
  const minutes = sessions.reduce((sum, s) => sum + s.minutes, 0);
  const agent = agentSessionsOn(dayKeyOf(anchor));
  const commits = host.commitsToday();
  const open = d.tasks
    .filter((t) => isTask(t) && !t.doneAt && (!t.scheduledFor || t.scheduledFor <= tomorrow))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.order ?? 0) - (b.order ?? 0))
    .slice(0, 5);

  let mood: number | null = existing?.mood ?? null;
  let firstTaskId: string | null = existing?.firstTaskId ?? null;

  const mochi = createPortrait({ size: 96, overhang: 30, padX: 40, follow: true, dance: true, outfit: "worn", label: "Mochi" });
  const stage = h("div", { class: "rv-mochi" });
  mochi.mount(stage);

  const close = () => overlay.remove();

  const stat = (emoji: string, value: string, label: string, sub?: string) =>
    h("div", { class: "rv-stat" },
      h("span", { class: "rv-stat-emoji", "aria-hidden": "true", text: emoji }),
      h("strong", { text: value }),
      h("span", { class: "rv-stat-label", text: label }),
      sub ? h("small", { text: sub }) : null);

  const stats = h("div", { class: "rv-stats" },
    stat("✅", host.num(done.length), done.length === 1 ? "task done" : "tasks done"),
    stat("⏱️", host.num(minutes), minutes === 1 ? "minute of focus" : "minutes of focus", sessions.length ? `🍅 × ${host.num(sessions.length)}` : undefined),
    stat("🤖", host.num(agent), agent === 1 ? "agent session" : "agent sessions"),
    stat("🌿", commits == null ? "—" : host.num(commits), commits === 1 ? "commit" : "commits"),
  );

  const doneList = h("div", { class: "rv-done" });
  if (done.length) {
    for (const t of done.slice(0, 6)) doneList.append(h("span", { class: "rv-done-chip" }, h("i", { "aria-hidden": "true", text: "✓" }), h("span", { text: t.title })));
    if (done.length > 6) doneList.append(h("span", { class: "rv-done-more" }, h("span", { text: `+${host.num(done.length - 6)}` })));
  } else {
    doneList.append(h("span", { class: "rv-empty", text: "Nothing ticked off today — and that's okay. Rest counts too." }));
  }

  // Mood.
  const moodRow = h("div", { class: "rv-moods", role: "radiogroup", "aria-label": "How did today feel?" });
  const moodLabel = h("span", { class: "rv-mood-label" });
  const paintMood = () => {
    moodRow.querySelectorAll<HTMLButtonElement>("button").forEach((b, i) => {
      b.classList.toggle("active", mood === i + 1);
      b.setAttribute("aria-checked", String(mood === i + 1));
    });
    moodLabel.textContent = mood ? MOOD_LABEL[mood - 1] : "";
  };
  MOODS.forEach((m, i) => moodRow.append(h("button", { role: "radio", title: MOOD_LABEL[i], "aria-label": MOOD_LABEL[i], text: m, onclick: () => {
    mood = i + 1;
    paintMood();
    mochi.engine.triggerEmote(MOOD_EMOTE[i]);
  } })));
  paintMood();

  const proud = h("input", { class: "rv-input", maxlength: "140", placeholder: "One thing that went well today…", value: existing?.proud ?? "" }) as HTMLInputElement;
  const first = h("input", { class: "rv-input", maxlength: "120", placeholder: "The first thing you'll do tomorrow", value: existing?.first ?? "" }) as HTMLInputElement;
  first.addEventListener("input", () => {
    // Typing something else unlinks the suggested task.
    const linked = open.find((t) => t.id === firstTaskId);
    if (linked && linked.title !== first.value.trim()) firstTaskId = null;
    paintChips();
  });
  const chips = h("div", { class: "rv-chips" });
  const paintChips = () => {
    clear(chips);
    for (const t of open) {
      chips.append(h("button", { class: `rv-chip${t.id === firstTaskId ? " active" : ""}`, onclick: () => {
        firstTaskId = t.id;
        first.value = t.title;
        paintChips();
        mochi.engine.triggerEmote("wink");
      } }, (t.priority ?? 0) >= 3 ? h("i", { class: "rv-chip-prio", "aria-hidden": "true" }) : null, h("span", { text: t.title })));
    }
  };
  paintChips();

  // The week, as moods.
  const week = h("div", { class: "rv-week", "aria-label": "Your week" });
  const days = reviewStore.read().days;
  for (let i = 6; i >= 0; i--) {
    const ts = anchor - i * 86_400_000;
    const key = dayKeyOf(ts);
    const r = days[key];
    week.append(h("span", { class: `rv-week-day${i === 0 ? " today" : ""}`, title: host.date(new Date(ts), { weekday: "long" }) },
      h("b", { text: r?.mood ? MOODS[r.mood - 1] : "·" }),
      h("small", { text: host.date(new Date(ts), { weekday: "narrow" }) })));
  }

  const saveBtn = h("button", { class: "rv-save" }, h("span", { text: "Good night, Mochi" }), h("span", { "aria-hidden": "true", text: " 🌙" })) as HTMLButtonElement;
  saveBtn.addEventListener("click", () => {
    const firstText = first.value.trim().replace(/\s+/g, " ");
    if (firstText) host.planFirst(firstText, firstTaskId, tomorrow);
    saveReview(reviewDay, { mood, proud: proud.value.trim(), first: firstText || null, firstTaskId, at: Date.now() });
    const xp = awardXp(10, "review", { key: `review:${reviewDay}` });
    mochi.engine.triggerEmote("sleepy");
    host.confetti(saveBtn);
    if (xp?.amount) host.xpPop(saveBtn, xp.amount);
    host.toast(firstText ? "Sleep well — tomorrow starts with a plan ✨" : "Sleep well — see you tomorrow ✨");
    window.setTimeout(close, 1100);
  });

  const card = h("section", { class: "rv-card", role: "dialog", "aria-modal": "true", "aria-label": "Your day with Mochi" },
    h("button", { class: "rv-close", title: "Close", "aria-label": "Close", text: "×", onclick: close }),
    h("header", { class: "rv-head" }, stage,
      h("div", {},
        h("div", { class: "eyebrow", text: "YOUR DAY WITH MOCHI" }),
        h("h2", { text: host.date(new Date(anchor), { weekday: "long", month: "long", day: "numeric" }) }),
        h("p", { text: existing ? "You already wrapped up today — change anything you like." : "Let's close the day gently." }))),
    stats,
    doneList,
    h("div", { class: "rv-section" }, h("label", { class: "rv-q", text: "How did today feel?" }), h("div", { class: "rv-mood-row" }, moodRow, moodLabel)),
    h("div", { class: "rv-section" }, h("label", { class: "rv-q", text: "What went well?" }), proud),
    h("div", { class: "rv-section" }, h("label", { class: "rv-q", text: "What comes first tomorrow?" }), first, chips),
    h("footer", { class: "rv-foot" }, week, h("div", { class: "rv-actions" },
      h("button", { class: "rv-later", text: "Later", onclick: close }), saveBtn)),
  );
  const overlay = h("div", { class: "rv-overlay" }, card);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });
  document.body.append(overlay);
  window.setTimeout(() => mochi.engine.triggerEmote(done.length || minutes ? "proud" : "happy"), 400);
  (mood ? first : moodRow.querySelector<HTMLElement>("button"))?.focus();
}
