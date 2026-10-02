// A standalone Mochi for windows other than the island (Settings, Hub): a small
// canvas with its own engine and frame loop.
//
// The loop stops by itself once the canvas leaves the document, so views that
// rebuild their DOM wholesale (the Hub does) never leak animation frames, and
// requestAnimationFrame already pauses while the window is hidden. A portrait
// that is moved around instead of rebuilt can be re-mounted with `mount()`.

import { BotEngine, EMOTE_SOUND } from "./engine";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";
import { music } from "../music/remote";
import { stationById } from "../music/stations";
import { currentLook, onLookChange } from "./occasions";

export interface PortraitOptions {
  /** Canvas size in CSS pixels; the body is about 70 % of it. */
  size: number;
  state?: BotStateName;
  /** Wave hello once it appears. */
  greet?: boolean;
  /** Eyes follow the pointer anywhere in the window. */
  follow?: boolean;
  /** Moods it drifts through on its own, every few seconds. */
  idleMoods?: BotEmoteName[];
  /** Moods a click picks from. */
  clickMoods?: BotEmoteName[];
  /** Extra room above the body for hearts and z's. */
  overhang?: number;
  /** Extra room on each side for confetti and notes. */
  padX?: number;
  /** Put headphones on and dance whenever Mochi's music is playing. */
  dance?: boolean;
  /** "worn" (default) follows the wardrobe; "manual" lets the owner set engine.outfit. */
  outfit?: "worn" | "none" | "manual";
  label?: string;
}

export interface Portrait {
  canvas: HTMLCanvasElement;
  engine: BotEngine;
  /** Re-attach after the canvas was removed (restarts the frame loop). */
  mount(parent: Element): void;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function createPortrait(opts: PortraitOptions): Portrait {
  const { size, overhang = 0, padX = 0 } = opts;
  const w = size + padX * 2;
  const hgt = size + overhang;
  const canvas = document.createElement("canvas");
  canvas.className = "mochi-portrait";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label ?? "Mochi");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  if (padX) canvas.style.margin = `0 -${padX}px`;

  const engine = new BotEngine();
  engine.particleOverhang = overhang;
  engine.particlePadX = padX;
  if (opts.state) engine.setState(opts.state, true);
  const ctx = canvas.getContext("2d");
  const calm = reducedMotion();

  let last = performance.now();
  let seen = false;
  let frames = 0;
  let running = false;
  let nextMood = performance.now() + 2500 + Math.random() * 3000;

  // Dancing: follow the music host's state and beat.
  const applyMusic = () => {
    const s = music.state;
    engine.phonesColors = stationById(s.station).colors;
    engine.wearPhones(s.playing);
  };
  const look = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    engine.lookX = Math.tanh((e.clientX - (r.left + r.width / 2)) / 260);
    engine.lookY = -Math.tanh((e.clientY - (r.top + r.height / 2)) / 200);
  };
  // Listeners live exactly as long as the frame loop, so discarded portraits
  // leave nothing behind.
  let detach: (() => void)[] = [];
  const attach = () => {
    if ((opts.outfit ?? "worn") === "worn") {
      engine.outfit = currentLook();
      detach.push(onLookChange((look) => { engine.outfit = look; }));
    }
    if (opts.dance) {
      detach.push(music.onState(applyMusic));
      // …and sings along to the melody.
      detach.push(music.onNote((n) => {
        if (!document.hidden && !music.state.ducked && !engine.emoting) engine.sing(n.midi, n.dur, n.low, n.high);
      }));
      applyMusic();
    }
    if (opts.follow) {
      window.addEventListener("mousemove", look, { passive: true });
      detach.push(() => window.removeEventListener("mousemove", look));
    }
  };

  const frame = (t: number) => {
    frames++;
    if (canvas.isConnected) seen = true;
    else if (seen || frames > 60) {
      // Never inserted after a second, or removed since: stop until re-mounted.
      running = false;
      for (const off of detach) off();
      detach = [];
      return;
    }
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!calm && opts.idleMoods?.length && t > nextMood && !engine.emoting) {
      engine.triggerEmote(opts.idleMoods[Math.floor(Math.random() * opts.idleMoods.length)]);
      nextMood = t + 4500 + Math.random() * 5000;
    }
    if (opts.dance && !calm) {
      const pos = music.beatPos();
      engine.beatPos = pos;
      engine.grooveTarget = pos == null ? 0 : music.state.ducked ? 0.3 : 1;
    }
    engine.update(dt);
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, hgt);
      engine.draw(ctx, w, hgt);
    }
    requestAnimationFrame(frame);
  };
  const start = () => {
    if (running) return;
    running = true;
    seen = false;
    frames = 0;
    last = performance.now();
    attach();
    requestAnimationFrame(frame);
  };
  start();

  if (opts.greet && !calm) window.setTimeout(() => engine.greet(), 350);

  if (opts.clickMoods?.length) {
    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", () => {
      const mood = opts.clickMoods![Math.floor(Math.random() * opts.clickMoods!.length)];
      engine.squash();
      engine.triggerEmote(mood);
      const sound = EMOTE_SOUND[mood];
      if (sound) Sound.play(sound);
    });
  }

  return {
    canvas,
    engine,
    mount(parent: Element) {
      parent.append(canvas);
      start();
    },
  };
}

/** Fire-and-forget portrait: just the canvas. */
export function mochiPortrait(opts: PortraitOptions): HTMLCanvasElement {
  return createPortrait(opts).canvas;
}
