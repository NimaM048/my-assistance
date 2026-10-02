// What Mochi holds while Claude works — reading glasses and a book for Read, a
// magnifying glass for searches, a hammer for edits, a tiny laptop for shell
// commands, a globe for the web and a clipboard for to-do lists.
//
// Drawn in code like the rest of Mochi, in the body's own space (origin at the
// body centre, y down, already tilted and squashed), so props bob and squash
// with Mochi for free. Sizes are fractions of R, the body radius.

import type { EyeSpot } from "./accessories";

export type ToolProp = "glasses" | "magnifier" | "hammer" | "terminal" | "globe" | "checklist";

/** Which prop a Claude Code / Codex tool call gets (null = just "working"). */
export function propForTool(tool: string): ToolProp | null {
  switch (tool) {
    case "Read":
    case "NotebookRead":
      return "glasses";
    case "Grep":
    case "Glob":
    case "LS":
      return "magnifier";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "apply_patch":
      return "hammer";
    case "Bash":
    case "PowerShell":
    case "BashOutput":
    case "shell":
    case "exec_command":
      return "terminal";
    case "WebFetch":
    case "WebSearch":
    case "web_search":
      return "globe";
    case "TodoWrite":
    case "update_plan":
      return "checklist";
    default:
      return null;
  }
}

/** Where Mochi looks while using a prop: [yaw, pitch] targets. */
export function propLook(prop: ToolProp, t: number): [number, number] {
  switch (prop) {
    case "glasses": {
      // Reading: eyes sweep along a line, then hop back to the next one.
      const line = (t * 0.55) % 1;
      return [-0.32 + line * 0.64, -0.2];
    }
    case "magnifier":
      return [0.32 + Math.sin(t * 1.6) * 0.3, 0.02];
    case "hammer":
      return [0.42, -0.12];
    case "terminal":
      return [Math.sin(t * 2.2) * 0.08, -0.28];
    case "globe":
      return [0.45, 0.08];
    case "checklist":
      return [0.38, -0.1];
  }
}

export interface PropGeom {
  R: number;
  rx: number;
  ry: number;
  t: number;
  /** 0 → 1 as the prop pops in. */
  k: number;
  eyes: [EyeSpot, EyeSpot];
}

type Ctx = CanvasRenderingContext2D;

function rr(x: Ctx, X: number, Y: number, W: number, H: number, r: number) {
  const k = Math.max(0, Math.min(r, W / 2, H / 2));
  x.beginPath();
  x.moveTo(X + k, Y);
  x.arcTo(X + W, Y, X + W, Y + H, k);
  x.arcTo(X + W, Y + H, X, Y + H, k);
  x.arcTo(X, Y + H, X, Y, k);
  x.arcTo(X, Y, X + W, Y, k);
  x.closePath();
}

