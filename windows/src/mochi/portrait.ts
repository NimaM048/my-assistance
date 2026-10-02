// A standalone Mochi for windows other than the island (Settings, Hub): a small
// canvas with its own engine and frame loop.
//
// The loop stops by itself once the canvas leaves the document, so views that
// rebuild their DOM wholesale (the Hub does) never leak animation frames, and
// requestAnimationFrame already pauses while the window is hidden.

import { BotEngine, EMOTE_SOUND } from "./engine";
import { Sound } from "../core/sound";
import type { BotEmoteName, BotStateName } from "../core/layout";

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
  label?: string;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function mochiPortrait(opts: PortraitOptions): HTMLCanvasElement {
  const { size, overhang = 0 } = opts;
  const canvas = document.createElement("canvas");
  canvas.className = "mochi-portrait";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label ?? "Mochi");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round((size + overhang) * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size + overhang}px`;

  const engine = new BotEngine();
  engine.particleOverhang = overhang;
  if (opts.state) engine.setState(opts.state, true);
  const ctx = canvas.getContext("2d");

  let last = performance.now();
  let seen = false;
  let frames = 0;
  let nextMood = performance.now() + 2500 + Math.random() * 3000;
  const calm = reducedMotion();

  const frame = (t: number) => {
    // Never inserted after a second, or removed since: stop for good.
    frames++;
    if (canvas.isConnected) seen = true;
    else if (seen || frames > 60) return;

    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (!calm && opts.idleMoods?.length && t > nextMood && !engine.emoting) {
      engine.triggerEmote(opts.idleMoods[Math.floor(Math.random() * opts.idleMoods.length)]);
      nextMood = t + 4500 + Math.random() * 5000;
    }
    engine.update(dt);
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size + overhang);
      engine.draw(ctx, size, size + overhang);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (opts.greet && !calm) window.setTimeout(() => engine.greet(), 350);

  if (opts.follow) {
    const look = (e: MouseEvent) => {
      if (!canvas.isConnected && seen) {
        window.removeEventListener("mousemove", look);
        return;
      }
      const r = canvas.getBoundingClientRect();
      engine.lookX = Math.tanh((e.clientX - (r.left + r.width / 2)) / 260);
      engine.lookY = -Math.tanh((e.clientY - (r.top + r.height / 2)) / 200);
    };
    window.addEventListener("mousemove", look);
  }

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
  return canvas;
}
