// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { BotEngine, type RGB } from "../mochi/engine";
import { mochiPortrait } from "../mochi/portrait";
import { music } from "../music/remote";
import { readMusicPrefs, writeMusicPrefs } from "../music/prefs";
import { STATIONS, type StationId } from "../music/stations";
import { PERSIAN_MONTHS, PERSIAN_MONTHS_FA, profileStore } from "../core/profile";
import { persianDate, upcomingOccasions } from "../mochi/occasions";
import { CARE_INTERVALS, carePrefs, type CarePrefs } from "../core/care";
import { lookFor } from "../core/weather";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void, label: string): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", role: "switch", "aria-checked": String(on), "aria-label": label });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: ok ? "dot ok" : "dot off" });
}

/** "Installed", "No key"… — a small coloured pill at the end of a card header. */
function badge(text: string, tone: "ok" | "off" | "warn"): HTMLElement {
  return h("span", { class: `badge ${tone}` }, h("i"), h("span", { text }));
}

function cardHead(icon: string, title: string, sub: string, extra?: Node | null): HTMLElement {
  return h(
    "header",
    { class: "card-head" },
    h("span", { class: "card-icon", "aria-hidden": "true" }, svg(icon, 15)),
    h("div", { class: "card-title" }, h("h2", { text: title }), h("p", { text: sub })),
    extra ?? null,
  );
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

/** Brief "Saved ✓" on a button, then back to its label. */
function flash(button: HTMLElement, label: string, ok = true) {
  button.classList.remove("saved", "failed");
  void button.offsetWidth;
  button.classList.add(ok ? "saved" : "failed");
  button.textContent = ok ? "Saved ✓" : "Failed";
  window.setTimeout(() => {
    button.classList.remove("saved", "failed");
    button.textContent = label;
  }, 1400);
}

// ── Header Mochi ──────────────────────────────────────────────────────────────

/** A live Mochi next to the title: waves hello, watches the pointer, reacts to clicks. */
function headerMochi(): HTMLElement {
  const canvas = mochiPortrait({
    size: 58, greet: true, follow: true,
    clickMoods: ["giggle", "love", "wink", "excited", "shy"],
    label: "Mochi — click me",
  });
  canvas.classList.add("head-mochi");
  canvas.title = "Hi! I'm Mochi.";
  return canvas;
}

// ── Claude Code section ───────────────────────────────────────────────────────

function claudeSection(status: HookStatus): HTMLElement {
  const body = h("div", { class: "card-body" });
  const headSlot = h("div", { class: "head-slot" });
  const section = h("section", { class: "card" }, headSlot, body);

  const drawHead = () => {
    clear(headSlot);
    headSlot.append(cardHead(
      ICONS.code,
      "Claude Code",
      "Live sessions and permission requests in the island.",
      status.installed ? badge("Hooks installed", "ok") : badge("Not installed", "off"),
    ));
  };

  const rebuild = async () => {
    const fresh = await Bridge.hooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    drawHead();
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed
          ? "Coucou is hooked into your Claude Code sessions. Tool calls, questions and permission requests show up in the island, and you can answer them there."
          : "Install the hooks to see your Claude Code sessions in the island and approve permissions without leaving what you are doing.",
      }),
      h("div", { class: "kv" },
        h("label", { text: "settings.json" }),
        h("span", { class: "path", text: status.settingsPath || "—" }),
        h("span"),
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath || "—" }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "coucou-hook.exe is not in place yet. Restart Coucou; if it still fails, build it with `cargo build -p coucou-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? "Reinstall hooks…" : "Install hooks…",
      onclick: () => showPreview(true),
    });
    // Writing hook commands that point at a relay which isn't there would give
    // every Claude Code session a broken hook and nothing to show for it.
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "The relay isn't installed yet.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall hooks…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.hooksPreview(install);
    } catch (err) {
      // An unreadable or invalid settings.json stops here rather than being
      // treated as empty and written over.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? "This is exactly what will change in your settings.json. Your own hooks are left untouched."
          : "This removes Coucou's entries only. Your own hooks are left untouched.",
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Backup → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.hooksApply(install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. Open a new Claude Code session to pick the hooks up.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  drawHead();
  draw();
  return section;
}

// ── Claude API section ────────────────────────────────────────────────────────

function codexChatSection(): HTMLElement {
  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.bubble, "Codex chat", "Uses your signed-in Codex account. No separate API key is needed.", badge("Ready", "ok")),
  );
}

