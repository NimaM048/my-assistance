// Focus & tasks — the Hub page you keep open all day.
//
// Layout: a "Today" hero (greeting, progress ring, focus goal, streak, this
// week's focus), the task list (Today · Upcoming · Done · Notes) and a pomodoro
// with Mochi inside the ring. Mochi works with you while you focus, naps on
// your breaks, wears headphones when music plays and throws a party when a
// session ends.
//
// The page is built once per visit and then updated in place, so typing, the
// timer and Mochi never reset because a task changed.

import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import { createPortrait, type Portrait } from "../mochi/portrait";
import { music } from "../music/remote";
import { onMusicPrefs, readMusicPrefs, writeMusicPrefs } from "../music/prefs";
import { STATIONS, type StationId } from "../music/stations";
import type { GitHubRepository } from "../core/bridge";
import type { FocusData, FocusMode, FocusTask, Priority } from "./types";
import { XP, awardXp } from "../mochi/growth";
import { occasionFor } from "../mochi/occasions";
import { profileStore } from "../core/profile";
import { openOccasion } from "./occasion";

/** What the page needs from the rest of the Hub. */
export interface FocusHost {
  data(): FocusData;
  save(): void;
  repos(): GitHubRepository[];
  lang(): "en" | "fa";
  num(n: number): string;
  date(d: Date, o: Intl.DateTimeFormatOptions): string;
  clock(seconds: number): string;
  dayKey(ts: number): string;
  datePicker(item: FocusTask, kind: "task" | "note"): HTMLElement;
  capture(title: string, repo: string, kind: "task" | "note", note: string, scheduledFor: string | null): void;
  openCapture(kind: "task" | "note"): void;
  reminderRow(): HTMLElement;
  toast(message: string): void;
  confetti(from: HTMLElement): void;
  /** A floating "+10 XP" over an element. */
  xpPop(from: HTMLElement, amount: number): void;
  /** Opens the break arcade (only does something during a break). */
  openArcade(): void;
  notify(title: string, detail: string): void;
  activity(title: string, repo: string): void;
}

type Tab = "today" | "upcoming" | "done" | "notes";

const PRIORITY: Record<Priority, { label: string; short: string; color: string }> = {
  0: { label: "No priority", short: "", color: "#6b7280" },
  1: { label: "Low priority", short: "Low", color: "#6ec6ff" },
  2: { label: "Medium priority", short: "Medium", color: "#f2bb69" },
  3: { label: "High priority", short: "High", color: "#ff7a8a" },
};

const LENGTHS = [15, 25, 45, 60];
const DAY = 86_400_000;

// ── Page state (survives re-renders) ──────────────────────────────────────────

let host: FocusHost;
let tab: Tab = "today";
let composerPriority: Priority = 0;
let editingId: string | null = null;
let dragId: string | null = null;
let celebratedDay = "";
let heroMochi: Portrait | null = null;
let timerMochi: Portrait | null = null;
let lastTimerMood = "";
let musicWired = false;

// Elements of the current render.
let root: HTMLElement | null = null;
let greetKey = "";
const ui = {} as {
  hero: HTMLElement; celebrate: HTMLButtonElement;
  greetTitle: HTMLElement; greetSub: HTMLElement; dateLine: HTMLElement;
  ringProgress: SVGCircleElement; ringValue: HTMLElement; ringTotal: HTMLElement;
  focusValue: HTMLElement; goalValue: HTMLElement; goalFill: HTMLElement;
  streakValue: HTMLElement; streakFlame: HTMLElement;
  week: HTMLElement; weekTotal: HTMLElement;
  tabs: Record<Tab, HTMLButtonElement>; tabCounts: Record<Tab, HTMLElement>;
  list: HTMLElement; composer: HTMLElement; composerInput: HTMLInputElement; composerPrio: HTMLButtonElement;
  timer: HTMLElement; timerTitle: HTMLElement; timerState: HTMLElement; timerTime: HTMLElement;
  timerRing: SVGCircleElement; timerModes: Record<FocusMode, HTMLButtonElement>;
  startBtn: HTMLButtonElement; lengths: HTMLElement; focusOn: HTMLSelectElement;
  dots: HTMLElement; sessionsLabel: HTMLElement; mochiSlot: HTMLElement;
  musicBtn: HTMLButtonElement; stationSelect: HTMLSelectElement; autoMusic: HTMLButtonElement;
};

const RING_R = 84;
const RING_C = 2 * Math.PI * RING_R;
const HERO_R = 26;
const HERO_C = 2 * Math.PI * HERO_R;

// ── Helpers ───────────────────────────────────────────────────────────────────

const today = () => host.dayKey(Date.now());
const isTask = (t: FocusTask) => t.kind !== "note";
const doneOn = (t: FocusTask, day: string) => t.doneAt != null && host.dayKey(t.doneAt) === day;
const goal = () => host.data().goalMinutes ?? 120;
const orderOf = (t: FocusTask) => t.order ?? -t.createdAt;

function minutesOn(day: string): number {
  return host.data().sessions.filter((s) => host.dayKey(s.at) === day).reduce((sum, s) => sum + s.minutes, 0);
}

function lengthFor(mode: FocusMode): number {
  const d = host.data();
  return mode === "focus" ? d.focusMinutes : mode === "short" ? 5 : 15;
}

/** Days in a row (ending today, or yesterday if today is still empty) with focus or a finished task. */
function streak(): number {
  const d = host.data();
  const active = new Set<string>();
  for (const s of d.sessions) active.add(host.dayKey(s.at));
  for (const t of d.tasks) if (t.doneAt) active.add(host.dayKey(t.doneAt));
  let count = 0;
  let cursor = Date.now();
  if (!active.has(host.dayKey(cursor))) cursor -= DAY;
  while (active.has(host.dayKey(cursor))) {
    count++;
    cursor -= DAY;
  }
  return count;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 23) return "Good evening";
  return "Working late";
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function renderFocusPage(container: HTMLElement, h0: FocusHost) {
  host = h0;
  root = h("div", { class: "fx-page" }, buildHero(), h("div", { class: "fx-grid" }, buildTasks(), buildTimer()));
  container.append(root);
  refreshFocusPage();
}

