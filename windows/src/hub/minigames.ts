// More games for the break arcade (see games.ts for the arcade itself).
//
//   Mochi hop    — float Mochi between the code walls (one button).
//   Bug whack    — bonk the bugs, spare the butterflies.
//   Memory pairs — flip cards to find Mochi's wardrobe in pairs.
//   Mochi train  — a snake of little Mochis collecting strawberries.
//   Word rain    — type the falling code words before they land.
//
// Everything is drawn on the arcade canvas; the big Mochi portrait plays along
// where it fits. Nothing leaves this PC.

import { burst, drawFx, type Game, type GameEnv, type Popup, type Spark } from "./games";

const EMOJI_FONT = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
const UI_FONT = `"Vazirmatn", system-ui, sans-serif`;

/** Where the portrait's body centre sits above the stage floor (portrait size 76, overhang 30). */
const MOCHI_BODY_FROM_BOTTOM = 38;

function emoji(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, size: number) {
  ctx.font = `${size}px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(ch, x, y);
  ctx.textBaseline = "alphabetic";
}

function backdrop(ctx: CanvasRenderingContext2D, W: number, H: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function progressBar(ctx: CanvasRenderingContext2D, W: number, p: number, color: string) {
  ctx.fillStyle = "rgba(255,255,255,.08)";
  ctx.fillRect(0, 0, W, 3);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W * Math.max(0, 1 - p), 3);
}

/** A small Mochi face drawn straight on the canvas (snake head, cards). */
function miniMochi(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, look: [number, number] = [0, 0], blink = false) {
  ctx.save();
  ctx.translate(x, y);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, color);
  g.addColorStop(1, shade(color, -0.18));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.1, r * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.45)";
  ctx.beginPath();
  ctx.ellipse(r * 0.35, -r * 0.42, r * 0.32, r * 0.18, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a1412";
  for (const sd of [-1, 1]) {
    const ex = sd * r * 0.38 + look[0] * r * 0.18;
    const ey = -r * 0.04 + look[1] * r * 0.15;
    ctx.beginPath();
    if (blink) ctx.ellipse(ex, ey, r * 0.13, r * 0.03, 0, 0, Math.PI * 2);
    else ctx.ellipse(ex, ey, r * 0.12, r * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function shade(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x + amount * 255))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Puts the portrait's body centre at (x, y) on the stage, tilted by `rot`. */
function placeMochi(env: GameEnv, x: number, y: number, rot = 0, scale = 1) {
  env.mochiBox.style.transform = `translate(${x - env.W / 2}px, ${y - (env.H - MOCHI_BODY_FROM_BOTTOM)}px) rotate(${rot}rad) scale(${scale})`;
}

// ── Mochi hop ─────────────────────────────────────────────────────────────────

interface Wall { x: number; gapY: number; gap: number; passed: boolean; hue: number }

export function mochiHop(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const walls: Wall[] = [];
  let y = env.H * 0.45;
  let vy = 0;
  let started = false;
  let dead = false;
  let deadAt = 0;
  let t = 0;
  let flaps = 0;
  let best = 0;
  const R = 19;
  const x = () => env.W * 0.28;
  const speed = () => 165 + Math.min(110, game.score * 4);

  const flap = () => {
    if (dead) return;
    started = true;
    vy = -340;
    flaps++;
    env.mochi.engine.squash();
    if (Math.random() < 0.15) env.mochi.engine.emit("sparkle", 1);
  };

  const hit = () => {
    if (dead) return;
    dead = true;
    deadAt = t;
    env.mochi.engine.triggerEmote("faint");
    burst(sparks, x(), y, "#ff8fb8", 16);
  };

  const game: Game = {
    score: 0,
    over: false,
    start() {
      env.mochiBox.style.transition = "none";
      env.mochi.engine.triggerEmote("excited");
    },
    // Every key but ← → already arrives as a press (↑ and Space included).
    press: flap,
    tap: () => flap(),
    frame(dt, now) {
      const { W, H } = env;
      t += dt;
      backdrop(ctx, W, H, "#15233d", "#2b2a55");
      // Parallax clouds.
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 260 - now * (14 + i * 4)) % (W + 300) + W + 300) % (W + 300) - 150;
        ctx.fillStyle = "rgba(255,255,255,.05)";
        ctx.beginPath();
        ctx.ellipse(cx, 60 + (i % 3) * 70, 70, 22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (started && !dead) {
        vy += 1050 * dt;
        y += vy * dt;
        const sp = speed();
        for (const w of walls) w.x -= sp * dt;
        while (walls.length && walls[0].x < -80) walls.shift();
        const last = walls.at(-1);
        if (!last || last.x < W - 250) {
          const gap = Math.max(118, 168 - game.score * 2.2);
          walls.push({ x: W + 40, gapY: 70 + Math.random() * (H - 140 - gap) + gap / 2, gap, passed: false, hue: Math.random() * 360 });
        }
      } else if (!started) {
        y = H * 0.45 + Math.sin(t * 3) * 8;
      } else {
        // Falling out of the sky after a bump.
        vy += 1400 * dt;
        y = Math.min(H - R, y + vy * dt);
      }

      // Code walls: stacks of little code blocks.
      for (const w of walls) {
        const top = w.gapY - w.gap / 2;
        const bottom = w.gapY + w.gap / 2;
        for (const [y0, y1] of [[0, top], [bottom, H]] as const) {
          ctx.fillStyle = `hsl(${w.hue}, 45%, 28%)`;
          ctx.beginPath();
          ctx.roundRect(w.x, y0 - 8, 62, y1 - y0 + 16, 10);
          ctx.fill();
          for (let ly = y0 + 10; ly < y1 - 6; ly += 14) {
            const len = 14 + ((ly * 7.3 + w.x) % 30);
            ctx.fillStyle = `hsla(${(w.hue + 40) % 360}, 80%, 72%, .55)`;
            ctx.fillRect(w.x + 9, ly, len, 4);
          }
        }
        ctx.fillStyle = "rgba(255,255,255,.75)";
        ctx.font = `800 15px ui-monospace, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.fillText("{", w.x + 31, top - 10);
        ctx.fillText("}", w.x + 31, bottom + 22);
        if (!dead && !w.passed && w.x + 62 < x() - R) {
          w.passed = true;
          game.score++;
          best = Math.max(best, game.score);
          popups.push({ x: x(), y: y - 30, text: "+1", age: 0, color: "#ffd36e" });
          if (game.score % 10 === 0) env.mochi.engine.triggerEmote("celebrate");
        }
        if (!dead && x() + R > w.x + 4 && x() - R < w.x + 58 && (y - R * 0.85 < top || y + R * 0.85 > bottom)) hit();
      }
      // The sky is soft — only the ground ends the round.
      if (!dead && y < R) {
        y = R;
        vy = Math.max(0, vy);
      }
      if (!dead && y > H - R) hit();

      placeMochi(env, x(), y, Math.max(-0.5, Math.min(0.9, vy / 700)));
      env.mochi.engine.lookX = 0.6;

      if (!started) {
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.font = `700 15px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(host.t("Tap, click or press Space to float!"), W / 2, H * 0.22);
      }
      drawFx(ctx, sparks, popups, dt);
      if (dead && t - deadAt > 1.4) game.over = true;
    },
    summary: () => [
      { label: host.t("Walls passed"), value: host.num(game.score) },
      { label: host.t("Hops"), value: host.num(flaps) },
    ],
    dispose() {
      env.mochiBox.style.transform = "";
      env.mochiBox.style.transition = "";
    },
  };
  return game;
}

// ── Bug whack ─────────────────────────────────────────────────────────────────

interface Hole { x: number; y: number; who: "bug" | "lady" | "fly" | null; until: number; up: number; bonked: number }

const WHACK_SECONDS = 45;

export function bugWhack(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const holes: Hole[] = [];
  let elapsed = 0;
  let startedAt: number | null = null;
  let spawnIn = 0.5;
  let combo = 0;
  let bestCombo = 0;
  let bonks = 0;
  let oops = 0;
  let mallet: { x: number; y: number; at: number } | null = null;
  let now = 0;

  const layout = () => {
    const { W, H } = env;
    const cols = 3;
    const rows = 3;
    const gw = Math.min(W - 80, 520);
    const top = 50;
    const gh = H - 150;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const hx = W / 2 - gw / 2 + (c + 0.5) * (gw / cols);
        const hy = top + (r + 0.5) * (gh / rows);
        if (!holes[i]) holes[i] = { x: hx, y: hy, who: null, until: 0, up: 0, bonked: 0 };
        holes[i].x = hx;
        holes[i].y = hy;
      }
    }
  };

  const whack = (x: number, y: number) => {
    mallet = { x, y, at: now };
    let target: Hole | null = null;
    for (const h of holes) if (h.who && Math.hypot(x - h.x, y - (h.y - 18)) < 46) target = h;
    if (!target || !target.who) return;
    const who = target.who;
    target.who = null;
    target.bonked = now;
    if (who === "fly") {
      oops++;
      combo = 0;
      game.score = Math.max(0, game.score - 3);
      popups.push({ x: target.x, y: target.y - 50, text: "-3 🦋", age: 0, color: "#9fb4ff" });
      env.mochi.engine.triggerEmote("pout");
    } else {
      bonks++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      const pts = (who === "lady" ? 3 : 1) * (combo >= 12 ? 3 : combo >= 5 ? 2 : 1);
      game.score += pts;
      popups.push({ x: target.x, y: target.y - 50, text: `+${host.num(pts)}`, age: 0, color: who === "lady" ? "#ff8fb8" : "#ffd36e", big: pts > 2 });
      burst(sparks, target.x, target.y - 20, who === "lady" ? "#ff6b6b" : "#9be36b", 12);
      env.mochi.engine.squash();
      if (combo === 5 || combo === 12) env.mochi.engine.triggerEmote("excited");
    }
    env.setCombo(combo);
  };

  const game: Game = {
    score: 0,
    over: false,
    start() {
      layout();
      env.mochiBox.style.transform = `translateX(${env.W / 2 - 90}px)`;
      env.mochi.engine.triggerEmote("dance");
    },
    tap: whack,
    key(e, down) {
      if (!down || e.repeat) return;
      // Numpad layout: 7 8 9 on top.
      const map: Record<string, number> = { "7": 0, "8": 1, "9": 2, "4": 3, "5": 4, "6": 5, "1": 6, "2": 7, "3": 8 };
      const i = map[e.key];
      if (i != null && holes[i]) whack(holes[i].x, holes[i].y - 18);
    },
    frame(dt, t) {
      const { W, H } = env;
      now = t;
      startedAt ??= t;
      elapsed = t - startedAt;
      layout();
      backdrop(ctx, W, H, "#1d3324", "#14261b");
      // Grass tufts.
      ctx.fillStyle = "rgba(120, 220, 140, .08)";
      for (let i = 0; i < 18; i++) {
        ctx.beginPath();
        ctx.ellipse((i * 97) % W, (i * 53) % H, 30, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      // Spawns get quicker as the round goes on.
      spawnIn -= dt;
      if (spawnIn <= 0) {
        const free = holes.filter((h) => !h.who && t - h.bonked > 0.3);
        if (free.length) {
          const h = free[Math.floor(Math.random() * free.length)];
          const r = Math.random();
          h.who = r < 0.68 ? "bug" : r < 0.82 ? "lady" : "fly";
          h.up = t;
          const stay = Math.max(0.6, 1.35 - elapsed * 0.014) * (h.who === "lady" ? 0.7 : 1);
          h.until = t + stay;
        }
        spawnIn = Math.max(0.28, 0.7 - elapsed * 0.009) * (0.6 + Math.random() * 0.7);
      }
      for (const h of holes) {
        // The hole.
        ctx.fillStyle = "#0b140e";
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, 44, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(160, 120, 80, .5)";
        ctx.lineWidth = 3;
        ctx.stroke();
        if (h.who && t > h.until) {
          if (h.who !== "fly") combo = 0;
          h.who = null;
          env.setCombo(combo);
        }
        if (h.who) {
          const rise = Math.min(1, (t - h.up) / 0.12);
          const sink = Math.max(0, Math.min(1, (h.until - t) / 0.12));
          const k = Math.min(rise, sink);
          ctx.save();
          ctx.beginPath();
          ctx.rect(h.x - 50, h.y - 90, 100, 90);
          ctx.clip();
          emoji(ctx, h.who === "bug" ? "🐛" : h.who === "lady" ? "🐞" : "🦋", h.x, h.y - 6 - 30 * k + Math.sin(t * 12) * 2, 38);
          ctx.restore();
        } else if (t - h.bonked < 0.4) {
          emoji(ctx, "💫", h.x, h.y - 30 - (t - h.bonked) * 40, 24);
        }
      }
      // The mallet, for a moment after each whack.
      if (mallet && t - mallet.at < 0.22) {
        const a = (t - mallet.at) / 0.22;
        ctx.save();
        ctx.translate(mallet.x + 26, mallet.y - 10);
        ctx.rotate(-0.9 + Math.sin(a * Math.PI) * 0.9);
        ctx.fillStyle = "#8a5a32";
        ctx.fillRect(-4, -4, 8, 46);
        ctx.fillStyle = "#ff8fb8";
        ctx.beginPath();
        ctx.roundRect(-22, -22, 44, 24, 8);
        ctx.fill();
        ctx.restore();
      }
      drawFx(ctx, sparks, popups, dt);
      progressBar(ctx, W, elapsed / WHACK_SECONDS, "#9be36b");
      if (elapsed >= WHACK_SECONDS) game.over = true;
    },
    summary: () => [
      { label: host.t("Bugs squashed"), value: host.num(bonks) },
      { label: host.t("Best combo"), value: host.num(bestCombo) },
      { label: host.t("Butterflies bonked"), value: host.num(oops) },
    ],
    dispose() {
      env.mochiBox.style.transform = "";
    },
  };
  return game;
}

// ── Memory pairs ──────────────────────────────────────────────────────────────

interface Card { face: string; x: number; y: number; open: number; target: number; matched: boolean; wiggle: number }

const FACES = ["🌱", "🥳", "👓", "🧣", "🎀", "🌸", "😎", "👑", "🎧", "🍓", "⭐", "🧁"];

export function memoryPairs(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const pick = [...FACES].sort(() => Math.random() - 0.5).slice(0, 8);
  const deck = [...pick, ...pick].sort(() => Math.random() - 0.5);
  const cards: Card[] = deck.map((face) => ({ face, x: 0, y: 0, open: 0, target: 0, matched: false, wiggle: 0 }));
  let first: Card | null = null;
  let second: Card | null = null;
  let closeAt = 0;
  let moves = 0;
  let matches = 0;
  let combo = 0;
  let bestCombo = 0;
  let startedAt: number | null = null;
  let finishedAt: number | null = null;
  let t = 0;
  const CW = 64;
  const CH = 70;
  const GAP = 10;

  const layout = () => {
    const { W } = env;
    const gw = 4 * CW + 3 * GAP;
    const x0 = W / 2 - gw / 2;
    const y0 = 16;
    cards.forEach((c, i) => {
      c.x = x0 + (i % 4) * (CW + GAP);
      c.y = y0 + Math.floor(i / 4) * (CH + GAP);
    });
  };

  const flip = (c: Card) => {
    if (c.matched || c.target === 1 || second) return;
    c.target = 1;
    if (!first) {
      first = c;
      return;
    }
    second = c;
    moves++;
    if (first.face === c.face) {
      first.matched = true;
      c.matched = true;
      matches++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      const pts = 10 + (combo - 1) * 5;
      game.score += pts;
      popups.push({ x: c.x + CW / 2, y: c.y, text: `+${host.num(pts)}`, age: 0, color: "#ffd36e", big: combo > 1 });
      burst(sparks, c.x + CW / 2, c.y + CH / 2, "#ffd36e", 12);
      burst(sparks, first.x + CW / 2, first.y + CH / 2, "#ff8fb8", 8);
      env.mochi.engine.triggerEmote(combo >= 3 ? "excited" : "happy");
      first = null;
      second = null;
      if (matches === 8) {
        finishedAt = t;
        const elapsed = t - (startedAt ?? t);
        const bonus = Math.max(0, Math.round(90 - elapsed));
        game.score += bonus;
        if (bonus) popups.push({ x: env.W / 2, y: env.H / 2, text: `${host.t("Time bonus")} +${host.num(bonus)}`, age: 0, color: "#9be3c4", big: true });
        env.mochi.engine.triggerEmote("celebrate");
      }
    } else {
      combo = 0;
      closeAt = t + 0.75;
      first.wiggle = t;
      c.wiggle = t;
      env.mochi.engine.triggerEmote(Math.random() < 0.5 ? "curious" : "headShake");
    }
    env.setCombo(combo);
  };

  const game: Game = {
    score: 0,
    over: false,
    start() {
      layout();
      env.mochiBox.style.transform = `translateX(${env.W / 2 - 110}px)`;
    },
    tap(x, y) {
      for (const c of cards) if (x >= c.x && x <= c.x + CW && y >= c.y && y <= c.y + CH) flip(c);
    },
    frame(dt, now) {
      const { W, H } = env;
      t = now;
      startedAt ??= now;
      layout();
      if (second && !second.matched && now > closeAt && first) {
        first.target = 0;
        second.target = 0;
        first = null;
        second = null;
      }
      backdrop(ctx, W, H, "#241a33", "#1a1626");
      for (const c of cards) {
        c.open += (c.target - c.open) * (1 - Math.pow(0.0001, dt));
        const sx = Math.abs(Math.cos(c.open * Math.PI));
        const showFace = c.open > 0.5;
        const wig = now - c.wiggle < 0.4 ? Math.sin((now - c.wiggle) * 50) * 3 : 0;
        ctx.save();
        ctx.translate(c.x + CW / 2 + wig, c.y + CH / 2);
        ctx.scale(Math.max(0.04, sx), 1);
        ctx.fillStyle = showFace ? (c.matched ? "#2f4a3d" : "#2c2a3d") : "#7c5cff";
        ctx.beginPath();
        ctx.roundRect(-CW / 2, -CH / 2, CW, CH, 12);
        ctx.fill();
        if (showFace) {
          emoji(ctx, c.face, 0, 2, 32);
        } else {
          // Card back: a tiny Mochi.
          miniMochi(ctx, 0, 2, 13, "#efeff3", [0, 0], Math.sin(now * 0.7 + c.x) > 0.97);
        }
        if (c.matched) {
          ctx.strokeStyle = "rgba(155, 227, 196, .7)";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.fillStyle = "rgba(255,255,255,.55)";
      ctx.font = `600 12.5px ${UI_FONT}`;
      ctx.textAlign = "left";
      ctx.fillText(`${host.t("Moves")}: ${host.num(moves)}`, 16, H - 16);
      drawFx(ctx, sparks, popups, dt);
      if (finishedAt != null && now - finishedAt > 1.6) game.over = true;
    },
    summary: () => [
      { label: host.t("Pairs found"), value: host.num(matches) },
      { label: host.t("Moves"), value: host.num(moves) },
      { label: host.t("Best combo"), value: host.num(bestCombo) },
      { label: host.t("Time"), value: host.clock(Math.round((finishedAt ?? t) - (startedAt ?? t))) },
    ],
    dispose() {
      env.mochiBox.style.transform = "";
    },
  };
  return game;
}

// ── Mochi train (snake) ───────────────────────────────────────────────────────

type Dir = [number, number];
const TRAIN_COLORS = ["#ffb3c7", "#a8f7dc", "#c9b8ff", "#ffe29a", "#9fd3ff"];

export function mochiTrain(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const CELL = 26;
  let cols = 0;
  let rows = 0;
  let body: [number, number][] = [];
  let dir: Dir = [1, 0];
  const queue: Dir[] = [];
  let fruit: [number, number] = [0, 0];
  let cake: { at: [number, number]; until: number } | null = null;
  let acc = 0;
  let dead = false;
  let deadAt = 0;
  let t = 0;
  let eaten = 0;
  let startedAt: number | null = null;

  const free = (): [number, number] => {
    for (let i = 0; i < 200; i++) {
      const c: [number, number] = [Math.floor(Math.random() * cols), Math.floor(Math.random() * rows)];
      if (!body.some(([x, y]) => x === c[0] && y === c[1])) return c;
    }
    return [0, 0];
  };

  const turn = (d: Dir) => {
    const last = queue.at(-1) ?? dir;
    if (d[0] === -last[0] && d[1] === -last[1]) return;
    if (d[0] === last[0] && d[1] === last[1]) return;
    if (queue.length < 3) queue.push(d);
  };

  const game: Game = {
    score: 0,
    over: false,
    start() {
      cols = Math.floor(env.W / CELL);
      rows = Math.floor(env.H / CELL);
      const cy = Math.floor(rows / 2);
      body = [[5, cy], [4, cy], [3, cy]];
      fruit = free();
      env.mochiBox.style.display = "none";
    },
    key(e, down) {
      if (!down) return;
      const k = e.key.toLowerCase();
      if (k === "arrowup" || k === "w") turn([0, -1]);
      else if (k === "arrowdown" || k === "s") turn([0, 1]);
      else if (k === "arrowleft" || k === "a") turn([-1, 0]);
      else if (k === "arrowright" || k === "d") turn([1, 0]);
    },
    tap(x, y) {
      // Turn toward the tap, on the axis the train isn't already moving along.
      const [hx, hy] = body[0];
      const dx = x - (hx + 0.5) * CELL;
      const dy = y - (hy + 0.5) * CELL;
      if (dir[0] !== 0) turn([0, dy < 0 ? -1 : 1]);
      else turn([dx < 0 ? -1 : 1, 0]);
    },
    frame(dt, now) {
      const { W, H } = env;
      t = now;
      startedAt ??= now;
      const ox = (W - cols * CELL) / 2;
      const oy = (H - rows * CELL) / 2;
      const step = 1 / Math.min(14, 7 + eaten * 0.25);
      if (!dead) {
        acc += dt;
        while (acc >= step) {
          acc -= step;
          dir = queue.shift() ?? dir;
          const head: [number, number] = [body[0][0] + dir[0], body[0][1] + dir[1]];
          const hitWall = head[0] < 0 || head[1] < 0 || head[0] >= cols || head[1] >= rows;
          const hitSelf = body.slice(0, -1).some(([x, y]) => x === head[0] && y === head[1]);
          if (hitWall || hitSelf) {
            dead = true;
            deadAt = now;
            burst(sparks, ox + (body[0][0] + 0.5) * CELL, oy + (body[0][1] + 0.5) * CELL, "#ff8fb8", 18);
            break;
          }
          body.unshift(head);
          if (head[0] === fruit[0] && head[1] === fruit[1]) {
            eaten++;
            game.score += 1;
            popups.push({ x: ox + (head[0] + 0.5) * CELL, y: oy + head[1] * CELL, text: "+1", age: 0, color: "#ff8fb8" });
            burst(sparks, ox + (head[0] + 0.5) * CELL, oy + (head[1] + 0.5) * CELL, "#ff6b81", 8);
            fruit = free();
            if (!cake && eaten % 5 === 0) cake = { at: free(), until: now + 6 };
          } else if (cake && head[0] === cake.at[0] && head[1] === cake.at[1]) {
            game.score += 5;
            popups.push({ x: ox + (head[0] + 0.5) * CELL, y: oy + head[1] * CELL, text: "+5 🧁", age: 0, color: "#ffd36e", big: true });
            burst(sparks, ox + (head[0] + 0.5) * CELL, oy + (head[1] + 0.5) * CELL, "#ffd36e", 16);
            cake = null;
            body.push(body.at(-1)!);
          } else {
            body.pop();
          }
        }
      }
      if (cake && now > cake.until) cake = null;

      backdrop(ctx, W, H, "#16202b", "#121a24");
      ctx.fillStyle = "rgba(255,255,255,.025)";
      for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) if ((x + y) % 2 === 0) ctx.fillRect(ox + x * CELL, oy + y * CELL, CELL, CELL);
      emoji(ctx, "🍓", ox + (fruit[0] + 0.5) * CELL, oy + (fruit[1] + 0.5) * CELL + Math.sin(now * 5) * 1.5, 20);
      if (cake) {
        ctx.globalAlpha = cake.until - now < 1.5 ? 0.5 + 0.5 * Math.sin(now * 20) : 1;
        emoji(ctx, "🧁", ox + (cake.at[0] + 0.5) * CELL, oy + (cake.at[1] + 0.5) * CELL, 22);
        ctx.globalAlpha = 1;
      }
      // Tail first, so the head is on top.
      for (let i = body.length - 1; i >= 0; i--) {
        const [x, y] = body[i];
        const cx = ox + (x + 0.5) * CELL;
        const cyy = oy + (y + 0.5) * CELL + (i > 0 ? Math.sin(now * 8 - i * 0.7) * 1.5 : 0);
        if (i === 0) miniMochi(ctx, cx, cyy, CELL * 0.48, "#f2f2f5", [dir[0], dir[1]], dead);
        else miniMochi(ctx, cx, cyy, CELL * 0.36, TRAIN_COLORS[i % TRAIN_COLORS.length], [dir[0] * 0.5, dir[1] * 0.5], Math.sin(now * 1.3 + i) > 0.96);
      }
      if (!eaten && !dead) {
        ctx.fillStyle = "rgba(255,255,255,.7)";
        ctx.font = `700 14px ${UI_FONT}`;
        ctx.textAlign = "center";
        ctx.fillText(host.t("Arrow keys or WASD — collect the strawberries!"), W / 2, 34);
      }
      drawFx(ctx, sparks, popups, dt);
      if (dead && now - deadAt > 1.2) game.over = true;
    },
    summary: () => [
      { label: host.t("Strawberries"), value: host.num(eaten) },
      { label: host.t("Train length"), value: host.num(body.length) },
      { label: host.t("Time"), value: host.clock(Math.round((dead ? deadAt : t) - (startedAt ?? t))) },
    ],
    dispose() {
      env.mochiBox.style.display = "";
    },
  };
  return game;
}

// ── Word rain ─────────────────────────────────────────────────────────────────

const WORDS = [
  "const", "async", "await", "commit", "merge", "rebase", "lint", "build", "deploy", "fetch", "props", "state",
  "hook", "query", "cache", "token", "array", "string", "return", "import", "export", "class", "tuple", "lambda",
  "regex", "vector", "kernel", "socket", "thread", "mutex", "tauri", "rust", "mochi", "coucou", "pixel", "canvas",
  "shader", "branch", "patch", "review", "pull", "push", "stash", "diff", "null", "void", "enum", "trait", "crate",
  "cargo", "npm", "vite", "deno", "yield", "match", "panic", "borrow", "slice", "struct", "debug", "test", "ship",
  "claude", "codex", "prompt", "agent", "island", "notch", "tea", "nap", "focus", "break", "smile", "bug",
];

interface Drop { word: string; x: number; y: number; vy: number; color: string }

const WORDS_SECONDS = 60;

export function wordRain(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const drops: Drop[] = [];
  let typed = "";
  let lives = 3;
  let elapsed = 0;
  let startedAt: number | null = null;
  let spawnIn = 0.3;
  let words = 0;
  let letters = 0;
  let mistakes = 0;
  let streak = 0;
  let bestStreak = 0;
  let flashBad = 0;

  const target = () => (typed ? drops.filter((d) => d.word.startsWith(typed)).sort((a, b) => b.y - a.y)[0] ?? null : null);

  const game: Game = {
    score: 0,
    over: false,
    start() {
      env.mochiBox.style.transform = "";
    },
    key(e, down) {
      if (!down) return;
      if (e.key === "Backspace") {
        typed = typed.slice(0, -1);
        return;
      }
      if (e.key === "Escape") return;
      if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
      const next = typed + e.key.toLowerCase();
      if (!drops.some((d) => d.word.startsWith(next))) {
        mistakes++;
        streak = 0;
        flashBad = 1;
        env.setCombo(0);
        return;
      }
      typed = next;
      letters++;
      const done = drops.find((d) => d.word === typed);
      if (done) {
        drops.splice(drops.indexOf(done), 1);
        words++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        const pts = done.word.length * (streak >= 10 ? 3 : streak >= 4 ? 2 : 1);
        game.score += pts;
        popups.push({ x: done.x, y: done.y, text: `+${host.num(pts)}`, age: 0, color: done.color, big: pts > 8 });
        burst(sparks, done.x, done.y, done.color, 12);
        env.mochi.engine.squash();
        if (streak === 4 || streak === 10) env.mochi.engine.triggerEmote("excited");
        typed = "";
        env.setCombo(streak);
      }
    },
    frame(dt, now) {
      const { W, H } = env;
      startedAt ??= now;
      elapsed = now - startedAt;
      flashBad = Math.max(0, flashBad - dt * 3);
      backdrop(ctx, W, H, "#141a2e", "#202040");
      // Rain streaks in the background.
      ctx.strokeStyle = "rgba(150,180,255,.07)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 40; i++) {
        const x = (i * 71) % W;
        const y = ((i * 133 + now * 160) % (H + 40)) - 20;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 3, y + 14);
        ctx.stroke();
      }
      spawnIn -= dt;
      const busy = drops.length < 2 + Math.floor(elapsed / 12);
      if (spawnIn <= 0 && busy) {
        const pool = WORDS.filter((w) => w.length <= 4 + Math.floor(elapsed / 10) && !drops.some((d) => d.word === w || d.word[0] === w[0]));
        const word = pool[Math.floor(Math.random() * pool.length)] ?? "mochi";
        ctx.font = `700 17px ui-monospace, Consolas, monospace`;
        const wpx = ctx.measureText(word).width;
        drops.push({
          word, x: 30 + wpx / 2 + Math.random() * (W - 60 - wpx), y: -10,
          vy: 22 + Math.min(40, elapsed * 0.7) + Math.random() * 10,
          color: `hsl(${Math.random() * 360}, 85%, 75%)`,
        });
        spawnIn = Math.max(0.7, 2 - elapsed * 0.025);
      }
      const floor = H - 70;
      const tgt = target();
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.y += d.vy * dt;
        if (d.y > floor) {
          drops.splice(i, 1);
          lives--;
          streak = 0;
          env.setCombo(0);
          if (tgt === d) typed = "";
          burst(sparks, d.x, floor, "#9fb4ff", 10);
          env.mochi.engine.triggerEmote(lives > 0 ? "surprised" : "faint");
          continue;
        }
        ctx.font = `700 17px ui-monospace, Consolas, monospace`;
        ctx.textAlign = "center";
        const w = ctx.measureText(d.word).width;
        ctx.fillStyle = d === tgt ? "rgba(255,211,110,.16)" : "rgba(0,0,0,.28)";
        ctx.beginPath();
        ctx.roundRect(d.x - w / 2 - 8, d.y - 17, w + 16, 25, 9);
        ctx.fill();
        if (d === tgt) {
          const done = ctx.measureText(typed).width;
          ctx.textAlign = "left";
          ctx.fillStyle = "#ffd36e";
          ctx.fillText(typed, d.x - w / 2, d.y);
          ctx.fillStyle = d.color;
          ctx.fillText(d.word.slice(typed.length), d.x - w / 2 + done, d.y);
        } else {
          ctx.fillStyle = d.color;
          ctx.fillText(d.word, d.x, d.y);
        }
      }
      // The floor, the hearts and what you're typing.
      ctx.fillStyle = "rgba(255,255,255,.06)";
      ctx.fillRect(0, floor + 4, W, 2);
      for (let i = 0; i < 3; i++) emoji(ctx, i < lives ? "💖" : "🤍", 22 + i * 24, 26, 18);
      ctx.font = `800 18px ui-monospace, Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = flashBad > 0 ? `rgba(255,120,140,${0.5 + flashBad / 2})` : "#fff";
      ctx.fillText(typed ? `${typed}_` : "_", W / 2 + 130, H - 26);
      drawFx(ctx, sparks, popups, dt);
      progressBar(ctx, W, elapsed / WORDS_SECONDS, "#9fb4ff");
      if (lives <= 0 || elapsed >= WORDS_SECONDS) game.over = true;
    },
    summary: () => [
      { label: host.t("Words"), value: host.num(words) },
      { label: host.t("Best streak"), value: host.num(bestStreak) },
      { label: host.t("Letters"), value: host.num(letters) },
      { label: host.t("Typos"), value: host.num(mistakes) },
    ],
    dispose() {
      env.mochiBox.style.transform = "";
    },
  };
  return game;
}