// ── Integrations section ────────────────────────────────────────────────────
interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

/** A tiny Mochi face in the integration's colour, drawn once. */
function integrationAvatar(color: string): HTMLElement {
  const size = 30;
  const canvas = h("canvas", { class: "int-avatar", "aria-hidden": "true" }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const engine = new BotEngine();
  engine.isMini = true;
  const v = parseInt(color.slice(1), 16);
  engine.bodyColor = [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255] as RGB;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engine.draw(ctx, size, size);
  }
  return canvas;
}

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const counter = h("span", { class: "badge neutral" });
  const list = h("div", { class: "int-list" });

  function updateCounter() {
    const used = settings.activeIntegrations.length;
    counter.textContent = `${used}/${MAX_ACTIVE} pills`;
    counter.classList.toggle("full", used >= MAX_ACTIVE);
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const item = h("div", { class: active ? "int-item on" : "int-item" });
    const sw = h("button", {
      class: active ? "switch on" : "switch",
      role: "switch",
      "aria-checked": String(active),
      "aria-label": `Show ${def.name} next to Mochi`,
    });
    const state = h("span", { class: "badge" });
    const refreshState = () => {
      const ready = def.fields.every((f) => present[f.key]);
      state.className = `badge ${ready ? "ok" : "off"}`;
      clear(state);
      state.append(h("i"), h("span", { text: ready ? "Connected" : "No key" }));
    };
    refreshState();

    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) {
          // Say no visibly instead of silently ignoring the click.
          item.classList.remove("refuse");
          void item.offsetWidth;
          item.classList.add("refuse");
          counter.classList.remove("refuse");
          void counter.offsetWidth;
          counter.classList.add("refuse");
          return;
        }
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      sw.setAttribute("aria-checked", String(!on));
      item.classList.toggle("on", !on);
      updateCounter();
      void save();
    });

    const fields = h("div", { class: "int-fields" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        "aria-label": `${def.name} ${field.label}`,
      }) as HTMLInputElement;
      const saveBtn = h("button", { class: "save", text: "Save" });
      const doSave = async () => {
        const value = input.value.trim();
        saveBtn.setAttribute("disabled", "");
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          refreshState();
          flash(saveBtn, "Save", true);
        } catch {
          flash(saveBtn, "Save", false);
        } finally {
          saveBtn.removeAttribute("disabled");
        }
      };
      saveBtn.addEventListener("click", () => void doSave());
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") void doSave();
      });
      fields.append(h("label", { text: field.label }), input, saveBtn);
    }

    item.append(
      h("div", { class: "int-item-head" },
        integrationAvatar(def.color),
        h("b", { text: def.name }),
        state,
        h("span", { class: "grow" }),
        sw,
      ),
      fields,
    );
    list.append(item);
  }

  updateCounter();
  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.grid, "Integrations", "Pick up to four pills to show next to Mochi. Keys live in the Windows Credential Manager, never on disk.", counter),
    list,
  );
}

// ── General section ───────────────────────────────────────────────────────────

function pref(label: string, hint: string, ...controls: Node[]): HTMLElement {
  return h(
    "div",
    { class: "pref" },
    h("div", { class: "pref-text" }, h("b", { text: label }), hint ? h("small", { text: hint }) : null),
    h("div", { class: "pref-control" }, ...controls),
  );
}

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
    "aria-label": "Volume",
  }) as HTMLInputElement;
  const paintVolume = () => volume.style.setProperty("--fill", `${(Number(volume.value) / 0.2) * 100}%`);
  paintVolume();
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    paintVolume();
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    class: "num",
    "aria-label": "Auto-close after, in seconds",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const screen = h("select", { "aria-label": "Island lives on" }) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.gear, "General", "How Mochi sounds, when it tucks itself away, and where it lives."),
    h("div", { class: "prefs" },
      pref("Sound", "Little chirps, pops and boops.",
        volume,
        toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }, "Sound"),
      ),
      pref("Auto-close", "Seconds after you leave the island.", autoClose, h("span", { class: "unit", text: "s" })),
      pref("Island lives on", "", screen),
      pref("Launch at startup", "Say hi every time you log in.",
        toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }, "Launch at startup"),
      ),
    ),
  );
}

// ── Music section ─────────────────────────────────────────────────────────────