/** Updates every part of the page from the data, without rebuilding it. */
export function refreshFocusPage() {
  if (!root?.isConnected) return;
  drawHero();
  drawTabs();
  drawList();
  drawTimer();
}

function buildHero(): HTMLElement {
  heroMochi ??= createPortrait({
    size: 78, overhang: 18, padX: 24, follow: true, dance: true, greet: true,
    idleMoods: ["wink", "lookAround", "whistle", "hop", "curious"],
    clickMoods: ["giggle", "love", "excited", "spin", "shy", "dance"],
    label: "Mochi",
  });
  const mochiSlot = h("div", { class: "fx-hero-mochi" });
  heroMochi.mount(mochiSlot);

  ui.dateLine = h("div", { class: "eyebrow fx-date" });
  ui.greetTitle = h("h2", { class: "fx-greet" });
  ui.greetSub = h("div", { class: "fx-greet-sub" });
  ui.celebrate = h("button", { class: "fx-celebrate", hidden: true, onclick: () => {
    const occ = occasionFor();
    if (occ) openOccasion(occ, host);
  } }, h("span", { text: "Celebrate" }), h("span", { "aria-hidden": "true", text: " ✨" })) as HTMLButtonElement;

  const ring = svgEl("svg", { viewBox: "0 0 64 64", class: "fx-mini-ring", "aria-hidden": "true" });
  ring.append(svgEl("circle", { cx: 32, cy: 32, r: HERO_R, class: "fx-mini-track" }));
  ui.ringProgress = svgEl("circle", { cx: 32, cy: 32, r: HERO_R, class: "fx-mini-progress" });
  ui.ringProgress.style.strokeDasharray = String(HERO_C);
  ring.append(ui.ringProgress);
  ui.ringValue = h("b");
  ui.ringTotal = h("small");

  ui.focusValue = h("b");
  ui.goalValue = h("span", { class: "fx-goal-value" });
  ui.goalFill = h("i", { class: "fx-meter-fill" });
  const goalStep = (delta: number) => {
    const d = host.data();
    d.goalMinutes = Math.max(25, Math.min(600, goal() + delta));
    host.save();
    drawHero();
  };

  ui.streakValue = h("b");
  ui.streakFlame = h("span", { class: "fx-flame", "aria-hidden": "true", text: "🔥" });

  ui.week = h("div", { class: "fx-week" });
  ui.weekTotal = h("span", { class: "fx-week-total" });

  ui.hero = h("section", { class: "fx-hero" },
    mochiSlot,
    h("div", { class: "fx-hero-copy" }, ui.dateLine, ui.greetTitle, ui.greetSub),
    h("div", { class: "fx-hero-stats" },
      h("div", { class: "fx-stat fx-stat-ring" },
        h("div", { class: "fx-ring-wrap" }, ring, h("div", { class: "fx-ring-label" }, ui.ringValue, ui.ringTotal)),
        h("div", { class: "fx-stat-copy" }, h("span", { class: "fx-stat-label", text: "Tasks done" }), h("small", { text: "today" })),
      ),
      h("div", { class: "fx-stat fx-stat-goal" },
        h("div", { class: "fx-stat-label-row" }, h("span", { class: "fx-stat-label", text: "Focus today" }),
          h("div", { class: "fx-goal-step" },
            h("button", { title: "Lower the daily goal", "aria-label": "Lower the daily goal", text: "−", onclick: () => goalStep(-15) }),
            h("button", { title: "Raise the daily goal", "aria-label": "Raise the daily goal", text: "+", onclick: () => goalStep(15) }),
          ),
        ),
        h("div", { class: "fx-goal-line" }, ui.focusValue, h("span", { class: "fx-goal-sep", text: "/" }), ui.goalValue, h("small", { text: "min" })),
        h("div", { class: "fx-meter" }, ui.goalFill),
      ),
      h("div", { class: "fx-stat fx-stat-week" },
        h("div", { class: "fx-stat-label-row" },
          h("span", { class: "fx-streak-line", title: "Days in a row with focus time or a finished task" }, ui.streakFlame, ui.streakValue, h("span", { class: "fx-stat-label", text: "day streak" })),
          ui.weekTotal,
        ),
        ui.week,
      ),
    ),
  );
  return ui.hero;
}