/** A little hand, same soft grey as Mochi. */
function hand(x: Ctx, px: number, py: number, R: number, rot = 0) {
  x.save();
  x.translate(px, py);
  x.rotate(rot);
  const g = x.createLinearGradient(R * 0.2, -R * 0.2, -R * 0.2, R * 0.2);
  g.addColorStop(0, "#EDEDEF");
  g.addColorStop(1, "#C4C5CA");
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(0, 0, R * 0.17, R * 0.145, 0, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = "rgba(0,0,0,0.12)";
  x.lineWidth = Math.max(0.6, R * 0.02);
  x.stroke();
  x.restore();
}

/** Hammer swing angle at time t: a slow lift, a quick strike, a little rebound. */
export function hammerPhase(t: number): { angle: number; cycle: number; struck: boolean } {
  const period = 0.62;
  const cycle = Math.floor(t / period);
  const p = (t % period) / period;
  let angle: number;
  if (p < 0.55) angle = -1.05 * Math.sin((p / 0.55) * Math.PI * 0.5); // lift
  else if (p < 0.68) angle = -1.05 + 1.35 * ((p - 0.55) / 0.13); // strike
  else angle = 0.3 - 0.3 * ((p - 0.68) / 0.32) + Math.sin((p - 0.68) * 30) * 0.03; // settle
  return { angle, cycle, struck: p >= 0.68 };
}

/**
 * Draws the prop. Returns where something just happened (a hammer blow), in
 * body coordinates, so the engine can throw a spark there.
 */
export function drawProp(x: Ctx, prop: ToolProp, g: PropGeom): void {
  const { R, rx, ry, t, k } = g;
  if (k <= 0.01) return;
  x.save();
  x.globalAlpha *= Math.min(1, k * 1.5);
  switch (prop) {
    case "glasses": {
      // A little open book held low, and half-moon reading glasses.
      const by = ry * 0.62;
      x.save();
      x.translate(0, by + (1 - k) * R * 0.4);
      x.scale(k, k);
      const w = R * 0.62;
      const h = R * 0.38;
      for (const sd of [-1, 1]) {
        x.save();
        x.scale(sd, 1);
        const cover = x.createLinearGradient(0, -h, w, h);
        cover.addColorStop(0, "#ff8fab");
        cover.addColorStop(1, "#e05f84");
        x.fillStyle = cover;
        x.beginPath();
        x.moveTo(0, -h * 0.45);
        x.quadraticCurveTo(w * 0.5, -h * 0.75, w * 1.04, -h * 0.55);
        x.lineTo(w * 1.04, h * 0.55);
        x.quadraticCurveTo(w * 0.5, h * 0.35, 0, h * 0.6);
        x.closePath();
        x.fill();
        x.fillStyle = "#fbf7ef";
        x.beginPath();
        x.moveTo(0, -h * 0.38);
        x.quadraticCurveTo(w * 0.5, -h * 0.66, w * 0.96, -h * 0.47);
        x.lineTo(w * 0.96, h * 0.42);
        x.quadraticCurveTo(w * 0.5, h * 0.24, 0, h * 0.5);
        x.closePath();
        x.fill();
        x.strokeStyle = "rgba(90,90,110,0.45)";
        x.lineWidth = Math.max(0.6, R * 0.025);
        for (let i = 0; i < 3; i++) {
          const ly = -h * 0.22 + i * h * 0.22;
          x.beginPath();
          x.moveTo(w * 0.16, ly);
          x.lineTo(w * (i === 2 ? 0.55 : 0.8), ly - h * 0.06);
          x.stroke();
        }
        x.restore();
      }
      // A page turning now and then.
      const turn = (t * 0.35) % 1;
      if (turn > 0.86) {
        const a = (turn - 0.86) / 0.14;
        x.fillStyle = "rgba(251,247,239,0.95)";
        x.beginPath();
        x.moveTo(0, -h * 0.4);
        x.lineTo(w * 0.9 * Math.cos(a * Math.PI), -h * 0.5 - Math.sin(a * Math.PI) * h * 0.3);
        x.lineTo(w * 0.9 * Math.cos(a * Math.PI), h * 0.4 - Math.sin(a * Math.PI) * h * 0.3);
        x.lineTo(0, h * 0.5);
        x.closePath();
        x.fill();
      }
      x.restore();
      hand(x, -rx * 0.62, by + R * 0.1, R, 0.3);
      hand(x, rx * 0.62, by + R * 0.1, R, -0.3);
      // Half-moon glasses on the eyes.
      x.lineCap = "round";
      for (const e of g.eyes) {
        if (!e.visible) continue;
        x.fillStyle = "rgba(200,230,255,0.22)";
        x.strokeStyle = "#7a4b2a";
        x.lineWidth = R * 0.05;
        x.beginPath();
        x.ellipse(e.x, e.y + R * 0.04, R * 0.21 * e.fx, R * 0.15, 0, -0.15, Math.PI + 0.15);
        x.closePath();
        x.fill();
        x.stroke();
      }
      const [l, r] = g.eyes;
      if (l.visible && r.visible) {
        x.beginPath();
        x.moveTo(l.x + R * 0.2 * l.fx, l.y);
        x.quadraticCurveTo((l.x + r.x) / 2, l.y - R * 0.07, r.x - R * 0.2 * r.fx, r.y);
        x.stroke();
      }
      break;
    }

    case "magnifier": {
      const lx = rx * 0.78 + Math.sin(t * 1.6) * rx * 0.28;
      const ly = -ry * 0.08 + Math.cos(t * 3.2) * R * 0.04;
      const lr = R * 0.3 * k;
      // Handle down and out to the hand.
      const hx = lx + R * 0.36;
      const hy = ly + R * 0.42;
      x.strokeStyle = "#6b4a2b";
      x.lineCap = "round";
      x.lineWidth = R * 0.1;
      x.beginPath();
      x.moveTo(lx + lr * 0.7, ly + lr * 0.7);
      x.lineTo(hx, hy);
      x.stroke();
      const glass = x.createRadialGradient(lx - lr * 0.3, ly - lr * 0.3, 0, lx, ly, lr);
      glass.addColorStop(0, "rgba(235,248,255,0.55)");
      glass.addColorStop(1, "rgba(150,205,255,0.28)");
      x.fillStyle = glass;
      x.beginPath();
      x.arc(lx, ly, lr, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = "#454a59";
      x.lineWidth = R * 0.075;
      x.stroke();
      x.strokeStyle = "rgba(255,255,255,0.85)";
      x.lineWidth = R * 0.04;
      x.beginPath();
      x.arc(lx, ly, lr * 0.68, Math.PI * 1.1, Math.PI * 1.45);
      x.stroke();
      hand(x, hx, hy, R, 0.6);
      break;
    }

    case "hammer": {
      // A plank with a nail Mochi is knocking in, a little lower every blow.
      const px = rx * 1.18;
      const py = ry * 0.98;
      x.fillStyle = "#c98b52";
      rr(x, px - R * 0.42, py, R * 0.84, R * 0.16, R * 0.05);
      x.fill();
      x.fillStyle = "rgba(0,0,0,0.12)";
      rr(x, px - R * 0.42, py + R * 0.1, R * 0.84, R * 0.06, R * 0.03);
      x.fill();
      const { angle, cycle } = hammerPhase(t);
      const depth = (cycle % 6) / 6;
      x.strokeStyle = "#9aa3b8";
      x.lineWidth = R * 0.05;
      x.beginPath();
      x.moveTo(px + R * 0.12, py);
      x.lineTo(px + R * 0.12, py - R * 0.2 * (1 - depth) - R * 0.03);
      x.stroke();
      // The hammer pivots at the hand.
      const hx = rx * 0.86;
      const hy = ry * 0.4;
      x.save();
      x.translate(hx, hy);
      x.rotate(angle * k);
      x.strokeStyle = "#8a5a32";
      x.lineWidth = R * 0.1;
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(0, 0);
      x.lineTo(R * 0.52, -R * 0.12);
      x.stroke();
      x.save();
      x.translate(R * 0.56, -R * 0.13);
      x.rotate(-0.22);
      const head = x.createLinearGradient(0, -R * 0.2, 0, R * 0.2);
      head.addColorStop(0, "#c9ced8");
      head.addColorStop(1, "#7d8494");
      x.fillStyle = head;
      rr(x, -R * 0.11, -R * 0.2, R * 0.22, R * 0.4, R * 0.05);
      x.fill();
      x.restore();
      x.restore();
      hand(x, hx, hy, R, angle * 0.5);
      break;
    }

    case "terminal": {
      // A tiny laptop in front of Mochi, with a blinking prompt and scrolling lines.
      const sw = R * 1.06;
      const sh = R * 0.66;
      const sx = -sw / 2;
      const sy = ry * 0.22 + (1 - k) * R * 0.5;
      x.save();
      x.fillStyle = "#2b3040";
      rr(x, sx - R * 0.04, sy - R * 0.04, sw + R * 0.08, sh + R * 0.08, R * 0.08);
      x.fill();
      x.fillStyle = "#11141c";
      rr(x, sx, sy, sw, sh, R * 0.05);
      x.fill();
      x.save();
      rr(x, sx, sy, sw, sh, R * 0.05);
      x.clip();
      const colors = ["#7ee787", "#79c0ff", "#d2a8ff", "#ffa657"];
      const lineH = R * 0.12;
      const scroll = (t * 1.6) % 1;
      for (let i = 0; i < 6; i++) {
        const ly = sy + R * 0.1 + (i - scroll) * lineH;
        const seed = (Math.floor(t * 1.6) + i) * 7.31;
        const len = 0.25 + ((Math.sin(seed) + 1) / 2) * 0.55;
        x.fillStyle = colors[Math.abs(Math.floor(seed)) % colors.length];
        x.globalAlpha = 0.85;
        rr(x, sx + R * 0.16, ly, sw * len * 0.75, lineH * 0.45, lineH * 0.2);
        x.fill();
      }
      x.globalAlpha = 1;
      x.fillStyle = "#7ee787";
      x.font = `800 ${R * 0.2}px ui-monospace, Consolas, monospace`;
      x.textBaseline = "middle";
      x.fillText(">", sx + R * 0.05, sy + sh - R * 0.13);
      if (Math.floor(t * 2.4) % 2 === 0) {
        x.fillRect(sx + R * 0.2, sy + sh - R * 0.21, R * 0.1, R * 0.16);
      }
      x.restore();
      // Keyboard base.
      x.fillStyle = "#c7cbd6";
      x.beginPath();
      x.moveTo(sx - R * 0.12, sy + sh + R * 0.06);
      x.lineTo(sx + sw + R * 0.12, sy + sh + R * 0.06);
      x.lineTo(sx + sw + R * 0.2, sy + sh + R * 0.2);
      x.lineTo(sx - R * 0.2, sy + sh + R * 0.2);
      x.closePath();
      x.fill();
      x.restore();
      // Typing: the hands take turns.
      const tap = Math.sin(t * 16);
      hand(x, -sw * 0.32, sy + sh + R * 0.1 - Math.max(0, tap) * R * 0.08, R, 0.2);
      hand(x, sw * 0.32, sy + sh + R * 0.1 - Math.max(0, -tap) * R * 0.08, R, -0.2);
      break;
    }

    case "globe": {
      const gx = rx * 1.02;
      const gy = -ry * 0.02 + Math.sin(t * 2.4) * R * 0.04;
      const gr = R * 0.3 * k;
      x.save();
      x.beginPath();
      x.arc(gx, gy, gr, 0, Math.PI * 2);
      const sea = x.createRadialGradient(gx - gr * 0.35, gy - gr * 0.35, 0, gx, gy, gr);
      sea.addColorStop(0, "#7cc8ff");
      sea.addColorStop(1, "#2a6fd6");
      x.fillStyle = sea;
      x.fill();
      x.clip();
      // Continents slide past as it spins.
      x.fillStyle = "#5fd39a";
      const spin = (t * 0.35) % 1;
      for (const [ox, oy, w, h] of [[0, -0.2, 0.5, 0.32], [0.55, 0.25, 0.42, 0.28], [1.1, -0.05, 0.36, 0.4]] as const) {
        for (const wrap of [0, 1.6]) {
          const cx = gx + ((ox - spin * 1.6 + wrap) % 1.6 - 0.5) * gr * 2;
          x.beginPath();
          x.ellipse(cx, gy + oy * gr, w * gr, h * gr, 0.3, 0, Math.PI * 2);
          x.fill();
        }
      }
      x.restore();
      x.strokeStyle = "rgba(255,255,255,0.45)";
      x.lineWidth = Math.max(0.6, R * 0.025);
      x.beginPath();
      x.ellipse(gx, gy, gr * Math.abs(Math.cos(t * 2)), gr, 0, 0, Math.PI * 2);
      x.stroke();
      x.beginPath();
      x.moveTo(gx - gr, gy);
      x.lineTo(gx + gr, gy);
      x.stroke();
      hand(x, gx - R * 0.04, gy + gr + R * 0.06, R, 0);
      break;
    }

    case "checklist": {
      const cx = rx * 0.98;
      const cy = ry * 0.12;
      const w = R * 0.52;
      const h = R * 0.66;
      x.save();
      x.translate(cx, cy);
      x.rotate(0.12);
      x.scale(k, k);
      x.fillStyle = "#b07b48";
      rr(x, -w / 2, -h / 2, w, h, R * 0.06);
      x.fill();
      x.fillStyle = "#fbf7ef";
      rr(x, -w / 2 + R * 0.05, -h / 2 + R * 0.08, w - R * 0.1, h - R * 0.13, R * 0.03);
      x.fill();
      x.fillStyle = "#9aa3b8";
      rr(x, -R * 0.1, -h / 2 - R * 0.03, R * 0.2, R * 0.09, R * 0.03);
      x.fill();
      const done = Math.floor((t * 1.2) % 4);
      for (let i = 0; i < 3; i++) {
        const ly = -h / 2 + R * 0.2 + i * R * 0.15;
        x.strokeStyle = "rgba(90,90,110,0.55)";
        x.lineWidth = Math.max(0.6, R * 0.03);
        x.beginPath();
        x.moveTo(-w / 2 + R * 0.2, ly);
        x.lineTo(w / 2 - R * 0.09, ly);
        x.stroke();
        x.strokeStyle = i < done ? "#22a06b" : "rgba(90,90,110,0.4)";
        x.lineWidth = Math.max(0.8, R * 0.04);
        x.beginPath();
        if (i < done) {
          x.moveTo(-w / 2 + R * 0.08, ly);
          x.lineTo(-w / 2 + R * 0.11, ly + R * 0.03);
          x.lineTo(-w / 2 + R * 0.16, ly - R * 0.04);
        } else {
          x.rect(-w / 2 + R * 0.08, ly - R * 0.03, R * 0.07, R * 0.07);
        }
        x.stroke();
      }
      x.restore();
      hand(x, cx - R * 0.12, cy + h * 0.45, R, 0.2);
      break;
    }
  }
  x.restore();
}
