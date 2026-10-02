// Mochi's wardrobe, drawn in code like Mochi itself — no images.
//
// Everything is drawn in the body's own coordinate space (origin at the body
// centre, y down, already tilted and squashed), so hats bob, scarves sway and
// glasses follow the eyes for free. Sizes are fractions of R, the body radius.

import type { Outfit } from "./growth";

export interface EyeSpot {
  x: number;
  y: number;
  /** Horizontal foreshortening as the eye turns away (1 = facing you). */
  fx: number;
  visible: boolean;
}

export interface OutfitGeom {
  R: number;
  rx: number;
  ry: number;
  yaw: number;
  eyes: [EyeSpot, EyeSpot];
  t: number;
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

function star(x: Ctx, cx: number, cy: number, ro: number, ri: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  x.closePath();
}

function heart(x: Ctx, cx: number, cy: number, s: number) {
  x.beginPath();
  x.moveTo(cx, cy + s * 0.38);
  x.bezierCurveTo(cx - s * 1.05, cy - s * 0.15, cx - s * 0.5, cy - s * 0.95, cx, cy - s * 0.38);
  x.bezierCurveTo(cx + s * 0.5, cy - s * 0.95, cx + s * 1.05, cy - s * 0.15, cx, cy + s * 0.38);
  x.closePath();
}

/** Headphone colours for a headphone item (or the station's own colours). */
export function phonesColorsFor(id: string | undefined, station: [string, string], t: number): [string, string] {
  switch (id) {
    case "phones-midnight": return ["#6f7fe0", "#27306b"];
    case "phones-mint": return ["#a8f7dc", "#36c495"];
    case "phones-gold": return ["#ffe9a0", "#d39b12"];
    case "phones-rainbow": {
      const h = (t * 70) % 360;
      return [`hsl(${h},95%,72%)`, `hsl(${(h + 70) % 360},90%,62%)`];
    }
    default: return station;
  }
}

/** Things that sit behind the head (cat ears). Called before the body is drawn. */
export function drawOutfitBack(x: Ctx, outfit: Outfit, g: OutfitGeom) {
  if (outfit.hat !== "cat-ears") return;
  const { R, rx, ry } = g;
  for (const sd of [-1, 1]) {
    x.save();
    x.translate(sd * rx * 0.56, -ry * 0.7);
    x.rotate(sd * 0.38 + Math.sin(g.t * 3 + sd) * 0.04);
    const grad = x.createLinearGradient(0, -R * 0.45, 0, 0);
    grad.addColorStop(0, "#f2f2f4");
    grad.addColorStop(1, "#cfd0d5");
    x.beginPath();
    x.moveTo(-R * 0.22, R * 0.04);
    x.quadraticCurveTo(-R * 0.08, -R * 0.36, 0, -R * 0.46);
    x.quadraticCurveTo(R * 0.08, -R * 0.36, R * 0.22, R * 0.04);
    x.closePath();
    x.fillStyle = grad;
    x.fill();
    x.beginPath();
    x.moveTo(-R * 0.11, -R * 0.02);
    x.quadraticCurveTo(-R * 0.03, -R * 0.24, 0, -R * 0.31);
    x.quadraticCurveTo(R * 0.03, -R * 0.24, R * 0.11, -R * 0.02);
    x.closePath();
    x.fillStyle = "#ffb3c7";
    x.fill();
    x.restore();
  }
}

/** Everything worn on top of the body: neck, face, then hat. */
export function drawOutfitFront(x: Ctx, outfit: Outfit, g: OutfitGeom) {
  if (outfit.neck) drawNeck(x, outfit.neck, g);
  if (outfit.face) drawFace(x, outfit.face, g);
  if (outfit.hat) drawHat(x, outfit.hat, g);
}

function drawHat(x: Ctx, id: string, g: OutfitGeom) {
  const { R, rx, ry, t } = g;
  x.save();
  switch (id) {
    case "sprout": {
      x.translate(0, -ry * 0.95);
      x.rotate(Math.sin(t * 2.2) * 0.14);
      x.strokeStyle = "#4fa65e";
      x.lineWidth = R * 0.06;
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(R * 0.05, -R * 0.18, 0, -R * 0.34);
      x.stroke();
      for (const [sd, ang] of [[-1, -0.7], [1, 0.6]] as const) {
        x.save();
        x.translate(sd * R * 0.11, -R * 0.34);
        x.rotate(ang);
        const lg = x.createLinearGradient(-R * 0.14, 0, R * 0.14, 0);
        lg.addColorStop(0, "#9be3a3");
        lg.addColorStop(1, "#56b866");
        x.fillStyle = lg;
        x.beginPath();
        x.ellipse(0, 0, R * 0.15, R * 0.075, 0, 0, Math.PI * 2);
        x.fill();
        x.strokeStyle = "rgba(40,110,55,.5)";
        x.lineWidth = R * 0.015;
        x.beginPath();
        x.moveTo(-R * 0.12, 0);
        x.lineTo(R * 0.12, 0);
        x.stroke();
        x.restore();
      }
      break;
    }
    case "party": {
      x.translate(R * 0.3, -ry * 0.8);
      x.rotate(0.34);
      x.beginPath();
      x.moveTo(-R * 0.27, 0);
      x.lineTo(0, -R * 0.74);
      x.lineTo(R * 0.27, 0);
      x.closePath();
      const pg = x.createLinearGradient(-R * 0.27, 0, R * 0.27, -R * 0.7);
      pg.addColorStop(0, "#ff6fa8");
      pg.addColorStop(1, "#9a7bff");
      x.fillStyle = pg;
      x.fill();
      x.save();
      x.clip();
      x.strokeStyle = "rgba(255,255,255,.75)";
      x.lineWidth = R * 0.06;
      for (let i = -3; i < 4; i++) {
        x.beginPath();
        x.moveTo(-R * 0.4, i * R * 0.2);
        x.lineTo(R * 0.4, i * R * 0.2 - R * 0.3);
        x.stroke();
      }
      x.restore();
      x.fillStyle = "#ffd85a";
      x.beginPath();
      x.arc(0, -R * 0.76, R * 0.09, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#ffffff";
      x.beginPath();
      x.ellipse(0, 0, R * 0.29, R * 0.06, 0, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case "beanie": {
      x.beginPath();
      x.ellipse(0, -ry * 0.56, rx * 0.88, ry * 0.56, 0, Math.PI, Math.PI * 2);
      x.closePath();
      const bg = x.createLinearGradient(0, -ry * 1.1, 0, -ry * 0.5);
      bg.addColorStop(0, "#5c7fd6");
      bg.addColorStop(1, "#3c5aa6");
      x.fillStyle = bg;
      x.fill();
      x.save();
      x.clip();
      x.strokeStyle = "rgba(255,255,255,.12)";
      x.lineWidth = R * 0.05;
      for (let i = -5; i <= 5; i++) {
        x.beginPath();
        x.moveTo(i * R * 0.17, -ry * 1.2);
        x.lineTo(i * R * 0.17, -ry * 0.4);
        x.stroke();
      }
      x.restore();
      rr(x, -rx * 0.92, -ry * 0.64, rx * 1.84, R * 0.24, R * 0.11);
      x.fillStyle = "#f2c14e";
      x.fill();
      x.fillStyle = "#f7d277";
      x.beginPath();
      x.arc(0, -ry * 1.14, R * 0.15, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case "bow": {
      x.translate(rx * 0.48, -ry * 0.82);
      x.rotate(0.28);
      x.fillStyle = "#ff7aa8";
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.ellipse(sd * R * 0.16, 0, R * 0.17, R * 0.11, sd * 0.35, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = "rgba(255,255,255,.35)";
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.ellipse(sd * R * 0.19, -R * 0.03, R * 0.06, R * 0.03, sd * 0.35, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = "#ff4f8b";
      x.beginPath();
      x.arc(0, 0, R * 0.075, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case "flowers": {
      const colors = ["#ffb3c7", "#fff1a8", "#c9b6ff", "#ffd0a8", "#b8f0d0", "#ffb3c7"];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (1.12 + i * 0.152);
        const px = Math.cos(a) * rx * 0.9;
        const py = Math.sin(a) * ry * 1.0 + ry * 0.04;
        x.fillStyle = "#6cc27a";
        x.beginPath();
        x.ellipse(px + R * 0.07, py + R * 0.03, R * 0.07, R * 0.035, 0.6, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = colors[i];
        for (let k = 0; k < 5; k++) {
          const pa = (k / 5) * Math.PI * 2 + t * 0.4 * (i % 2 ? 1 : -1);
          x.beginPath();
          x.arc(px + Math.cos(pa) * R * 0.065, py + Math.sin(pa) * R * 0.065, R * 0.06, 0, Math.PI * 2);
          x.fill();
        }
        x.fillStyle = "#ffcf4a";
        x.beginPath();
        x.arc(px, py, R * 0.045, 0, Math.PI * 2);
        x.fill();
      }
      break;
    }
    case "crown": {
      x.translate(0, -ry * 0.88);
      x.beginPath();
      x.moveTo(-R * 0.42, 0);
      x.lineTo(-R * 0.46, -R * 0.34);
      x.lineTo(-R * 0.22, -R * 0.15);
      x.lineTo(0, -R * 0.42);
      x.lineTo(R * 0.22, -R * 0.15);
      x.lineTo(R * 0.46, -R * 0.34);
      x.lineTo(R * 0.42, 0);
      x.closePath();
      const cg = x.createLinearGradient(0, -R * 0.42, 0, 0);
      cg.addColorStop(0, "#fff0a0");
      cg.addColorStop(1, "#e0a21a");
      x.fillStyle = cg;
      x.fill();
      x.strokeStyle = "#b77f0a";
      x.lineWidth = R * 0.025;
      x.stroke();
      for (const [px, py, c] of [[-R * 0.46, -R * 0.34, "#ff5c7a"], [0, -R * 0.42, "#5cc8ff"], [R * 0.46, -R * 0.34, "#7ce38b"]] as const) {
        x.fillStyle = c;
        x.beginPath();
        x.arc(px, py, R * 0.055, 0, Math.PI * 2);
        x.fill();
      }
      const tw = 0.5 + 0.5 * Math.sin(t * 4);
      x.fillStyle = `rgba(255,255,255,${0.5 + tw * 0.5})`;
      star(x, R * 0.18, -R * 0.08, R * 0.06 * (0.6 + tw * 0.4), R * 0.015);
      x.fill();
      break;
    }
    case "sabzeh": {
      // Nowruz wheatgrass in a little dish, tied with a red ribbon.
      x.translate(0, -ry * 0.9);
      x.fillStyle = "#e9e2d0";
      rr(x, -R * 0.3, -R * 0.1, R * 0.6, R * 0.14, R * 0.06);
      x.fill();
      for (let i = 0; i < 22; i++) {
        const px = -R * 0.26 + (i / 21) * R * 0.52;
        const hgt = R * (0.3 + ((i * 37) % 10) / 40);
        const sway = Math.sin(t * 2 + i) * R * 0.03;
        x.strokeStyle = i % 3 ? "#5fbf5f" : "#7fd86f";
        x.lineWidth = R * 0.035;
        x.lineCap = "round";
        x.beginPath();
        x.moveTo(px, -R * 0.08);
        x.quadraticCurveTo(px + sway * 0.5, -R * 0.08 - hgt * 0.6, px + sway, -R * 0.08 - hgt);
        x.stroke();
      }
      x.fillStyle = "#e23d4b";
      rr(x, -R * 0.3, -R * 0.2, R * 0.6, R * 0.07, R * 0.03);
      x.fill();
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.ellipse(sd * R * 0.08, -R * 0.2, R * 0.08, R * 0.045, sd * 0.4, 0, Math.PI * 2);
        x.fill();
      }
      break;
    }
    case "pomegranate": {
      // Yalda's pomegranate, perched on top with its little crown.
      x.translate(R * 0.12, -ry * 0.96);
      x.rotate(0.2);
      const pg = x.createRadialGradient(-R * 0.08, -R * 0.12, R * 0.02, 0, -R * 0.02, R * 0.26);
      pg.addColorStop(0, "#ff7a86");
      pg.addColorStop(1, "#b3122c");
      x.fillStyle = pg;
      x.beginPath();
      x.arc(0, -R * 0.06, R * 0.24, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = "#8f0f24";
      x.beginPath();
      x.moveTo(-R * 0.08, -R * 0.27);
      for (let i = 0; i < 5; i++) {
        const px = -R * 0.08 + i * R * 0.04;
        x.lineTo(px, -R * (i % 2 ? 0.34 : 0.4));
      }
      x.lineTo(R * 0.08, -R * 0.27);
      x.closePath();
      x.fill();
      x.fillStyle = "rgba(255,255,255,.4)";
      x.beginPath();
      x.ellipse(-R * 0.1, -R * 0.14, R * 0.06, R * 0.035, -0.6, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case "wizard": {
      x.translate(R * 0.08, -ry * 0.78);
      x.rotate(-0.16);
      x.fillStyle = "#4b3a9e";
      x.beginPath();
      x.ellipse(0, 0, R * 0.62, R * 0.13, 0, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.moveTo(-R * 0.36, 0);
      x.quadraticCurveTo(-R * 0.1, -R * 0.6, R * 0.32, -R * 0.98);
      x.quadraticCurveTo(R * 0.2, -R * 0.5, R * 0.36, 0);
      x.closePath();
      const wg = x.createLinearGradient(0, -R, 0, 0);
      wg.addColorStop(0, "#7c66ea");
      wg.addColorStop(1, "#3b2a8a");
      x.fillStyle = wg;
      x.fill();
      x.fillStyle = "#f2c14e";
      rr(x, -R * 0.36, -R * 0.12, R * 0.72, R * 0.1, R * 0.04);
      x.fill();
      for (const [px, py, s] of [[-R * 0.05, -R * 0.38, 0.07], [R * 0.12, -R * 0.62, 0.05], [-R * 0.18, -R * 0.2, 0.04]] as const) {
        x.fillStyle = `rgba(255,236,150,${0.7 + 0.3 * Math.sin(t * 3 + px)})`;
        star(x, px, py, R * s, R * s * 0.45);
        x.fill();
      }
      break;
    }
  }
  x.restore();
}

function drawFace(x: Ctx, id: string, g: OutfitGeom) {
  const { R, rx, ry, eyes } = g;
  const [l, r] = eyes;
  x.save();
  x.lineCap = "round";
  const bridge = (color: string, w: number, reach: number) => {
    if (!l.visible || !r.visible) return;
    x.strokeStyle = color;
    x.lineWidth = w;
    x.beginPath();
    x.moveTo(l.x + reach * l.fx, l.y - R * 0.02);
    x.quadraticCurveTo((l.x + r.x) / 2, l.y - R * 0.09, r.x - reach * r.fx, r.y - R * 0.02);
    x.stroke();
  };
  switch (id) {
    case "round-glasses": {
      for (const e of eyes) {
        if (!e.visible) continue;
        x.fillStyle = "rgba(190,225,255,0.18)";
        x.strokeStyle = "#3a2c24";
        x.lineWidth = R * 0.045;
        x.beginPath();
        x.ellipse(e.x, e.y, R * 0.2 * e.fx, R * 0.2, 0, 0, Math.PI * 2);
        x.fill();
        x.stroke();
        x.strokeStyle = "rgba(255,255,255,.6)";
        x.lineWidth = R * 0.02;
        x.beginPath();
        x.arc(e.x - R * 0.05 * e.fx, e.y - R * 0.05, R * 0.11, Math.PI * 1.1, Math.PI * 1.5);
        x.stroke();
      }
      bridge("#3a2c24", R * 0.04, R * 0.2);
      break;
    }
    case "sunglasses": {
      for (const e of eyes) {
        if (!e.visible) continue;
        const w = R * 0.42 * e.fx;
        rr(x, e.x - w / 2, e.y - R * 0.15, w, R * 0.3, R * 0.1);
        const sg = x.createLinearGradient(0, e.y - R * 0.15, 0, e.y + R * 0.15);
        sg.addColorStop(0, "#3b3f4d");
        sg.addColorStop(1, "#14161c");
        x.fillStyle = sg;
        x.fill();
        x.strokeStyle = "rgba(255,255,255,.35)";
        x.lineWidth = R * 0.03;
        x.beginPath();
        x.moveTo(e.x - w * 0.3, e.y - R * 0.06);
        x.lineTo(e.x - w * 0.05, e.y - R * 0.1);
        x.stroke();
      }
      bridge("#14161c", R * 0.05, R * 0.2);
      break;
    }
    case "star-shades": {
      for (const e of eyes) {
        if (!e.visible) continue;
        x.save();
        x.translate(e.x, e.y);
        x.scale(e.fx, 1);
        star(x, 0, 0, R * 0.26, R * 0.13);
        x.fillStyle = "rgba(255,110,180,.85)";
        x.fill();
        x.strokeStyle = "#c7357a";
        x.lineWidth = R * 0.03;
        x.stroke();
        x.fillStyle = "rgba(255,255,255,.7)";
        x.beginPath();
        x.arc(-R * 0.06, -R * 0.06, R * 0.04, 0, Math.PI * 2);
        x.fill();
        x.restore();
      }
      bridge("#c7357a", R * 0.04, R * 0.18);
      break;
    }
    case "hearts": {
      const off = Math.sin(g.yaw) * rx * 0.8;
      x.fillStyle = "#ff5c8a";
      for (const sd of [-1, 1]) heart(x, sd * rx * 0.56 + off, ry * 0.26, R * 0.1);
      x.fill();
      break;
    }
    case "monocle": {
      const e = r.visible ? r : l;
      if (!e.visible) break;
      x.strokeStyle = "#d9a520";
      x.lineWidth = R * 0.045;
      x.fillStyle = "rgba(220,240,255,.2)";
      x.beginPath();
      x.ellipse(e.x, e.y, R * 0.21 * e.fx, R * 0.21, 0, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      x.setLineDash([R * 0.03, R * 0.03]);
      x.lineWidth = R * 0.02;
      x.beginPath();
      x.moveTo(e.x + R * 0.15 * e.fx, e.y + R * 0.15);
      x.quadraticCurveTo(e.x + R * 0.35, ry * 0.4, e.x + R * 0.18, ry * 0.75);
      x.stroke();
      x.setLineDash([]);
      break;
    }
  }
  x.restore();
}

function drawNeck(x: Ctx, id: string, g: OutfitGeom) {
  const { R, rx, ry, t } = g;
  x.save();
  switch (id) {
    case "scarf": {
      const y0 = ry * 0.5;
      rr(x, -rx * 0.92, y0, rx * 1.84, R * 0.24, R * 0.12);
      x.fillStyle = "#e8504f";
      x.fill();
      x.save();
      x.clip();
      x.fillStyle = "rgba(255,255,255,.22)";
      for (let i = -6; i <= 6; i++) x.fillRect(i * R * 0.2, y0, R * 0.06, R * 0.24);
      x.restore();
      x.translate(rx * 0.38, y0 + R * 0.14);
      x.rotate(0.18 + Math.sin(t * 2.5) * 0.06);
      rr(x, -R * 0.11, 0, R * 0.22, R * 0.48, R * 0.07);
      x.fillStyle = "#d63f3f";
      x.fill();
      x.strokeStyle = "#ff8a80";
      x.lineWidth = R * 0.025;
      for (let i = 0; i < 4; i++) {
        x.beginPath();
        x.moveTo(-R * 0.08 + i * R * 0.055, R * 0.48);
        x.lineTo(-R * 0.08 + i * R * 0.055, R * 0.58);
        x.stroke();
      }
      break;
    }
    case "bowtie": {
      x.translate(0, ry * 0.66);
      x.rotate(Math.sin(t * 2) * 0.05);
      x.fillStyle = "#d93d5c";
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.moveTo(0, 0);
        x.lineTo(sd * R * 0.28, -R * 0.14);
        x.quadraticCurveTo(sd * R * 0.33, 0, sd * R * 0.28, R * 0.14);
        x.closePath();
        x.fill();
      }
      x.fillStyle = "rgba(255,255,255,.55)";
      for (const [px, py] of [[-R * 0.18, -R * 0.03], [R * 0.2, R * 0.04], [-R * 0.12, R * 0.07], [R * 0.13, -R * 0.06]] as const) {
        x.beginPath();
        x.arc(px, py, R * 0.025, 0, Math.PI * 2);
        x.fill();
      }
      x.fillStyle = "#a82a45";
      rr(x, -R * 0.06, -R * 0.07, R * 0.12, R * 0.14, R * 0.04);
      x.fill();
      break;
    }
    case "bandana": {
      x.beginPath();
      x.moveTo(-rx * 0.78, ry * 0.46);
      x.quadraticCurveTo(0, ry * 0.58, rx * 0.78, ry * 0.46);
      x.lineTo(0, ry * 1.08);
      x.closePath();
      x.fillStyle = "#e84a5f";
      x.fill();
      x.save();
      x.clip();
      x.fillStyle = "rgba(255,255,255,.7)";
      for (let i = 0; i < 14; i++) {
        const px = ((i * 37) % 100) / 100 * rx * 1.4 - rx * 0.7;
        const py = ry * 0.52 + ((i * 53) % 100) / 100 * ry * 0.5;
        x.beginPath();
        x.arc(px, py, R * 0.025, 0, Math.PI * 2);
        x.fill();
      }
      x.restore();
      break;
    }
    case "pearls": {
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * (0.16 + i * 0.068);
        const px = Math.cos(a) * rx * 0.72;
        const py = ry * 0.28 + Math.sin(a) * ry * 0.58;
        const pg = x.createRadialGradient(px - R * 0.015, py - R * 0.015, 0, px, py, R * 0.055);
        pg.addColorStop(0, "#ffffff");
        pg.addColorStop(1, "#d7d2e6");
        x.fillStyle = pg;
        x.beginPath();
        x.arc(px, py, R * 0.05, 0, Math.PI * 2);
        x.fill();
      }
      break;
    }
  }
  x.restore();
}