function buildTasks(): HTMLElement {
  const tabNames: [Tab, string, string][] = [
    ["today", "Today", ICONS.star], ["upcoming", "Upcoming", ICONS.clock],
    ["done", "Done", ICONS.check], ["notes", "Notes", ICONS.doc],
  ];
  ui.tabs = {} as Record<Tab, HTMLButtonElement>;
  ui.tabCounts = {} as Record<Tab, HTMLElement>;
  const tabs = h("div", { class: "fx-tabs", role: "tablist" });
  for (const [key, label, icon] of tabNames) {
    const count = h("span", { class: "fx-tab-count" });
    const btn = h("button", {
      class: "fx-tab", role: "tab",
      onclick: () => { tab = key; editingId = null; drawTabs(); drawList(); ui.composer.hidden = key === "done"; },
    }, svg(icon, 12), h("span", { text: label }), count) as HTMLButtonElement;
    ui.tabs[key] = btn;
    ui.tabCounts[key] = count;
    tabs.append(btn);
  }

  ui.composerInput = h("input", { id: "focus-task-input", class: "fx-compose-input", placeholder: "What needs your attention?", maxlength: "120", autocomplete: "off" }) as HTMLInputElement;
  ui.composerPrio = h("button", { class: "fx-prio-pick", title: "Priority", "aria-label": "Priority", onclick: () => {
    composerPriority = ((composerPriority + 1) % 4) as Priority;
    paintPrio(ui.composerPrio, composerPriority);
  } }, svg(ICONS.pin, 12)) as HTMLButtonElement;
  paintPrio(ui.composerPrio, composerPriority);
  const dateInput = h("input", { class: "fx-compose-date", type: "date", value: today(), title: "Due date", "aria-label": "Due date" }) as HTMLInputElement;
  const repoPicker = h("select", { class: "fx-compose-repo", title: "Attach to a repository", "aria-label": "Project" }, h("option", { value: "", text: "General" })) as HTMLSelectElement;
  for (const repo of host.repos()) repoPicker.append(h("option", { value: repo.fullName, text: repo.name }));
  const add = () => {
    const value = ui.composerInput.value.trim().replace(/\s+/g, " ");
    if (!value) { ui.composerInput.focus(); return; }
    if (tab === "notes") {
      host.capture(value, repoPicker.value, "note", "", null);
    } else {
      const when = tab === "upcoming" && dateInput.value <= today()
        ? host.dayKey(Date.now() + DAY)
        : dateInput.value || null;
      host.capture(value, repoPicker.value, "task", "", when);
      const created = host.data().tasks[0];
      if (created) {
        created.priority = composerPriority;
        created.order = Math.min(0, ...host.data().tasks.filter(isTask).map(orderOf)) - 1;
        host.save();
      }
    }
    ui.composerInput.value = "";
    refreshFocusPage();
    ui.composerInput.focus();
  };
  ui.composerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") add();
    if (e.key === "Escape") ui.composerInput.blur();
  });
  ui.composer = h("div", { class: "fx-composer" },
    h("div", { class: "fx-compose-main" },
      ui.composerPrio, ui.composerInput,
      h("button", { class: "toolbar-button primary fx-add", onclick: add }, svg(ICONS.plus, 12), h("span", { text: "Add" })),
    ),
    h("div", { class: "fx-compose-options" },
      h("label", { class: "fx-option" }, svg(ICONS.clock, 11), dateInput),
      h("label", { class: "fx-option" }, svg(ICONS.stack, 11), repoPicker),
      h("span", { class: "fx-option-hint", text: "Enter to add · the pin sets priority" }),
    ),
  );

  ui.list = h("div", { class: "fx-list", role: "list" });

  return h("section", { class: "fx-panel fx-tasks" },
    h("header", { class: "fx-panel-head fx-tasks-head" },
      h("div", { class: "fx-head-copy" }, h("div", { class: "eyebrow", text: "YOUR PLAN" }), h("h2", { text: "Tasks" })),
      h("div", { class: "fx-keys" },
        h("kbd", { text: "N" }), h("span", { text: "new task" }),
        h("kbd", { text: "Space" }), h("span", { text: "start / pause" }),
      ),
    ),
    tabs,
    ui.composer,
    ui.list,
    h("footer", { class: "fx-tasks-foot" }, host.reminderRow()),
  );
}

function buildTimer(): HTMLElement {
  timerMochi ??= createPortrait({
    size: 84, overhang: 16, padX: 30, dance: true,
    clickMoods: ["giggle", "love", "wink", "excited"],
    label: "Mochi, focusing with you",
  });
  ui.mochiSlot = h("div", { class: "fx-timer-mochi" });
  timerMochi.mount(ui.mochiSlot);

  ui.timerTitle = h("h2");
  ui.timerState = h("span", { class: "fx-timer-state" });
  ui.timerModes = {} as Record<FocusMode, HTMLButtonElement>;
  const modes = h("div", { class: "fx-seg" });
  for (const [mode, label] of [["focus", "Focus"], ["short", "Short break"], ["long", "Long break"]] as [FocusMode, string][]) {
    const b = h("button", { text: label, onclick: () => beginMode(mode) }) as HTMLButtonElement;
    ui.timerModes[mode] = b;
    modes.append(b);
  }

  const ring = svgEl("svg", { viewBox: "0 0 200 200", class: "fx-ring", "aria-hidden": "true" });
  const defs = svgEl("defs", {});
  const grad = svgEl("linearGradient", { id: "fx-ring-grad", x1: "0", y1: "0", x2: "1", y2: "1" });
  grad.append(svgEl("stop", { offset: "0%", "stop-color": "var(--fx-ring-a)" }), svgEl("stop", { offset: "100%", "stop-color": "var(--fx-ring-b)" }));
  defs.append(grad);
  ring.append(defs);
  // Minute ticks around the dial.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r1 = i % 5 === 0 ? 93 : 95;
    ring.append(svgEl("line", {
      x1: 100 + Math.cos(a) * r1, y1: 100 + Math.sin(a) * r1,
      x2: 100 + Math.cos(a) * 98, y2: 100 + Math.sin(a) * 98,
      class: i % 5 === 0 ? "fx-tick major" : "fx-tick",
    }));
  }
  ring.append(svgEl("circle", { cx: 100, cy: 100, r: RING_R, class: "fx-ring-track" }));
  ui.timerRing = svgEl("circle", { cx: 100, cy: 100, r: RING_R, class: "fx-ring-progress" });
  ui.timerRing.style.strokeDasharray = String(RING_C);
  ring.append(ui.timerRing);
  ui.timerTime = h("div", { class: "fx-time", "aria-live": "off" });

  ui.focusOn = h("select", { class: "fx-focus-on", "aria-label": "Focusing on", onchange: () => {
    host.data().activeTaskId = ui.focusOn.value || null;
    host.save();
    drawList();
  } }) as HTMLSelectElement;

  ui.lengths = h("div", { class: "fx-lengths" });
  ui.startBtn = h("button", { class: "fx-start", onclick: toggleTimer }) as HTMLButtonElement;
  const reset = h("button", { class: "fx-icon-btn", title: "Reset timer", "aria-label": "Reset timer", onclick: () => beginMode(host.data().mode) }, svg(ICONS.refresh, 14));
  const plus = h("button", { class: "fx-icon-btn fx-plus5", title: "Add 5 minutes", "aria-label": "Add 5 minutes", onclick: addFive }, h("span", { text: "+5" }));

  ui.dots = h("div", { class: "fx-dots", "aria-hidden": "true" });
  ui.sessionsLabel = h("span", { class: "fx-sessions" });

  // Music for this focus session.
  const eq = h("span", { class: "fx-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"));
  ui.musicBtn = h("button", { class: "fx-music-btn", onclick: () => {
    const station = ui.stationSelect.value as StationId;
    if (music.state.playing && music.state.station === station) music.stop();
    else music.play(station, host.data().running && host.data().mode === "focus" ? "focus" : "manual");
  } }, svg(ICONS.music, 13), eq, h("span", { class: "fx-music-label", text: "Play" })) as HTMLButtonElement;
  ui.stationSelect = h("select", { class: "fx-station", "aria-label": "Station", onchange: () => {
    writeMusicPrefs({ focusStation: ui.stationSelect.value as StationId });
    if (music.state.playing) music.play(ui.stationSelect.value as StationId, music.state.reason ?? "manual");
  } }) as HTMLSelectElement;
  for (const st of STATIONS) ui.stationSelect.append(h("option", { value: st.id, text: `${st.emoji}  ${st.name}` }));
  ui.autoMusic = h("button", { class: "fx-auto", title: "Start music with every focus session", onclick: () => {
    writeMusicPrefs({ focusMusic: !readMusicPrefs().focusMusic });
    drawMusic();
  } }, h("i"), h("span", { text: "Auto" })) as HTMLButtonElement;
  if (!musicWired) {
    musicWired = true;
    music.onState(() => drawMusic());
    onMusicPrefs(() => drawMusic());
  }

  ui.timer = h("section", { class: "fx-panel fx-timer" },
    h("header", { class: "fx-panel-head" },
      h("div", {}, h("div", { class: "eyebrow", text: "POMODORO" }), ui.timerTitle),
      ui.timerState,
    ),
    modes,
    h("div", { class: "fx-dial" }, ring, h("div", { class: "fx-dial-center" }, ui.mochiSlot, ui.timerTime)),
    h("label", { class: "fx-focus-on-row" }, svg(ICONS.star, 12), h("span", { text: "Focusing on" }), ui.focusOn),
    ui.lengths,
    h("div", { class: "fx-controls" }, reset, ui.startBtn, plus),
    h("div", { class: "fx-session-row" }, ui.dots, ui.sessionsLabel),
    h("div", { class: "fx-music" }, ui.musicBtn, ui.stationSelect, ui.autoMusic),
  );
  return ui.timer;
}

