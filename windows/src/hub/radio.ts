// Mochi Radio — the Hub's music page, plus the little "now playing" card in
// the sidebar.
//
// Every station is composed live on this PC (src/music): no streaming, no
// account, works offline. The player itself lives in the island window; this
// page is a remote control that follows its state and beat.

import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import { createPortrait, type Portrait } from "../mochi/portrait";
import { music } from "../music/remote";
import { onMusicPrefs, readMusicPrefs, writeMusicPrefs, type MusicPrefs } from "../music/prefs";
import { STATIONS, stationById, type StationId } from "../music/stations";

let stageMochi: Portrait | null = null;
let root: HTMLElement | null = null;
let beatPulse = 0;
/** Redraws the page currently on screen; listeners are wired once, not per visit. */
let drawCurrent: (() => void) | null = null;
let wired = false;

const REASON: Record<string, string> = {
  work: "Playing while your agent works",
  focus: "Playing for your focus session",
  manual: "Your pick",
};

/** Builds the radio and appends the YouTube discovery panels below it. */
export function renderRadioPage(container: HTMLElement, discovery: HTMLElement) {
  stageMochi ??= createPortrait({
    size: 132, overhang: 34, padX: 70, dance: true, follow: true,
    idleMoods: ["whistle", "lookAround", "hop", "wink"],
    clickMoods: ["dance", "spin", "giggle", "excited", "love"],
    label: "Mochi, DJ",
  });

  const stage = h("div", { class: "radio-stage" });
  const lights = h("div", { class: "radio-lights", "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  const viz = h("div", { class: "radio-viz", "aria-hidden": "true" });
  for (let i = 0; i < 24; i++) viz.append(h("i"));
  const mochiSlot = h("div", { class: "radio-mochi" });
  stageMochi.mount(mochiSlot);
  stage.append(lights, viz, mochiSlot, h("div", { class: "radio-floor", "aria-hidden": "true" }));

  const nowEmoji = h("span", { class: "radio-now-emoji" });
  const nowName = h("h2", { class: "radio-now-name" });
  const nowTag = h("p", { class: "radio-now-tag" });
  const nowReason = h("span", { class: "radio-reason" });
  const bpm = h("span", { class: "radio-bpm" });
  const playBtn = h("button", { class: "radio-play", onclick: () => {
    const s = music.state;
    if (s.playing) music.stop();
    else music.play(s.station ?? readMusicPrefs().focusStation, "manual");
  } }) as HTMLButtonElement;
  const next = h("button", { class: "radio-skip", title: "Another station", "aria-label": "Another station", onclick: () => {
    const others = STATIONS.filter((s) => s.id !== music.state.station);
    music.play(others[Math.floor(Math.random() * others.length)].id, "manual");
  } }, svg(ICONS.shuffle, 14));
  const volume = h("input", { type: "range", min: "0", max: "1", step: "0.01", class: "radio-volume", "aria-label": "Volume" }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    writeMusicPrefs({ volume: Number(volume.value) });
    paintVolume();
  });
  const paintVolume = () => volume.style.setProperty("--fill", `${Number(volume.value) * 100}%`);

  const hero = h("section", { class: "radio-hero" },
    stage,
    h("div", { class: "radio-now" },
      h("div", { class: "eyebrow", text: "MOCHI RADIO" }),
      h("div", { class: "radio-now-title" }, nowEmoji, nowName),
      nowTag,
      h("div", { class: "radio-chips" }, nowReason, bpm),
      h("div", { class: "radio-transport" }, playBtn, next,
        h("label", { class: "radio-volume-wrap" }, svg(ICONS.speakerOn, 14), volume)),
      h("p", { class: "radio-offline", text: "Composed live on your PC — no streaming, works offline." }),
    ),
  );

  const grid = h("div", { class: "radio-stations" });
  const cards = new Map<StationId, HTMLElement>();
  STATIONS.forEach((st, i) => {
    const card = h("button", { class: "radio-card", style: `--c0:${st.colors[0]};--c1:${st.colors[1]};animation-delay:${i * 40}ms`, onclick: () => {
      if (music.state.playing && music.state.station === st.id) music.stop();
      else music.play(st.id, "manual");
    } },
      h("span", { class: "radio-card-art", "aria-hidden": "true" }, h("span", { class: "radio-card-emoji", text: st.emoji }),
        h("span", { class: "radio-card-eq" }, h("i"), h("i"), h("i"), h("i"))),
      h("span", { class: "radio-card-copy" },
        h("b", { text: st.name }),
        h("small", { text: st.tagline }),
        h("span", { class: "radio-card-bpm" }, h("strong", { text: String(st.bpm) }), " ", h("span", { text: "BPM" })),
      ),
    );
    cards.set(st.id, card);
    grid.append(card);
  });

  const settings = buildSettings();

  root = h("div", { class: "radio-page" },
    hero,
    h("div", { class: "radio-section-head" }, h("div", { class: "eyebrow", text: "STATIONS" }), h("h3", { text: "Pick a vibe" })),
    grid,
    settings,
    h("div", { class: "radio-section-head" }, h("div", { class: "eyebrow", text: "DISCOVER" }), h("h3", { text: "More music on YouTube Music" })),
    discovery,
  );
  container.append(root);

  const draw = () => {
    if (!root?.isConnected) return;
    const s = music.state;
    const st = stationById(s.station);
    root.style.setProperty("--c0", st.colors[0]);
    root.style.setProperty("--c1", st.colors[1]);
    root.style.setProperty("--beat", `${60 / st.bpm}s`);
    root.classList.toggle("playing", s.playing);
    nowEmoji.textContent = st.emoji;
    nowName.textContent = st.name;
    nowTag.textContent = st.tagline;
    nowReason.textContent = s.playing ? REASON[s.reason ?? "manual"] : "Paused";
    clear(bpm);
    bpm.append(h("strong", { text: String(st.bpm) }), " ", h("span", { text: "BPM" }));
    clear(playBtn);
    playBtn.append(svg(s.playing ? "M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" : "M8 5.5v13l11-6.5-11-6.5z", 18), h("span", { text: s.playing ? "Pause" : "Play" }));
    playBtn.setAttribute("aria-label", s.playing ? "Pause" : "Play");
    for (const [id, card] of cards) card.classList.toggle("active", s.playing && id === s.station);
    volume.value = String(readMusicPrefs().volume);
    paintVolume();
  };
  drawCurrent = draw;
  if (!wired) {
    wired = true;
    music.onState(() => drawCurrent?.());
    onMusicPrefs(() => drawCurrent?.());
    music.onBeat((b) => {
      if (!root?.isConnected) return;
      // A little flash on every beat, a bigger one on the downbeat.
      root.classList.remove("beat", "downbeat");
      void root.offsetWidth;
      root.classList.add(b.downbeat ? "downbeat" : "beat");
      window.clearTimeout(beatPulse);
      beatPulse = window.setTimeout(() => root?.classList.remove("beat", "downbeat"), 160);
      if (b.downbeat && b.bar % 2 === 1) stageMochi?.engine.emit("note", 1);
    });
  }
  draw();
}

let settingsBox: HTMLElement | null = null;
let settingsWired = false;

function buildSettings(): HTMLElement {
  const box = h("section", { class: "radio-settings" });
  settingsBox = box;
  const draw = (p: MusicPrefs) => {
    clear(box);
    const toggle = (on: boolean, label: string, onChange: (v: boolean) => void) => {
      const el = h("button", { class: `radio-switch ${on ? "on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": label, onclick: () => onChange(!on) }, h("i"));
      return el;
    };
    const stationSelect = (value: string, withAuto: boolean, onChange: (v: string) => void) => {
      const sel = h("select", { class: "radio-select", "aria-label": "Station" }) as HTMLSelectElement;
      if (withAuto) sel.append(h("option", { value: "auto", text: "🎲  Surprise me" }));
      for (const st of STATIONS) sel.append(h("option", { value: st.id, text: `${st.emoji}  ${st.name}` }));
      sel.value = value;
      sel.addEventListener("change", () => onChange(sel.value));
      return sel;
    };
    const row = (icon: string, title: string, sub: string, ...controls: Node[]) =>
      h("div", { class: "radio-pref" },
        h("span", { class: "radio-pref-icon" }, svg(icon, 14)),
        h("div", { class: "radio-pref-copy" }, h("b", { text: title }), h("small", { text: sub })),
        h("div", { class: "radio-pref-controls" }, ...controls));
    box.append(
      h("div", { class: "radio-settings-head" }, h("div", { class: "eyebrow", text: "WHEN MOCHI PLAYS" }), h("h3", { text: "Music that follows your day" })),
      row(ICONS.code, "While your agent works", "Claude Code or Codex busy? Mochi puts its headphones on and plays something cute. It turns down for questions.",
        stationSelect(p.workStation, true, (v) => writeMusicPrefs({ workStation: v as StationId | "auto" })),
        toggle(p.workMusic, "While your agent works", (v) => writeMusicPrefs({ workMusic: v }))),
      row(ICONS.timer, "During focus sessions", "Starts with your pomodoro and stops for breaks.",
        stationSelect(p.focusStation, false, (v) => writeMusicPrefs({ focusStation: v as StationId })),
        toggle(p.focusMusic, "During focus sessions", (v) => writeMusicPrefs({ focusMusic: v }))),
      row(ICONS.star, "Victory jingles", "A tiny fanfare when a session finishes — and a sad trombone when it fails.",
        toggle(p.jingles, "Victory jingles", (v) => writeMusicPrefs({ jingles: v }))),
    );
  };
  draw(readMusicPrefs());
  drawSettings = draw;
  if (!settingsWired) {
    settingsWired = true;
    onMusicPrefs((p) => { if (settingsBox?.isConnected) drawSettings?.(p); });
  }
  return box;
}

let drawSettings: ((p: MusicPrefs) => void) | null = null;

// ── Sidebar now-playing ───────────────────────────────────────────────────────

/** A small card under the navigation while music plays. Clicking it opens the radio. */
export function nowPlayingCard(openRadio: () => void): HTMLElement {
  const name = h("b");
  const sub = h("small");
  const stop = h("button", { class: "np-stop", title: "Stop the music", "aria-label": "Stop the music", onclick: (e: Event) => {
    e.stopPropagation();
    music.stop();
  } }, svg("M7 7h10v10H7z", 11));
  const card = h("div", { class: "now-playing", role: "button", tabindex: "0", title: "Open Mochi Radio", onclick: openRadio, hidden: true },
    h("span", { class: "np-eq", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
    h("span", { class: "np-copy" }, name, sub),
    stop,
  );
  card.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") openRadio();
  });
  music.onState((s) => {
    const st = stationById(s.station);
    card.hidden = !s.playing;
    card.style.setProperty("--c0", st.colors[0]);
    card.style.setProperty("--c1", st.colors[1]);
    card.style.setProperty("--beat", `${60 / st.bpm}s`);
    name.textContent = `${st.emoji} ${st.name}`;
    sub.textContent = s.reason === "work" ? "Agent at work" : s.reason === "focus" ? "Focus session" : "Mochi Radio";
  });
  return card;
}
