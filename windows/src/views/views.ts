// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, type AgentTask } from "../core/state";
import { Bridge, type ProjectStatus } from "../core/bridge";
import { captureHandoff, handoffPrompt, latestHandoff, saveNextStep } from "../core/handoff";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview", onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabProject = h("button", { class: "tab", title: "Project status", onclick: () => go("project") }, svg(ICONS.branch, 13));
  const tabChat = h("button", { class: "tab", title: "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Drop", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { title: "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const hubBtn = h("button", { title: "Open Coucou Hub", onclick: () => void Bridge.openHubWindow() }, svg(ICONS.grid, 14));
  const soundBtn = h("button", { title: "Mute", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  // One highlight that glides between tabs instead of four that blink on and off.
  const indicator = h("i", { class: "tab-indicator", "aria-hidden": "true" });
  const tabs = [tabHome, tabProject, tabChat, tabDrop];
  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs", role: "tablist" }, indicator, ...tabs),
    h("div", { class: "header-actions" }, hubBtn, gearBtn, soundBtn),
  );
  for (const t of tabs) t.setAttribute("role", "tab");

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabProject.classList.toggle("on", v === "project");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      const active = tabs.find((t) => t.classList.contains("on"));
      for (const t of tabs) t.setAttribute("aria-selected", String(t === active));
      if (active) {
        indicator.style.transform = `translateX(${active.offsetLeft - tabs[0].offsetLeft}px)`;
        indicator.style.opacity = "1";
      } else {
        indicator.style.opacity = "0";
      }
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Open", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 12),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  const serviceHeading = h("div", { class: "service-heading" },
    h("span", { class: "service-title", text: "Connected tools" }),
    h("span", { class: "service-caption", text: "Quick access" }),
  );
  const serviceBody = h("div", { class: "service-body" }, serviceHeading, pills);
  const right = card(null, serviceBody);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // VS Code with a live Claude Code session keeps the ticker; every other
      // pill shows its own card, exactly like IntegrationCardView.
      const sessionActive =
        task?.id === "integration_claude" && (task.state !== "idle" || task.steps.length > 0);

      if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        clear(who);
        const live = dot(task.color, 7);
        live.classList.add("live-dot");
        if (task.state === "working" || task.state === "thinking" || task.state === "searching") live.classList.add("busy");
        who.append(
          live,
          h("span", { class: "name", text: task.name, title: task.name }),
          h("span", { class: "tool", text: task.source === "claudeCode" ? "Claude Code" : task.source === "codex" ? "Codex" : "n8n" }),
        );
        const statusLabels: Record<string, string> = {
          working: "Working", thinking: "Thinking", searching: "Searching", finished: "Finished",
          approval: "Needs approval", question: "Needs an answer", error: "Error",
        };
        if (statusLabels[task.state]) {
          who.append(h("span", { class: `home-state ${task.state}`, text: statusLabels[task.state] }));
        }
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
            title: `Step ${Math.min(task.stepIndex + 1, task.steps.length)} of ${task.steps.length}`,
          }));
        }
        ticker.sync(task);
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen ? "none" : "";

      const others = State.otherTasks.slice(0, 4);
      const pillKey = others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|");
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const t of others) pills.append(buildPill(t, actions));
        pruneMiniBots();
      }
    },
  };
}

function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = task.id === "integration_claude" ? "VS Code" : task.name;
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "div",
    { class: "pill", role: "button", tabindex: "0", title: `Open ${label}`, "aria-label": `Open ${label}`, onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label }),
  );
  pill.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      actions.setFocus(task.id);
    }
  });
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

/** A greeting that follows the clock, so Mochi feels like it shares your day. */
export function greetingFor(date = new Date()): { title: string; lines: string[] } {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return { title: "Good morning ☀️", lines: [
      "Fresh start — what are we building today?",
      "Coffee first, then Claude Code?",
      "I stretched already. Your turn!",
    ] };
  }
  if (hour >= 12 && hour < 14) {
    return { title: "Lunch o'clock 🍜", lines: [
      "Don't forget to eat something nice.",
      "A short walk does wonders for bugs.",
      "I'll keep an eye on things while you're away.",
    ] };
  }
  if (hour >= 14 && hour < 18) {
    return { title: "Good afternoon 🌤", lines: [
      "Nothing running right now. Drop a file or ask me anything.",
      "Water break? I'll wait right here.",
      "Ship something small and feel great about it.",
    ] };
  }
  if (hour >= 18 && hour < 23) {
    return { title: "Good evening 🌙", lines: [
      "Wrapping up? Save a handoff for tomorrow-you.",
      "Nothing running. Drop a file or ask me anything.",
      "Proud of today's work. Really.",
    ] };
  }
  return { title: "Burning the midnight oil 🌌", lines: [
    "Late-night code is brave code. Remember to rest.",
    "I'm yawning, but I'm here.",
    "One more commit, then sleep — deal?",
  ] };
}