// ── Draw ──────────────────────────────────────────────────────────────────────

/** The greeting: today's occasion if there is one, else the time of day and your name. */
function drawGreeting(sub: string) {
  const occ = occasionFor();
  const name = profileStore.read().name.trim();
  const key = [occ?.id, occ?.greeting, name, greeting(), sub, host.lang()].join("|");
  if (key === greetKey) return;
  greetKey = key;

  ui.hero.dataset.occasion = occ?.id ?? "";
  if (occ) {
    ui.hero.style.setProperty("--o0", occ.colors[0]);
    ui.hero.style.setProperty("--o1", occ.colors[1]);
  }
  ui.celebrate.hidden = !occ;
  clear(ui.greetTitle);
  clear(ui.greetSub);
  ui.celebrate.title = occ?.invite ?? "";
  if (occ && host.lang() === "fa") {
    // In Persian the greeting itself is the title.
    // The emoji gets its own span: gradient text would paint it flat.
    const [, words, emoji] = /^(.*?)\s*(\p{Extended_Pictographic}\uFE0F?)?$/u.exec(occ.greeting) ?? [, occ.greeting, ""];
    ui.greetTitle.append(h("span", { dir: "rtl", text: words }));
    if (emoji) ui.greetTitle.append(h("span", { class: "fx-greet-emoji", "aria-hidden": "true", text: `\u00a0${emoji}` }));
    ui.greetSub.append(ui.celebrate);
  } else if (occ) {
    ui.greetTitle.append(h("span", { text: occ.title }));
    ui.greetSub.append(h("span", { class: "fx-greet-fa", dir: "rtl", text: occ.greeting }), ui.celebrate);
  } else {
    ui.greetTitle.append(h("span", { text: greeting() }));
    if (name) ui.greetTitle.append(h("span", { class: "fx-greet-name", text: `${host.lang() === "fa" ? "،" : ","} ${name}` }));
    ui.greetSub.append(h("span", { text: sub }));
  }
}

function drawHero() {
  const d = host.data();
  const day = today();
  const tasksToday = d.tasks.filter((t) => isTask(t) && ((!t.doneAt && (!t.scheduledFor || t.scheduledFor <= day)) || doneOn(t, day)));
  const done = tasksToday.filter((t) => t.doneAt).length;
  const total = tasksToday.length;
  const minutes = minutesOn(day);

  ui.dateLine.textContent = host.date(new Date(), { weekday: "long", month: "long", day: "numeric" });
  const sub =
    total > 0 && done === total ? "Everything's done. Mochi is proud of you!"
      : minutes >= goal() ? "Focus goal reached — take a real break."
        : total === 0 ? "Plan one small win to get started."
          : done > 0 ? "Nice momentum — keep it gentle."
            : "One step at a time — you've got this.";
  drawGreeting(sub);

  ui.ringValue.textContent = host.num(done);
  ui.ringTotal.textContent = `/${host.num(total)}`;
  ui.ringProgress.style.strokeDashoffset = String(HERO_C * (1 - (total ? done / total : 0)));
  ui.ringProgress.classList.toggle("complete", total > 0 && done === total);

  ui.focusValue.textContent = host.num(minutes);
  ui.goalValue.textContent = host.num(goal());
  ui.goalFill.style.width = `${Math.min(100, (minutes / goal()) * 100)}%`;
  ui.goalFill.classList.toggle("complete", minutes >= goal());

  const s = streak();
  // Milestones pay a bonus once, on the day they are reached.
  if ([3, 7, 14, 30, 60, 100].includes(s)) awardXp(50, "streak", { key: `streak:${s}:${day}` });
  ui.streakValue.textContent = host.num(s);
  ui.streakFlame.classList.toggle("lit", s > 0);

  drawWeek();
}

