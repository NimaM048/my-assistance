// Little Mochis for subagents. When Claude Code hands work to a subagent, a
// small Mochi pops out next to the big one and works alongside it; when the
// subagent is done it cheers, waves goodbye and hops away.
//
// Each mini is a BotEngine on its own small canvas, ticked by the island's
// frame loop like the integration pills.

import { Ease } from "../core/anim";
import { BotEngine, hexToRGB } from "./engine";

/** Pastel colours handed out in turn, so neighbours never match. */
const COLORS = ["#A78BFA", "#34D399", "#F472B6", "#60A5FA", "#FBBF24", "#FB7185"];
/** More than this and the extras just keep the count. */
const MAX_SHOWN = 6;

interface Mini {
  id: string;
  label: string;
  canvas: HTMLCanvasElement;
  engine: BotEngine;
  /** Current and target position, relative to the island. */
  x: number;
  y: number;
  tx: number;
  ty: number;
  scale: number;
  born: number;
  /** When it started leaving (ms), or null while it's working. */
  leavingAt: number | null;
  doneAt: number | null;
}

export interface SubagentAnchor {
  /** Big Mochi's centre and body size, relative to the island. */
  cx: number;
  cy: number;
  size: number;
  mode: "compact" | "expanded";
  /** False on views where minis would get in the way (approval, chat…). */
  visible: boolean;
}

export class SubagentLayer {
  readonly el: HTMLElement;
  private minis: Mini[] = [];
  private colorIndex = 0;
  private counter = 0;
  /** Subagents beyond MAX_SHOWN, still running. */
  private overflow = 0;
  private badge: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.id = "subagents";
    this.el.setAttribute("aria-hidden", "true");
    this.badge = document.createElement("span");
    this.badge.className = "sub-more";
    this.el.append(this.badge);
  }

  get count(): number {
    return this.minis.filter((m) => m.doneAt == null).length + this.overflow;
  }

  /** A subagent started. `id` comes from the hook (agent_id) when there is one. */
  spawn(id: string | undefined, label: string, anchor: SubagentAnchor) {
    const key = id || `sub-${++this.counter}`;
    if (this.minis.some((m) => m.id === key && m.doneAt == null)) return;
    if (this.minis.filter((m) => m.leavingAt == null).length >= MAX_SHOWN) {
      this.overflow++;
      this.paintBadge();
      return;
    }
    const color = COLORS[this.colorIndex++ % COLORS.length];
    const canvas = document.createElement("canvas");
    const engine = new BotEngine();
    engine.isMini = true;
    engine.miniHands = true;
    engine.bodyColor = hexToRGB(color);
    engine.setState("working", true);
    // Pops out of the big Mochi with a little hop.
    engine.triggerEmote("hop");
    this.el.append(canvas);
    const mini: Mini = {
      id: key, label, canvas, engine,
      x: anchor.cx, y: anchor.cy, tx: anchor.cx, ty: anchor.cy,
      scale: 0, born: performance.now(), leavingAt: null, doneAt: null,
    };
    canvas.title = label;
    this.minis.push(mini);
  }

  /** A subagent finished: cheer, wave goodbye, hop away. */
  finish(id: string | undefined) {
    if (!id && this.overflow > 0) {
      this.overflow--;
      this.paintBadge();
      return;
    }
    const mini = id
      ? this.minis.find((m) => m.id === id && m.doneAt == null)
      : this.minis.find((m) => m.doneAt == null);
    if (!mini) {
      if (this.overflow > 0) {
        this.overflow--;
        this.paintBadge();
      }
      return;
    }
    mini.doneAt = performance.now();
    mini.engine.setState("finished");
    mini.engine.cheer(1.1, "wave");
    window.setTimeout(() => { mini.leavingAt = performance.now(); }, 1300);
  }

  /** The session ended: everyone still here says goodbye. */
  clear() {
    this.overflow = 0;
    this.paintBadge();
    for (const m of this.minis) if (m.doneAt == null) this.finish(m.id);
  }

  private paintBadge() {
    this.badge.textContent = this.overflow > 0 ? `+${this.overflow}` : "";
    this.badge.style.display = this.overflow > 0 ? "" : "none";
  }

  /** Lays the minis out around the big Mochi and draws them. */
  tick(dt: number, anchor: SubagentAnchor) {
    const now = performance.now();
    const working = this.minis.filter((m) => m.leavingAt == null);
    const n = working.length;
    const body = anchor.mode === "compact" ? 10 : 15;
    working.forEach((m, i) => {
      if (anchor.mode === "compact") {
        // A little queue to the right of Mochi.
        m.tx = anchor.cx + anchor.size * 0.5 + 10 + i * (body + 3);
        m.ty = anchor.cy + 1;
      } else {
        // A row at Mochi's feet.
        m.tx = anchor.cx + (i - (n - 1) / 2) * (body + 3);
        m.ty = anchor.cy + anchor.size * 0.5 + body * 0.55;
      }
    });
    this.el.style.opacity = anchor.visible ? "1" : "0";
    this.badge.style.left = `${(working.at(-1)?.tx ?? anchor.cx) + body}px`;
    this.badge.style.top = `${(working.at(-1)?.ty ?? anchor.cy) - 6}px`;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = 1 - Math.pow(0.0005, dt);
    for (const m of [...this.minis]) {
      if (m.leavingAt != null) {
        const t = (now - m.leavingAt) / 650;
        if (t >= 1) {
          m.canvas.remove();
          this.minis.splice(this.minis.indexOf(m), 1);
          continue;
        }
        // Hops off to the right, getting smaller.
        m.tx = m.x + 60 * dt * 3;
        m.ty = m.y - Math.sin(t * Math.PI) * 0.8;
        m.scale = 1 - Ease.easeIn(t);
      } else {
        m.scale += (1 - m.scale) * (1 - Math.pow(0.0002, dt));
      }
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;

      const size = body * Math.max(0.01, m.scale);
      const canvasCss = size / 0.6;
      const px = Math.max(1, Math.round(canvasCss * dpr));
      if (m.canvas.width !== px) {
        m.canvas.width = px;
        m.canvas.height = px;
      }
      m.canvas.style.width = `${canvasCss}px`;
      m.canvas.style.height = `${canvasCss}px`;
      m.canvas.style.left = `${m.x - canvasCss / 2}px`;
      m.canvas.style.top = `${m.y - canvasCss / 2}px`;
      const ctx = m.canvas.getContext("2d");
      if (!ctx) continue;
      m.engine.update(dt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvasCss, canvasCss);
      m.engine.draw(ctx, canvasCss, canvasCss);
    }
  }
}