function buildEmpty(actions: ViewActions): ViewHost {
  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub empty-line" });
  const body = h(
    "div",
    { class: "stack empty-stack" },
    h("div", { class: "empty-text" }, title, sub),
    h("div", { class: "grow" }),
    h("div", { class: "actions" },
      btn("Drop a file", "secondary", () => actions.setView("upload")),
      btn("Ask Codex", "primary", () => actions.setView("prompt")),
    ),
  );
  let shownAt = 0;
  return {
    el: h("div", { class: "view" }, card("soft", body)),
    sync() {
      // A new line each time the view is opened, not on every re-render.
      if (State.view !== "empty" || performance.now() - shownAt < 4000) return;
      shownAt = performance.now();
      const g = greetingFor();
      title.textContent = g.title;
      sub.textContent = g.lines[Math.floor(Math.random() * g.lines.length)];
    },
  };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, code, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "needs permission"));
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // Two buttons, built once. Rebuilding them between a mouse-down and a
      // mouse-up would swallow the click, and there is nothing left to vary:
      // "Always" is gone until the remembered-rules list exists to back it.
      if (rowKey === "built") return;
      rowKey = "built";
      clear(row);
      row.append(
        btn("Deny", "secondary", () => actions.decide("deny"), "N"),
        btn("Allow", "primary", () => actions.decide("allow"), "Y"),
      );
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code is asking a question"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Claude needs an answer.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Answer in your terminal — Coucou can't reply for you yet." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Workflow stopped." });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      const task = State.focusTask;
      // The second button goes where the problem can actually be looked at.
      const source = task?.source ?? "claudeCode";
      if (rowKey !== source) {
        rowKey = source;
        clear(row);
        row.append(
          btn("OK", "primary", () => actions.setView(State.defaultView())),
          source === "n8n"
            ? btn("Open in n8n", "secondary", () => void Bridge.openN8n())
            : btn("Open terminal", "secondary", () => actions.openTerminal()),
        );
      }
      clear(who);
      who.append(agentWho(task, task?.source === "n8n" ? "n8n" : task?.source === "codex" ? "Codex" : "Claude Code"));
      title.textContent = task?.source === "n8n" ? "Workflow stopped." : task?.source === "codex" ? "Codex turn stopped on an error." : "Session stopped on an error.";
      detail.textContent = task?.steps.at(-1) ?? "No detail available.";
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" },
    btn("Open terminal", "primary", () => actions.openTerminal()),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code finished"));
      title.textContent = State.focusTask?.steps.at(-1) ?? "Session finished";
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Too many hits at once." }),
    h("div", { class: "sub", text: "Give me a sec — back to work in three seconds." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title note-text" });
  const el = h("div", { class: "view" }, card("soft", h("div", { class: "stack note-stack" },
    h("span", { class: "note-icon", "aria-hidden": "true" }, svg(ICONS.bell, 13)), title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Sound" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:12.5px",
        text: "Settings…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.setProperty("--fill", `${(s.soundVolume / 0.2) * 100}%`);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildProject(actions: ViewActions): ViewHost {
  const body = h("div", { class: "project-body" });
  const projectCard = card(null, body);
  projectCard.classList.add("project-card");
  const el = h("div", { class: "view project-view" }, projectCard);
  let path = "";
  let status: ProjectStatus | null = null;
  let loading = false;
  let error = "";
  let rendered = "";

  async function refresh(cwd: string) {
    loading = true;
    error = "";
    State.notify();
    try {
      status = await Bridge.projectStatus(cwd);
      error = status?.error ?? "";
    } catch (e) {
      error = String(e).replace(/^Error:\\s*/, "");
      status = null;
    } finally {
      loading = false;
      rendered = "";
      State.notify();
    }
  }

  function render(cwd: string) {
    const task = State.tasks.find((item) => item.source === "codex" || item.id === "integration_claude");
    const handoff = latestHandoff(status?.path || cwd);
    const key = JSON.stringify([cwd, loading, error, status, task?.state, task?.steps.at(-1), handoff]);
    if (key === rendered) return;
    rendered = key;
    clear(body);
    const title = status?.projectName || cwd.split(/[\\/]/).filter(Boolean).at(-1) || "Project";
    const activity = dot(task?.state === "working" || task?.state === "thinking" ? "#3B9EFF" : "#22C55E", 6);
    activity.classList.add("project-dot");
    if (task?.state === "working" || task?.state === "thinking") activity.classList.add("is-working");
    body.append(h("div", { class: "project-heading" },
      activity,
      h("b", { text: title, class: "project-title" }),
      h("span", { text: loading ? "Updating" : task?.state === "working" || task?.state === "thinking" ? "Codex working" : "Project status", class: "project-live" }),
      cwd ? h("button", { class: "project-refresh", title: "Refresh status", "aria-label": "Refresh project status", onclick: () => void refresh(cwd) }, svg(ICONS.refresh, 12)) : null,
    ));
    if (!cwd) {
      body.append(h("div", { class: "sub", text: "Open a project in VS Code and start a Codex prompt to see its status." }));
    } else if (loading && !status) {
      body.append(h("div", { class: "project-loading", style: "width:42%" }));
      body.append(h("div", { class: "project-loading", style: "width:76%" }));
      body.append(h("div", { class: "project-loading", style: "width:58%" }));
      body.append(h("div", { class: "sub", text: "Reading local Git and GitHub status…" }));
    } else if (error || status?.error) {
      body.append(h("div", { class: "sub", text: error || status?.error || "Could not read project status." }));
    } else if (status) {
      const row = (label: string, value: string, icon?: string) => h("div", { class: "project-row" },
        h("span", { class: "project-label" }, icon ? svg(icon, 11) : null, h("span", { text: label })),
        h("span", { class: "project-value", text: value }));
      const repoUrl = status.githubRepo ? `https://github.com/${status.githubRepo}` : null;
      body.append(row("Branch", status.branch || "Detached HEAD", ICONS.branch));
      body.append(h("div", { class: "project-row" },
        h("span", { class: "project-label" }, svg(ICONS.doc, 11), h("span", { text: "Changes" })),
        h("span", { class: "project-chips" },
          h("span", { class: "project-chip", text: `${status.changedFiles} files` }),
          h("span", { class: "project-chip staged", text: `${status.stagedFiles} staged` }),
          h("span", { class: "project-chip dirty", text: `${status.unstagedFiles + status.untrackedFiles} pending` }),
        ),
      ));
      if (status.lastCommit) body.append(row("Last commit", status.lastCommit, ICONS.check));
      body.append(h("div", { class: "project-row" },
        h("span", { class: "project-label" }, svg(ICONS.stack, 11), h("span", { text: "GitHub" })),
        repoUrl
          ? h("button", { class: "project-repo", title: status.githubRepo ?? "", text: status.githubRepo ?? "", onclick: () => void Bridge.openUrl(repoUrl) })
          : h("span", { class: "project-value", text: "No GitHub remote" }),
      ));
      const items = [...status.issues.map((item) => ({ ...item, kind: "Issue" })), ...status.pullRequests.map((item) => ({ ...item, kind: "PR" }))].slice(0, 3);
      for (const item of items) body.append(h("button", {
        class: "project-issue",
        title: `${item.kind} #${item.number} · ${item.title}`,
        onclick: () => void Bridge.openUrl(item.url),
      },
        h("span", { class: `issue-kind ${item.kind === "PR" ? "pr" : ""}`, text: item.kind }),
        h("span", { class: "issue-number", text: `#${item.number}` }),
        h("span", { class: "issue-title", text: item.title }),
      ));
      if (status.githubError) body.append(h("div", { class: "sub", text: status.githubError, style: "font-size:11.5px" }));
      if (!status.githubError && items.length === 0 && status.githubRepo) body.append(h("div", { class: "sub", text: "No open issues or pull requests." }));
    }
    if (!handoff && cwd && status && !status.error) body.append(h("button", { class: "handoff-empty", onclick: () => {
      void captureHandoff(cwd).then(() => { rendered = ""; State.notify(); });
    } }, svg(ICONS.doc, 13), h("span", {}, h("b", { text: "Save a handoff" }), h("small", { text: "Keep this project state and add a next step for later." })), svg(ICONS.arrowUpRight, 11)));
    if (handoff) {
      const handoffMeta = [handoff.branch || "Detached HEAD", `${handoff.changedFiles} changed`].join(" · ");
      const promptLine = handoff.prompt ? `Last request · ${handoff.prompt.replace(/\s+/g, " ").slice(0, 92)}${handoff.prompt.length > 92 ? "…" : ""}` : "Saved project state is ready to resume.";
      const nextInput = h("input", { class: "handoff-next-input", type: "text", maxlength: "300", value: handoff.nextStep, "aria-label": "Next step", placeholder: "What should happen next?" }) as HTMLInputElement;
      let saveButton: HTMLElement | null = null;
      const saveStep = () => {
        const nextStep = nextInput.value.trim();
        if (nextStep && saveNextStep(handoff.id, nextStep)) {
          handoff.nextStep = nextStep;
          nextInput.value = nextStep;
          nextInput.blur();
          saveButton?.classList.add("saved");
          window.setTimeout(() => saveButton?.classList.remove("saved"), 900);
        }
      };
      nextInput.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Enter") saveStep(); });
      const resume = h("button", { class: "handoff-resume", onclick: () => {
        State.suggestedPrompt = handoffPrompt(handoff);
        actions.setView("prompt");
      } }, svg(ICONS.arrowUpRight, 11), "Resume");
      saveButton = h("button", { class: "handoff-save", title: "Save next step", "aria-label": "Save next step", onclick: saveStep }, svg(ICONS.check, 12));
      body.append(h("section", { class: "handoff-card" },
        h("div", { class: "handoff-heading" }, h("div", {}, h("b", { text: "Session handoff" }), h("span", { text: new Date(handoff.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) })), resume),
        h("div", { class: "handoff-meta", text: handoffMeta }),
        h("div", { class: "handoff-prompt", title: handoff.prompt, text: promptLine }),
        h("div", { class: "handoff-next" }, nextInput, saveButton),
      ));
    }
    const buttons = h("div", { class: "project-actions" });
    buttons.append(h("button", { class: "project-action hub-open", title: "Open Coucou Hub", onclick: () => void Bridge.openHubWindow() }, svg(ICONS.grid, 11), "Hub"));
    if (cwd) buttons.append(h("button", { class: "project-action subtle", title: "Open in VS Code", onclick: () => void Bridge.openInVSCode(cwd) }, svg(ICONS.code, 11), "VS Code"));
    if (cwd && status?.githubRepo) buttons.append(h("button", { class: "project-action subtle", title: "Open on GitHub", onclick: () => void Bridge.openUrl(`https://github.com/${status?.githubRepo}`) }, svg(ICONS.arrowUpRight, 11), "GitHub"));
    if (cwd && status) {
      buttons.append(h("span", { class: "grow" }));
      buttons.append(h("button", { class: "project-action", text: "Summarize", title: "Summarize changes", onclick: () => {
        State.suggestedPrompt = "Summarize the current project's uncommitted changes. Explain the purpose of each change briefly.";
        actions.setView("prompt");
      } }));
      buttons.append(h("button", { class: "project-action", text: "Review diff", title: "Review my diff", onclick: () => {
        State.suggestedPrompt = "Review my current uncommitted Git diff. Look for bugs, regressions, and missing edge cases. Do not modify files.";
        actions.setView("prompt");
      } }));
    }
    body.append(buttons);
  }

  return {
    el,
    sync() {
      const cwd = State.activeProjectCwd ?? "";
      if (cwd !== path) {
        path = cwd;
        status = null;
        if (cwd) void refresh(cwd);
      }
      render(cwd);
    },
  };
}

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("project", buildProject(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder("Sending by email isn't in this version.", ""));
  map.set("searching", buildPlaceholder("Claude is searching…", ""));
  map.set("result", buildPlaceholder("Result", ""));
  return map;
}