/** Last seven days of focus, one column each — today in full colour. */
function drawWeek() {
  clear(ui.week);
  const days: { key: string; label: string; minutes: number; sessions: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const ts = Date.now() - i * DAY;
    const key = host.dayKey(ts);
    const list = host.data().sessions.filter((s) => host.dayKey(s.at) === key);
    days.push({
      key,
      label: host.date(new Date(ts), { weekday: "narrow" }),
      minutes: list.reduce((sum, s) => sum + s.minutes, 0),
      sessions: list.length,
    });
  }
  // Headroom above the tallest bar (or the goal) so neither touches the labels.
  const max = Math.max(goal(), ...days.map((d) => d.minutes)) * 1.15;
  const total = days.reduce((sum, d) => sum + d.minutes, 0);
  ui.weekTotal.textContent = host.lang() === "fa"
    ? `${host.num(total)} دقیقه`
    : total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;

  const chart = h("div", { class: "fx-week-chart", role: "img", "aria-label": "Focus minutes for the last seven days" });
  const goalLine = h("i", { class: "fx-week-goal" });
  goalLine.style.bottom = `${(goal() / max) * 100}%`;
  goalLine.title = "Daily goal";
  chart.append(goalLine);
  const tip = h("div", { class: "fx-week-tip", hidden: true });
  days.forEach((d) => {
    const col = h("div", { class: `fx-week-col ${d.key === today() ? "today" : ""}`, tabindex: "0", "aria-label": `${d.label}: ${d.minutes} min` });
    const bar = h("i", { class: "fx-week-bar" });
    bar.style.height = `${Math.max(d.minutes ? 6 : 2, (d.minutes / max) * 100)}%`;
    if (!d.minutes) bar.classList.add("empty");
    col.append(bar, h("span", { class: "fx-week-day", text: d.label }));
    const show = () => {
      tip.hidden = false;
      clear(tip);
      tip.append(
        h("b", { text: host.date(new Date(`${d.key}T12:00:00`), { weekday: "short", month: "short", day: "numeric" }) }),
        h("span", {}, h("strong", { text: host.num(d.minutes) }), " ", h("span", { text: "min" }), " · ", h("strong", { text: host.num(d.sessions) }), " ", h("span", { text: "sessions" })),
      );
      tip.style.left = `${col.offsetLeft + col.offsetWidth / 2}px`;
    };
    col.addEventListener("mouseenter", show);
    col.addEventListener("focus", show);
    col.addEventListener("mouseleave", () => { tip.hidden = true; });
    col.addEventListener("blur", () => { tip.hidden = true; });
    chart.append(col);
  });
  ui.week.append(chart, tip);
}

function drawTabs() {
  const d = host.data();
  const day = today();
  const counts: Record<Tab, number> = {
    today: d.tasks.filter((t) => isTask(t) && !t.doneAt && (!t.scheduledFor || t.scheduledFor <= day)).length,
    upcoming: d.tasks.filter((t) => isTask(t) && !t.doneAt && t.scheduledFor != null && t.scheduledFor > day).length,
    done: d.tasks.filter((t) => isTask(t) && t.doneAt && Date.now() - t.doneAt < 14 * DAY).length,
    notes: d.tasks.filter((t) => !isTask(t)).length,
  };
  for (const key of Object.keys(ui.tabs) as Tab[]) {
    ui.tabs[key].classList.toggle("active", key === tab);
    ui.tabs[key].setAttribute("aria-selected", String(key === tab));
    ui.tabCounts[key].textContent = counts[key] ? host.num(counts[key]) : "";
  }
  ui.composer.hidden = tab === "done";
  ui.composerInput.placeholder = tab === "notes" ? "Jot down an idea…" : tab === "upcoming" ? "Plan something for later…" : "What needs your attention?";
}

function paintPrio(el: HTMLElement, p: Priority) {
  el.style.setProperty("--prio", PRIORITY[p].color);
  el.classList.toggle("set", p > 0);
  el.title = PRIORITY[p].label;
  el.setAttribute("aria-label", PRIORITY[p].label);
}

function drawList() {
  const d = host.data();
  const day = today();
  clear(ui.list);

  if (tab === "notes") {
    const notes = d.tasks.filter((t) => !isTask(t))
      .sort((a, b) => (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999") || b.createdAt - a.createdAt);
    if (!notes.length) return emptyState("Nothing to note yet", "Keep ideas and project details here for later.", ["curious", "whistle"]);
    notes.forEach((n, i) => ui.list.append(noteCard(n, i)));
    return;
  }

  if (tab === "done") {
    const done = d.tasks.filter((t) => isTask(t) && t.doneAt && Date.now() - t.doneAt < 14 * DAY).sort((a, b) => b.doneAt! - a.doneAt!);
    if (!done.length) return emptyState("Nothing finished yet", "Ticked-off tasks from the last two weeks show up here.", ["hop", "lookAround"]);
    let lastDay = "";
    done.forEach((t, i) => {
      const key = host.dayKey(t.doneAt!);
      if (key !== lastDay) {
        lastDay = key;
        ui.list.append(h("div", { class: "fx-group" }, key === day ? h("span", { text: "Today" }) : h("span", { text: host.date(new Date(t.doneAt!), { weekday: "long", month: "short", day: "numeric" }) })));
      }
      ui.list.append(taskRow(t, i));
    });
    return;
  }

  const open = d.tasks.filter((t) => isTask(t) && !t.doneAt && (tab === "today"
    ? !t.scheduledFor || t.scheduledFor <= day
    : t.scheduledFor != null && t.scheduledFor > day));

  if (tab === "upcoming") {
    if (!open.length) return emptyState("Nothing planned ahead", "Give a task a later date and it waits here.", ["whistle", "lookAround"]);
    open.sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!) || orderOf(a) - orderOf(b));
    let lastDay = "";
    open.forEach((t, i) => {
      if (t.scheduledFor !== lastDay) {
        lastDay = t.scheduledFor!;
        ui.list.append(h("div", { class: "fx-group" }, h("span", { text: host.date(new Date(`${lastDay}T12:00:00`), { weekday: "long", month: "short", day: "numeric" }) })));
      }
      ui.list.append(taskRow(t, i));
    });
    return;
  }

  // Today: your own order (overdue rows stand out on their own).
  open.sort((a, b) => orderOf(a) - orderOf(b));
  const doneToday = d.tasks.filter((t) => isTask(t) && doneOn(t, day)).sort((a, b) => b.doneAt! - a.doneAt!);

  if (!open.length && doneToday.length) {
    ui.list.append(allDone(doneToday.length));
  } else if (!open.length) {
    return emptyState("Nothing planned yet", "Add one small task to get going.", ["whistle", "lookAround", "hop"]);
  }
  open.forEach((t, i) => ui.list.append(taskRow(t, i)));
  if (doneToday.length) {
    ui.list.append(h("div", { class: "fx-group done" }, h("span", { text: "Completed today" }), h("span", { class: "fx-group-count", text: host.num(doneToday.length) })));
    doneToday.forEach((t, i) => ui.list.append(taskRow(t, open.length + i)));
  }
}