function musicSection(): HTMLElement {
  const p = readMusicPrefs();
  const stationSelect = (value: string, withAuto: boolean, label: string, onChange: (v: string) => void) => {
    const sel = h("select", { "aria-label": label }) as HTMLSelectElement;
    if (withAuto) sel.append(h("option", { value: "auto", text: "🎲  Surprise me" }));
    for (const st of STATIONS) sel.append(h("option", { value: st.id, text: `${st.emoji}  ${st.name}` }));
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  };

  const volume = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: String(p.volume), "aria-label": "Music volume" }) as HTMLInputElement;
  const paint = () => volume.style.setProperty("--fill", `${Number(volume.value) * 100}%`);
  paint();
  volume.addEventListener("input", () => {
    writeMusicPrefs({ volume: Number(volume.value) });
    paint();
  });

  // Preview plays the chosen work station for a few seconds.
  let previewTimer = 0;
  const preview = h("button", { text: "Preview", onclick: () => {
    const prefs = readMusicPrefs();
    const station = (prefs.workStation === "auto" ? "bounce" : prefs.workStation) as StationId;
    if (music.state.playing && music.state.reason === "manual") {
      music.stop("manual");
      return;
    }
    music.play(station, "manual");
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => music.stop("manual"), 8000);
  } });
  music.onState((s) => {
    preview.textContent = s.playing && s.reason === "manual" ? "Stop preview" : "Preview";
  });

  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.music, "Music", "Mochi composes its own little tunes on this PC — nothing is streamed or downloaded.", badge("Offline", "ok")),
    h("div", { class: "prefs" },
      pref("While your agent works", "Plays while Claude Code or Codex is busy, turns down for questions, and stops when it's done.",
        stationSelect(p.workStation, true, "Work station", (v) => writeMusicPrefs({ workStation: v as StationId | "auto" })),
        toggle(p.workMusic, (v) => writeMusicPrefs({ workMusic: v }), "Music while your agent works"),
      ),
      pref("During focus sessions", "Starts with a Hub pomodoro and stops for breaks.",
        stationSelect(p.focusStation, false, "Focus station", (v) => writeMusicPrefs({ focusStation: v as StationId })),
        toggle(p.focusMusic, (v) => writeMusicPrefs({ focusMusic: v }), "Music during focus sessions"),
      ),
      pref("Music follows your agent", "Livelier as the tool calls pile up, suspended while a question waits, and a real ending when it's done.",
        toggle(p.adaptive, (v) => writeMusicPrefs({ adaptive: v }), "Music follows your agent"),
      ),
      pref("Mochi sings along", "Mochi mouths the melody while music plays.",
        toggle(p.singAlong, (v) => writeMusicPrefs({ singAlong: v }), "Mochi sings along"),
      ),
      pref("Victory jingles", "A tiny fanfare when a session finishes.",
        toggle(p.jingles, (v) => writeMusicPrefs({ jingles: v }), "Victory jingles"),
      ),
      pref("Music volume", "Separate from Mochi's little sound effects.", volume, preview),
    ),
  );
}

// ── About you ─────────────────────────────────────────────────────────────────