function emptyState(title: string, sub: string, moods: Parameters<typeof createPortrait>[0]["idleMoods"]) {
  ui.list.append(h("div", { class: "fx-empty" },
    createPortrait({ size: 70, overhang: 14, padX: 20, follow: true, dance: true, idleMoods: moods, clickMoods: ["giggle", "excited"] }).canvas,
    h("b", { text: title }), h("span", { text: sub })));
}

/** Shown when today's list is cleared: a dancing Mochi and, once a day, confetti. */
function allDone(count: number): HTMLElement {
  const p = createPortrait({ size: 76, overhang: 20, padX: 40, dance: true, idleMoods: ["dance", "giggle", "spin"], clickMoods: ["celebrate", "dance"] });
  const banner = h("div", { class: "fx-all-done" }, p.canvas,
    h("div", {}, h("b", { text: "All done for today!" }), h("span", {}, h("strong", { text: host.num(count) }), " ", h("span", { text: "tasks finished. Enjoy the rest of your day." }))));
  if (celebratedDay !== today()) {
    celebratedDay = today();
    window.setTimeout(() => {
      p.engine.triggerEmote("celebrate");
      host.confetti(banner);
      const reward = awardXp(XP.allDone, "all-done", { key: `all-done:${today()}` });
      if (reward) host.xpPop(banner, reward.amount);
    }, 250);
  }
  return banner;
}

function taskRow(t: FocusTask, index: number): HTMLElement {
  const d = host.data();
  const day = today();
  const done = Boolean(t.doneAt);
  const overdue = !done && t.scheduledFor != null && t.scheduledFor < day;
  const active = d.activeTaskId === t.id && d.running;
  const prio = (t.priority ?? 0) as Priority;
  const row = h("div", {
    class: `fx-task ${done ? "done" : ""} ${overdue ? "overdue" : ""} ${active ? "active" : ""} prio-${prio}`,
    role: "listitem", "data-id": t.id,
  });
  row.style.setProperty("--prio", PRIORITY[prio].color);
  row.style.animationDelay = `${Math.min(index, 10) * 22}ms`;

  const check = h("button", { class: `fx-check ${done ? "checked" : ""}`, title: done ? "Mark as not done" : "Complete task", "aria-label": done ? "Mark as not done" : "Complete task", onclick: () => {
    if (!done) {
      host.confetti(check);
      host.activity(t.title, t.repo);
      // Paid once per task, however many times it is ticked and unticked.
      const reward = awardXp(prio === 3 ? XP.taskHighPriority : XP.task, "task", { key: `task:${t.id}` });
      if (reward) host.xpPop(check, reward.amount);
      heroMochi?.engine.triggerEmote(Math.random() < 0.5 ? "excited" : "giggle");
    }
    t.doneAt = done ? null : Date.now();
    if (!done && d.activeTaskId === t.id && !d.running) d.activeTaskId = null;
    host.save();
    // Let the tick land before the row moves away.
    row.classList.add(done ? "undoing" : "completing");
    window.setTimeout(refreshFocusPage, done ? 0 : 380);
  } }, svg(ICONS.check, 11, { stroke: 3 }));

  const title = h("b", { class: "fx-title", text: t.title, title: "Double-click to edit" });
  title.addEventListener("dblclick", () => startEdit(t, title));
  if (editingId === t.id) window.setTimeout(() => startEdit(t, title), 0);

  const meta = h("div", { class: "fx-meta" });
  if (prio > 0) meta.append(h("span", { class: "fx-chip prio", title: PRIORITY[prio].label }, h("i"), h("span", { text: PRIORITY[prio].short })));
  if (t.repo) {
    const repo = host.repos().find((r) => r.fullName === t.repo);
    meta.append(h("span", { class: "fx-chip project" }, svg(ICONS.stack, 10), h("span", { text: repo?.name ?? t.repo })));
  }
  // In Today, "today" goes without saying; any other date (or overdue) is shown.
  if (!done && (tab !== "today" || overdue || (t.scheduledFor != null && t.scheduledFor !== day))) meta.append(host.datePicker(t, "task"));
  if (t.focusMinutes) meta.append(h("span", { class: "fx-chip tomato", title: "Focus time on this task" }, h("span", { text: "🍅" }), h("strong", { text: host.num(t.focusMinutes) }), h("span", { text: "min" })));
  if (t.note) meta.append(h("span", { class: "fx-note-preview", text: t.note }));

  const actions = h("div", { class: "fx-row-actions" });
  if (!done) {
    actions.append(
      h("button", { class: "fx-row-btn focus", title: "Focus on this", "aria-label": "Focus on this", onclick: () => focusOn(t) }, svg(ICONS.timer, 13)),
      h("button", { class: "fx-row-btn", title: "Change priority", "aria-label": "Change priority", onclick: () => {
        t.priority = (((t.priority ?? 0) + 1) % 4) as Priority;
        host.save();
        drawList();
      } }, svg(ICONS.pin, 12)),
    );
  }
  actions.append(h("button", { class: "fx-row-btn danger", title: "Remove task", "aria-label": "Remove task", onclick: () => {
    row.classList.add("removing");
    window.setTimeout(() => {
      d.tasks = d.tasks.filter((x) => x.id !== t.id);
      if (d.activeTaskId === t.id) d.activeTaskId = null;
      host.save();
      refreshFocusPage();
    }, 200);
  } }, svg(ICONS.xmark, 11)));

  row.append(
    done ? h("span", { class: "fx-grip-space" }) : h("span", { class: "fx-grip", title: "Drag to reorder", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i")),
    check,
    h("div", { class: "fx-task-main" }, title, meta),
    actions,
  );
  if (!done && tab === "today") wireDrag(row, t);
  return row;
}

function noteCard(n: FocusTask, index: number): HTMLElement {
  const d = host.data();
  const card = h("article", { class: "fx-note" });
  card.style.animationDelay = `${Math.min(index, 10) * 22}ms`;
  const meta = h("div", { class: "fx-meta" });
  if (n.repo) meta.append(h("span", { class: "fx-chip project" }, svg(ICONS.stack, 10), h("span", { text: host.repos().find((r) => r.fullName === n.repo)?.name ?? n.repo })));
  meta.append(host.datePicker(n, "note"));
  card.append(
    h("span", { class: "fx-note-mark" }, svg(ICONS.doc, 13)),
    h("div", { class: "fx-task-main" }, h("b", { class: "fx-title", text: n.title }), n.note ? h("p", { class: "fx-note-body", text: n.note }) : null, meta),
    h("button", { class: "fx-row-btn danger", title: "Remove note", "aria-label": "Remove note", onclick: () => {
      d.tasks = d.tasks.filter((x) => x.id !== n.id);
      host.save();
      refreshFocusPage();
    } }, svg(ICONS.xmark, 11)),
  );
  return card;
}

/** Double-click a title to rename it in place. Enter saves, Esc cancels. */
function startEdit(t: FocusTask, title: HTMLElement) {
  if (!title.isConnected || title.querySelector("input")) return;
  editingId = t.id;
  const input = h("input", { class: "fx-edit", value: t.title, maxlength: "120", "aria-label": "Task title" }) as HTMLInputElement;
  clear(title);
  title.append(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    editingId = null;
    const value = input.value.trim().replace(/\s+/g, " ");
    if (save && value && value !== t.title) {
      t.title = value;
      host.save();
    }
    drawList();
    drawTimer();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/** Drag a row by its grip to put your day in order. */
function wireDrag(row: HTMLElement, t: FocusTask) {
  const grip = row.querySelector(".fx-grip") as HTMLElement | null;
  if (!grip) return;
  grip.addEventListener("mousedown", () => { row.draggable = true; });
  row.addEventListener("dragstart", (e) => {
    dragId = t.id;
    row.classList.add("dragging");
    e.dataTransfer?.setData("text/plain", t.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  });
  row.addEventListener("dragend", () => {
    row.draggable = false;
    row.classList.remove("dragging");
    dragId = null;
    for (const el of ui.list.querySelectorAll(".drop-before,.drop-after")) el.classList.remove("drop-before", "drop-after");
  });
  row.addEventListener("dragover", (e) => {
    if (!dragId || dragId === t.id) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    row.classList.toggle("drop-after", after);
    row.classList.toggle("drop-before", !after);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    const moving = dragId;
    const after = row.classList.contains("drop-after");
    row.classList.remove("drop-before", "drop-after");
    if (!moving || moving === t.id) return;
    const ids = [...ui.list.querySelectorAll<HTMLElement>(".fx-task:not(.done)")].map((el) => el.dataset.id!).filter((id) => id !== moving);
    const at = ids.indexOf(t.id) + (after ? 1 : 0);
    ids.splice(at, 0, moving);
    const d = host.data();
    ids.forEach((id, i) => {
      const task = d.tasks.find((x) => x.id === id);
      if (task) task.order = i;
    });
    host.save();
    drawList();
  });
}

// ── Timer ─────────────────────────────────────────────────────────────────────

function drawTimer() {
  if (!ui.timer?.isConnected) return;
  const d = host.data();
  const total = lengthFor(d.mode) * 60;
  const remaining = d.running && d.endAt ? Math.max(0, Math.ceil((d.endAt - Date.now()) / 1000)) : d.remaining;
  const paused = !d.running && remaining < total;

  ui.timer.dataset.mode = d.mode;
  ui.timer.classList.toggle("running", d.running);
  ui.timerTitle.textContent = d.mode === "focus" ? "Deep focus" : d.mode === "short" ? "Short break" : "Long break";
  ui.timerState.textContent = d.running ? (d.mode === "focus" ? "Focusing" : "On a break") : paused ? "Paused" : "Ready";
  ui.timerState.className = `fx-timer-state ${d.running ? "live" : paused ? "paused" : ""}`;
  for (const mode of Object.keys(ui.timerModes) as FocusMode[]) ui.timerModes[mode].classList.toggle("active", mode === d.mode);
  ui.timerTime.textContent = host.clock(remaining);
  ui.timerRing.style.strokeDashoffset = String(RING_C * (1 - remaining / total));
  ui.startBtn.textContent = d.running ? "Pause" : paused ? "Resume" : d.mode === "focus" ? "Start focus" : "Start break";
  ui.startBtn.classList.toggle("pause", d.running);

  // Lengths only make sense for focus; a break offers a little game instead.
  clear(ui.lengths);
  ui.lengths.classList.toggle("fx-break-row", d.mode !== "focus");
  if (d.mode !== "focus") {
    ui.lengths.append(h("button", { class: "fx-arcade-btn", onclick: () => {
      const data = host.data();
      if (!data.running) toggleTimer();
      host.openArcade();
    } }, h("span", { class: "fx-arcade-emoji", "aria-hidden": "true", text: "🎮" }), h("span", { text: d.running ? "Play with Mochi" : "Start the break and play" })));
  }
  if (d.mode === "focus") {
    for (const m of LENGTHS) {
      ui.lengths.append(h("button", { class: d.focusMinutes === m ? "active" : "", disabled: d.running, onclick: () => {
        d.focusMinutes = m;
        if (!d.running) d.remaining = m * 60;
        host.save();
        drawTimer();
      } }, h("span", { text: host.num(m) }), h("small", { text: "min" })));
    }
  }

  // "Focusing on" lists today's open tasks.
  const open = d.tasks.filter((t) => isTask(t) && !t.doneAt && (!t.scheduledFor || t.scheduledFor <= today())).sort((a, b) => orderOf(a) - orderOf(b));
  clear(ui.focusOn);
  ui.focusOn.append(h("option", { value: "", text: "Nothing in particular" }));
  for (const t of open) ui.focusOn.append(h("option", { value: t.id, text: t.title }));
  if (d.activeTaskId && !open.some((t) => t.id === d.activeTaskId)) d.activeTaskId = null;
  ui.focusOn.value = d.activeTaskId ?? "";
  ui.focusOn.disabled = d.mode !== "focus";

  // Four dots per pomodoro cycle; the fourth earns a long break.
  const todays = d.sessions.filter((s) => host.dayKey(s.at) === today()).length;
  clear(ui.dots);
  const filled = todays % 4 === 0 && todays > 0 ? 4 : todays % 4;
  for (let i = 0; i < 4; i++) ui.dots.append(h("i", { class: i < filled ? "on" : "" }));
  clear(ui.sessionsLabel);
  ui.sessionsLabel.append(h("strong", { text: host.num(todays) }), " ", h("span", { text: todays === 1 ? "session today" : "sessions today" }));

  // Mochi mirrors the timer: working with you, napping on breaks.
  const mood = d.running ? (d.mode === "focus" ? "working" : "sleeping") : "idle";
  if (mood !== lastTimerMood && timerMochi) {
    lastTimerMood = mood;
    timerMochi.engine.setState(mood);
  }
  drawMusic();
}

function drawMusic() {
  if (!ui.musicBtn?.isConnected) return;
  const prefs = readMusicPrefs();
  const s = music.state;
  const playing = s.playing && s.station === ui.stationSelect.value;
  if (!s.playing && document.activeElement !== ui.stationSelect) ui.stationSelect.value = prefs.focusStation;
  if (s.playing && document.activeElement !== ui.stationSelect) ui.stationSelect.value = s.station;
  ui.musicBtn.classList.toggle("playing", s.playing);
  (ui.musicBtn.querySelector(".fx-music-label") as HTMLElement).textContent = playing || s.playing ? "Stop" : "Play";
  ui.autoMusic.classList.toggle("on", prefs.focusMusic);
  ui.autoMusic.setAttribute("aria-pressed", String(prefs.focusMusic));
}

function beginMode(mode: FocusMode) {
  const d = host.data();
  const wasFocusRunning = d.running && d.mode === "focus";
  d.mode = mode;
  d.running = false;
  d.endAt = null;
  d.remaining = lengthFor(mode) * 60;
  host.save();
  if (wasFocusRunning) music.stop("focus");
  drawTimer();
}

function toggleTimer() {
  const d = host.data();
  if (d.running && d.endAt) {
    d.remaining = Math.max(0, Math.ceil((d.endAt - Date.now()) / 1000));
    d.running = false;
    d.endAt = null;
    if (d.mode === "focus") music.stop("focus");
  } else {
    if (d.remaining <= 0) d.remaining = lengthFor(d.mode) * 60;
    d.running = true;
    d.endAt = Date.now() + d.remaining * 1000;
    const prefs = readMusicPrefs();
    if (d.mode === "focus" && prefs.focusMusic && !music.state.playing) music.play(prefs.focusStation, "focus");
    timerMochi?.engine.triggerEmote(d.mode === "focus" ? "excited" : "stretch");
  }
  host.save();
  drawTimer();
  drawList();
}

function addFive() {
  const d = host.data();
  if (d.running && d.endAt) d.endAt += 5 * 60_000;
  else d.remaining += 5 * 60;
  host.save();
  drawTimer();
}

/** ▶ on a task row: switch to focus on it and start right away. */
function focusOn(t: FocusTask) {
  const d = host.data();
  d.activeTaskId = t.id;
  if (d.mode !== "focus") beginMode("focus");
  if (!d.running) toggleTimer();
  host.toast("Focusing on it — you've got this");
  drawList();
  drawTimer();
}

/** Once a second, on every page: the timer must finish even when you're elsewhere. */
export function tickFocus() {
  const d = host?.data();
  if (!d) return;
  if (d.running && d.endAt && d.endAt <= Date.now()) {
    finishSession();
    return;
  }
  if (root?.isConnected) {
    const total = lengthFor(d.mode) * 60;
    const remaining = d.running && d.endAt ? Math.max(0, Math.ceil((d.endAt - Date.now()) / 1000)) : d.remaining;
    ui.timerTime.textContent = host.clock(remaining);
    ui.timerRing.style.strokeDashoffset = String(RING_C * (1 - remaining / total));
  }
}

export function setFocusHost(h1: FocusHost) {
  host = h1;
}

/** A session ran out: record it, celebrate it, and line up the next one. */
function finishSession() {
  const d = host.data();
  if (!d.running || !d.endAt) return;
  let focusReward = 0;
  const finished = d.mode;
  if (finished === "focus") {
    d.sessions.push({ at: Date.now(), minutes: d.focusMinutes, taskId: d.activeTaskId ?? null });
    const task = d.tasks.find((t) => t.id === d.activeTaskId);
    if (task) task.focusMinutes = (task.focusMinutes ?? 0) + d.focusMinutes;
    focusReward = awardXp(d.focusMinutes * XP.focusPerMinute + XP.focusBonus, "focus", { key: `focus:${d.endAt}` })?.amount ?? 0;
  }
  const todays = d.sessions.filter((s) => host.dayKey(s.at) === today()).length;
  d.mode = finished === "focus" ? (todays % 4 === 0 ? "long" : "short") : "focus";
  d.running = false;
  d.endAt = null;
  d.remaining = lengthFor(d.mode) * 60;
  d.sessions = d.sessions.filter((s) => Date.now() - s.at < 35 * DAY);
  host.save();

  if (finished === "focus") {
    music.stop("focus");
    music.jingle("finish");
    host.notify("Focus session complete", `${d.focusMinutes} minutes done. Take a breath or start a short break.`);
  } else {
    host.notify("Break complete", "Ready for another focus session?");
  }
  if (root?.isConnected) {
    timerMochi?.engine.triggerEmote(finished === "focus" ? "celebrate" : "stretch");
    if (finished === "focus") host.confetti(ui.mochiSlot);
    if (focusReward) host.xpPop(ui.mochiSlot, focusReward);
    refreshFocusPage();
  }
}

/** Space starts or pauses the timer, N jumps to the composer (when not typing). */
export function focusKeydown(e: KeyboardEvent): boolean {
  if (!root?.isConnected || e.ctrlKey || e.metaKey || e.altKey) return false;
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return false;
  if (document.querySelector(".quick-capture-overlay,.command-overlay,.notification-overlay,.project-search-overlay,.arcade-overlay,.occ-overlay,.levelup-overlay")) return false;
  if (e.key === " ") {
    toggleTimer();
    return true;
  }
  if (e.key.toLowerCase() === "n") {
    if (tab === "done") { tab = "today"; drawTabs(); drawList(); }
    ui.composerInput.focus();
    return true;
  }
  return false;
}