function aboutSection(): HTMLElement {
  const profile = profileStore.read();
  const name = h("input", { type: "text", maxlength: "40", placeholder: "What should Mochi call you?", value: profile.name, "aria-label": "Your name", class: "name-input" }) as HTMLInputElement;
  name.addEventListener("input", () => { profileStore.write({ name: name.value }); paintSummary(); });

  const month = h("select", { "aria-label": "Birthday month" }) as HTMLSelectElement;
  month.append(h("option", { value: "", text: "Month" }));
  PERSIAN_MONTHS.forEach((m, i) => month.append(h("option", { value: String(i + 1), text: `${m} · ${PERSIAN_MONTHS_FA[i]}` })));
  const day = h("select", { "aria-label": "Birthday day", class: "day-select" }) as HTMLSelectElement;
  const fillDays = () => {
    const m = Number(month.value);
    // Farvardin–Shahrivar have 31 days, Mehr–Esfand 30 (Esfand 30 only in leap years).
    const count = !m || m <= 6 ? 31 : 30;
    const keep = day.value;
    clear(day);
    day.append(h("option", { value: "", text: "Day" }));
    for (let d = 1; d <= count; d++) day.append(h("option", { value: String(d), text: String(d) }));
    day.value = Number(keep) <= count ? keep : "";
  };
  if (profile.birthday) month.value = String(profile.birthday.month);
  fillDays();
  if (profile.birthday) day.value = String(profile.birthday.day);
  const saveBirthday = () => {
    fillDays();
    profileStore.write({ birthday: month.value && day.value ? { month: Number(month.value), day: Number(day.value) } : null });
    paintSummary();
  };
  month.addEventListener("change", saveBirthday);
  day.addEventListener("change", saveBirthday);

  const summary = h("div", { class: "about-upcoming" });
  function paintSummary() {
    clear(summary);
    const today = persianDate(new Date());
    const p = profileStore.read();
    const chips = upcomingOccasions(new Date(), 4).map(({ occasion, days }) =>
      h("span", { class: `occ-chip${occasion.id === "birthday" ? " bday" : ""}`, style: `--o0:${occasion.colors[0]};--o1:${occasion.colors[1]}`, title: occasion.greeting },
        h("span", { "aria-hidden": "true", text: occasion.emoji }),
        h("b", { text: occasion.id === "birthday" ? "Your birthday" : occasion.title.replace(/^Happy |!$/g, "").replace(/ night$/, "") }),
        h("small", { text: days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days` }),
      ));
    summary.append(
      h("small", { class: "about-today", text: `Today is ${today.day} ${PERSIAN_MONTHS[today.month - 1]} ${today.year}${p.name.trim() ? ` — hi, ${p.name.trim()}!` : ""}` }),
      h("div", { class: "occ-chips" }, ...chips),
    );
  }
  paintSummary();

  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.user, "About you", "So Mochi can greet you by name and dress up for Nowruz, Yalda and your birthday.", badge("On this PC", "ok")),
    h("div", { class: "prefs" },
      pref("Your name", "Mochi says it in the island and the Hub.", name),
      pref("Birthday", "In the Persian calendar. Mochi throws you a little party.", month, day),
    ),
    summary,
  );
}

// ── Weather ───────────────────────────────────────────────────────────────────

function weatherSection(): HTMLElement {
  const status = h("span");
  const paintStatus = () => {
    clear(status);
    status.append(settings.weatherEnabled && settings.weatherCity ? badge("On", "ok") : badge("Off", "off"));
  };
  paintStatus();

  const preview = h("div", { class: "weather-preview" });
  const showPreview = async () => {
    clear(preview);
    if (!settings.weatherCity) return;
    preview.append(h("span", { class: "hint", text: "Checking the sky…" }));
    try {
      const now = await Bridge.weatherPreview(settings.weatherLatitude, settings.weatherLongitude, settings.weatherCity);
      const look = lookFor(now);
      const wearing = [look.outfit.hat, look.outfit.face, look.outfit.neck].filter(Boolean).map((id) => WEAR[id as string] ?? id);
      clear(preview);
      preview.append(
        h("span", { class: "weather-now", text: `${look.emoji} ${look.label} in ${now.city}` }),
        h("span", { class: "hint", text: wearing.length ? `Mochi will wear: ${wearing.join(", ")}` : "Nice weather — Mochi keeps its own outfit." }),
      );
    } catch (err) {
      clear(preview);
      preview.append(h("span", { class: "hint", text: String(err).replace(/^Error:\s*/, "") }));
    }
  };

  const city = h("span", { class: "weather-city", text: settings.weatherCity || "No city yet" });
  const search = h("input", {
    type: "text", class: "weather-search", placeholder: "Search a city…", maxlength: "60", "aria-label": "Search a city",
  }) as HTMLInputElement;
  const results = h("div", { class: "weather-results", role: "listbox" });
  let timer: number | null = null;
  let seq = 0;
  search.addEventListener("input", () => {
    if (timer != null) window.clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { clear(results); return; }
    // Only searched as you type, after a short pause — and only this text is sent.
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      try {
        const places = await Bridge.weatherSearch(q);
        if (mine !== seq) return;
        clear(results);
        if (!places.length) results.append(h("span", { class: "hint", text: "No city by that name." }));
        for (const place of places) {
          const label = [place.name, place.admin, place.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ");
          results.append(h("button", { class: "weather-place", role: "option", text: label, onclick: () => {
            settings.weatherCity = `${place.name}, ${place.country}`.replace(/, $/, "");
            settings.weatherLatitude = place.latitude;
            settings.weatherLongitude = place.longitude;
            if (!settings.weatherEnabled) {
              settings.weatherEnabled = true;
              enabled.classList.add("on");
              enabled.setAttribute("aria-checked", "true");
            }
            city.textContent = settings.weatherCity;
            search.value = "";
            clear(results);
            paintStatus();
            void save();
            void showPreview();
          } }));
        }
      } catch (err) {
        if (mine !== seq) return;
        clear(results);
        results.append(h("span", { class: "hint", text: String(err).replace(/^Error:\s*/, "") }));
      }
    }, 380);
  });

  const enabled = toggle(settings.weatherEnabled, (v) => {
    settings.weatherEnabled = v;
    paintStatus();
    void save();
    if (v) void showPreview();
    else clear(preview);
  }, "Dress for the weather");
  if (settings.weatherEnabled) void showPreview();

  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.cloud, "Weather", "Mochi dresses for the weather where you are — an umbrella in the rain, a scarf in the cold, sunglasses in the sun.", status),
    h("div", { class: "prefs" },
      pref("Dress for the weather", "Asks Open-Meteo (free, no account) every half hour. Only your city's coordinates are sent.", enabled),
      pref("City", "", city, search),
      results,
      preview,
    ),
  );
}

/** Wardrobe ids → words, for the weather preview. */
const WEAR: Record<string, string> = {
  umbrella: "an umbrella ☂️", beanie: "a beanie 🧢", scarf: "a scarf 🧣", sunglasses: "sunglasses 😎",
};

// ── Care ──────────────────────────────────────────────────────────────────────

function careSection(): HTMLElement {
  const p = carePrefs.read();
  const every = (kind: "eyes" | "water" | "stretch", label: string) => {
    const sel = h("select", { "aria-label": label }) as HTMLSelectElement;
    for (const m of CARE_INTERVALS[kind]) sel.append(h("option", { value: String(m), text: m ? `Every ${m} min` : "Off" }));
    sel.value = String(CARE_INTERVALS[kind].includes(p[kind]) ? p[kind] : CARE_INTERVALS[kind][1]);
    sel.addEventListener("change", () => carePrefs.write({ [kind]: Number(sel.value) } as Partial<CarePrefs>));
    return sel;
  };
  const hour = h("select", { "aria-label": "Review time" }) as HTMLSelectElement;
  for (let hr = 15; hr <= 23; hr++) hour.append(h("option", { value: String(hr), text: `From ${hr}:00` }));
  hour.value = String(p.reviewHour);
  hour.addEventListener("change", () => carePrefs.write({ reviewHour: Number(hour.value) }));

  return h(
    "section",
    { class: "card" },
    cardHead(ICONS.star, "Care", "Mochi rests its eyes, drinks water and stretches with you — only while you're actually at your PC.", badge("On this PC", "ok")),
    h("div", { class: "prefs" },
      pref("Health reminders", "Counted only while you're active; a long pause already counts as a break.",
        toggle(p.enabled, (v) => carePrefs.write({ enabled: v }), "Health reminders")),
      pref("👀 Rest your eyes", "The 20-20-20 rule: look far away for 20 seconds.", every("eyes", "Eye reminder")),
      pref("💧 Drink water", "A few sips, together with Mochi.", every("water", "Water reminder")),
      pref("🙆 Stretch", "A guided 30-second stretch.", every("stretch", "Stretch reminder")),
      pref("During focus sessions", "Off: reminders wait for your pomodoro break.",
        toggle(p.duringFocus, (v) => carePrefs.write({ duringFocus: v }), "During focus sessions")),
      pref("🌙 Evening review", "Mochi offers to wrap up the day — what went well, what comes first tomorrow.",
        hour, toggle(p.review, (v) => carePrefs.write({ review: v }), "Evening review")),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  clear(root);
  root.append(
    h("header", { class: "page-head" },
      headerMochi(),
      h("div", {},
        h("h1", {}, h("span", { text: "Coucou" }), version ? h("span", { class: "version", text: `v${version}` }) : null),
        h("p", { class: "tagline", text: "Settings — everything here stays on this PC." }),
      ),
    ),
    claudeSection(status),
    aboutSection(),
    codexChatSection(),
    integrationsSection(present),
    musicSection(),
    careSection(),
    weatherSection(),
    generalSection(),
    h("footer", { class: "foot" },
      svg(ICONS.lock, 12),
      h("span", { text: "No telemetry. Network requests only go to the services you configure yourself." }),
    ),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
