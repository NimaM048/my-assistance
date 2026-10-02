// Break arcade — two tiny games with Mochi for pomodoro breaks.
//
// "Catch the stars": Mochi slides along the bottom catching falling stars and
// dodging grumpy storm clouds. "Mochi beat": tap on the beat of Mochi's own
// music (it reads the same beat clock Mochi dances to).
//
// Games only exist during a break: the arcade closes itself — kindly, with
// your score — the moment the break ends. Everything stays on this PC.

import { h, clear } from "../views/dom";
import { createPortrait, type Portrait } from "../mochi/portrait";
import { music } from "../music/remote";
import { stationById } from "../music/stations";
import { sharedStore } from "../core/shared";
import { XP, awardXp } from "../mochi/growth";
import { bugWhack, memoryPairs, mochiHop, mochiTrain, wordRain } from "./minigames";

export type GameId = "stars" | "beat" | "hop" | "whack" | "memory" | "train" | "words";

export interface ArcadeHost {
  /** When the current break ends (Date.now() ms), or null when you're not on a break. */
  breakEndsAt(): number | null;
  /** Something unique to this break, so its XP is only given once. */
  breakKey(): string;
  num(n: number): string;
  clock(seconds: number): string;
  /** Translates canvas text (the DOM is translated on its own). */
  t(text: string): string;
  confetti(from: HTMLElement): void;
  xpPop(from: HTMLElement, amount: number): void;
}

interface ArcadeStats {
  best: Record<GameId, number>;
  plays: number;
  /** Rounds played per game. */
  played?: Partial<Record<GameId, number>>;
}

export const GAME_IDS: GameId[] = ["stars", "hop", "whack", "memory", "train", "words", "beat"];

export const arcadeStore = sharedStore<ArcadeStats>("coucou.arcade.v1", () => ({ best: { stars: 0, beat: 0, hop: 0, whack: 0, memory: 0, train: 0, words: 0 }, plays: 0, played: {} }), (raw) => ({
  best: Object.fromEntries(GAME_IDS.map((id) => [id, Number(raw.best?.[id]) || 0])) as Record<GameId, number>,
  plays: Number(raw.plays) || 0,
  played: raw.played && typeof raw.played === "object" ? raw.played : {},
}));

export const GAMES: Record<GameId, { title: string; emoji: string; how: string; keys: string; color: string }> = {
  stars: { title: "Catch the stars", emoji: "⭐", how: "Move Mochi to catch falling stars. Golden stars are worth more — dodge the storm clouds!", keys: "Mouse or ← →", color: "#ffd36e" },
  hop: { title: "Mochi hop", emoji: "🎈", how: "Float Mochi through the gaps in the code walls. One button, endless fun.", keys: "Space, click or ↑", color: "#9fd3ff" },
  whack: { title: "Bug whack", emoji: "🐛", how: "Bonk the bugs before they hide — ladybugs are worth more. Don't touch the butterflies!", keys: "Click, or numpad 1–9", color: "#9be36b" },
  memory: { title: "Memory pairs", emoji: "🃏", how: "Flip the cards and find Mochi's wardrobe in pairs. Fewer moves, more points.", keys: "Click the cards", color: "#c9b8ff" },
  train: { title: "Mochi train", emoji: "🍓", how: "Lead a train of little Mochis to the strawberries. Don't bump the walls — or your own tail!", keys: "Arrows or WASD", color: "#ff8fb8" },
  words: { title: "Word rain", emoji: "⌨️", how: "Code words are raining down. Type them before they land — three misses and the round is over.", keys: "Type the words", color: "#a5b4fc" },
  beat: { title: "Mochi beat", emoji: "🥁", how: "Notes slide toward Mochi. Tap right on the beat for a Perfect.", keys: "Space, click or any key", color: "#ff8fb8" },
};

const ROUND = { stars: 60, beat: 64 } as const; // seconds, beats

function makeGame(id: GameId, env: GameEnv): Game {
  switch (id) {
    case "stars": return catchTheStars(env);
    case "beat": return mochiBeat(env);
    case "hop": return mochiHop(env);
    case "whack": return bugWhack(env);
    case "memory": return memoryPairs(env);
    case "train": return mochiTrain(env);
    case "words": return wordRain(env);
  }
}

export interface Game {
  start(): void;
  frame(dt: number, now: number): void;
  press?(): void;
  move?(x: number): void;
  /** A click or tap on the stage, in stage pixels. */
  tap?(x: number, y: number): void;
  key?(e: KeyboardEvent, down: boolean): void;
  /** Score so far. */
  score: number;
  /** True once the round is over. */
  over: boolean;
  /** Extra lines for the result card. */
  summary(): { label: string; value: string }[];
  dispose(): void;
}

// ── The arcade overlay ────────────────────────────────────────────────────────

export function openArcade(host: ArcadeHost, first: GameId = "stars") {
  if (document.querySelector(".arcade-overlay")) return;
  // Opened outside a break, the arcade is free play: no clock, no XP. A break
  // that ends mid-game still sends you back to work, kindly.
  const free = !host.breakEndsAt();

  let current: GameId = first;
  let game: Game | null = null;
  let raf = 0;
  let last = performance.now();
  let rewarded = false;
  let lastScore = 0;

  const canvas = h("canvas", { class: "arcade-canvas" }) as HTMLCanvasElement;
  const mochi = createPortrait({ size: 76, overhang: 30, padX: 34, dance: true, outfit: "worn", label: "Mochi" });
  const mochiBox = h("div", { class: "arcade-mochi" });
  mochi.mount(mochiBox);
  const screen = h("div", { class: "arcade-screen" });
  const stage = h("div", { class: "arcade-stage" }, canvas, mochiBox, screen);

  const timeLeft = h("span", { class: "arcade-time" });
  const scoreEl = h("strong", { class: "arcade-score" });
  const comboEl = h("span", { class: "arcade-combo" });
  const bestEl = h("span", { class: "arcade-best" });
  const tabs = h("div", { class: "arcade-tabs", role: "tablist" });
  const tabFor = new Map<GameId, HTMLButtonElement>();
  for (const id of GAME_IDS) {
    const b = h("button", { role: "tab", title: GAMES[id].title, "aria-label": GAMES[id].title, onclick: () => { if (id !== current) { current = id; intro(); } } },
      h("span", { "aria-hidden": "true", text: GAMES[id].emoji }), h("span", { class: "arcade-tab-name", text: GAMES[id].title })) as HTMLButtonElement;
    tabFor.set(id, b);
    tabs.append(b);
  }

  const close = () => {
    cancelAnimationFrame(raf);
    game?.dispose();
    game = null;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
    overlay.remove();
  };

  const card = h("section", { class: "arcade", role: "dialog", "aria-modal": "true", "aria-label": "Break arcade" },
    h("header", { class: "arcade-head" },
      h("div", { class: "arcade-title" }, h("div", { class: "eyebrow", text: free ? "FREE PLAY" : "WHILE YOU REST" }), h("h2", { text: "Break arcade" })),
      tabs,
      h("div", { class: "arcade-clock", title: free ? "Not on a break — XP comes with break games" : "Time left in your break" }, h("span", { "aria-hidden": "true", text: free ? "🎮" : "☕" }), timeLeft),
      h("button", { class: "arcade-close", title: "Close", "aria-label": "Close", text: "×", onclick: close }),
    ),
    stage,
    h("footer", { class: "arcade-foot" },
      h("div", { class: "arcade-hud" }, h("span", { class: "arcade-label", text: "Score" }), scoreEl, comboEl),
      h("div", { class: "arcade-hud" }, h("span", { class: "arcade-label", text: "Best" }), bestEl),
    ),
  );
  const overlay = h("div", { class: "arcade-overlay" }, card);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);

  // ── Sizing ──
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  const resize = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const env: GameEnv = {
    ctx, get W() { return W; }, get H() { return H; }, mochi, mochiBox, host,
    setCombo: (n) => {
      clear(comboEl);
      if (n >= 3) comboEl.append(h("b", { text: `×${host.num(n)}` }), " ", h("span", { text: "combo" }));
    },
  };

  /** True when a break that was running has ended (free play never "ends"). */
  const breakEnded = () => !free && !host.breakEndsAt();

  const paintHud = () => {
    const ends = host.breakEndsAt();
    timeLeft.textContent = ends ? host.clock(Math.max(0, Math.ceil((ends - Date.now()) / 1000))) : free ? host.t("Free play") : host.clock(0);
    scoreEl.textContent = host.num(game?.score ?? lastScore);
    bestEl.textContent = host.num(arcadeStore.read().best[current]);
  };

  // ── Screens ──
  function intro() {
    cancelAnimationFrame(raf);
    game?.dispose();
    game = null;
    for (const [id, b] of tabFor) {
      b.classList.toggle("active", id === current);
      b.setAttribute("aria-selected", String(id === current));
    }
    card.dataset.game = current;
    env.setCombo(0);
    lastScore = 0;
    ctx.clearRect(0, 0, W, H);
    drawBackdrop(env, current, performance.now() / 1000);
    mochiBox.style.transform = "";
    mochiBox.dataset.game = current;
    const g = GAMES[current];
    clear(screen);
    screen.hidden = false;
    screen.append(h("div", { class: "arcade-card" },
      h("div", { class: "arcade-card-emoji", "aria-hidden": "true", text: g.emoji }),
      h("h3", { text: g.title }),
      h("p", { text: g.how }),
      h("div", { class: "arcade-keys" }, h("span", { class: "arcade-kbd", text: g.keys })),
      h("button", { class: "arcade-play", onclick: play }, h("span", { text: "Play" }), h("span", { "aria-hidden": "true", text: " ▶" })),
    ));
    paintHud();
    (screen.querySelector(".arcade-play") as HTMLElement | null)?.focus();
    // Keep the clock honest on the intro screen too.
    const idle = () => {
      if (!overlay.isConnected || game) return;
      if (breakEnded()) { breakOver(); return; }
      paintHud();
      drawBackdrop(env, current, performance.now() / 1000);
      raf = requestAnimationFrame(idle);
    };
    raf = requestAnimationFrame(idle);
  }

  function play() {
    if (breakEnded()) { breakOver(); return; }
    cancelAnimationFrame(raf);
    screen.hidden = true;
    lastScore = 0;
    game = makeGame(current, env);
    game.start();
    last = performance.now();
    const loop = (t: number) => {
      if (!overlay.isConnected || !game) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (breakEnded()) { finish(true); return; }
      game.frame(dt, t / 1000);
      paintHud();
      if (game.over) { finish(false); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function finish(breakEnded: boolean) {
    cancelAnimationFrame(raf);
    const g = game;
    if (!g) return;
    const score = g.score;
    lastScore = score;
    const lines = g.summary();
    g.dispose();
    game = null;
    const stats = arcadeStore.read();
    const isBest = score > stats.best[current];
    arcadeStore.write({
      best: { ...stats.best, [current]: Math.max(score, stats.best[current]) },
      plays: stats.plays + 1,
      played: { ...stats.played, [current]: (stats.played?.[current] ?? 0) + 1 },
    });

    clear(screen);
    screen.hidden = false;
    const xpSlot = h("div", { class: "arcade-xp-slot" });
    const again = !breakEnded && (free || host.breakEndsAt());
    screen.append(h("div", { class: "arcade-card result" },
      h("div", { class: "eyebrow", text: breakEnded ? "BREAK'S OVER" : "ROUND OVER" }),
      h("div", { class: "arcade-final" }, h("strong", { text: host.num(score) }), h("span", { text: "points" })),
      isBest && score > 0 ? h("div", { class: "arcade-newbest", text: "New best! ✨" }) : null,
      h("div", { class: "arcade-lines" }, ...lines.map((l) => h("div", {}, h("span", { text: l.label }), h("b", { text: l.value })))),
      xpSlot,
      h("div", { class: "arcade-actions" },
        again ? h("button", { class: "arcade-play", onclick: play }, h("span", { text: "Play again" })) : null,
        h("button", { class: again ? "arcade-ghost" : "arcade-play", onclick: close }, h("span", { text: breakEnded ? "Back to work 💪" : "Finish" })),
      ),
    ));
    mochi.engine.triggerEmote(score > 0 ? (isBest ? "celebrate" : "happy") : "shy");
    if (isBest && score > 0) host.confetti(xpSlot);
    // A little XP for resting well — once per break, more for a good round.
    if (!rewarded && score > 0 && !free) {
      rewarded = true;
      const amount = XP.breakGame + Math.min(10, Math.floor(score / 15));
      const got = awardXp(amount, "game", { key: `game:${host.breakKey()}` });
      if (got?.amount) window.setTimeout(() => host.xpPop(xpSlot, got.amount), 250);
    }
    paintHud();
  }

  function breakOver() {
    if (game) { finish(true); return; }
    clear(screen);
    screen.hidden = false;
    screen.append(h("div", { class: "arcade-card result" },
      h("div", { class: "arcade-card-emoji", "aria-hidden": "true", text: "☕" }),
      h("h3", { text: "Break's over" }),
      h("p", { text: "Mochi had fun. Ready to focus again?" }),
      h("div", { class: "arcade-actions" }, h("button", { class: "arcade-play", onclick: close }, h("span", { text: "Back to work 💪" }))),
    ));
  }

  // ── Input ──
  const onKey = (e: KeyboardEvent) => {
    if (!overlay.isConnected) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (!game) {
      if (e.key === "Enter" || e.key === " ") {
        const btn = screen.querySelector<HTMLButtonElement>(".arcade-play");
        if (btn && document.activeElement !== btn) { e.preventDefault(); btn.click(); }
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    game.key?.(e, true);
    if (!e.repeat && game.press && !["ArrowLeft", "ArrowRight"].includes(e.key)) game.press();
  };
  const onKeyUp = (e: KeyboardEvent) => game?.key?.(e, false);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKeyUp, true);
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    game?.move?.(e.clientX - r.left);
  });
  stage.addEventListener("pointerdown", (e) => {
    if (!game || (e.target as HTMLElement).closest(".arcade-screen:not([hidden])")) return;
    const r = stage.getBoundingClientRect();
    game.move?.(e.clientX - r.left);
    if (game.tap) game.tap(e.clientX - r.left, e.clientY - r.top);
    else game.press?.();
  });

  intro();
}

// ── Shared drawing ────────────────────────────────────────────────────────────

export interface GameEnv {
  ctx: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  mochi: Portrait;
  mochiBox: HTMLElement;
  host: ArcadeHost;
  setCombo(n: number): void;
}

const SKY_STARS = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.8, r: 0.4 + Math.random() * 1.2, p: Math.random() * 6 }));

function drawBackdrop(env: GameEnv, game: GameId, t: number) {
  const { ctx, W, H } = env;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (game === "stars") {
    g.addColorStop(0, "#141433");
    g.addColorStop(0.65, "#2a2350");
    g.addColorStop(1, "#43305e");
  } else {
    g.addColorStop(0, "#1a1424");
    g.addColorStop(1, "#2a1730");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (const s of SKY_STARS) {
    ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.p));
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (game === "stars") {
    // A sleepy moon and soft hills.
    ctx.fillStyle = "rgba(255, 236, 190, .9)";
    ctx.beginPath();
    ctx.arc(W - 70, 56, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a2350";
    ctx.beginPath();
    ctx.arc(W - 60, 50, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(120, 220, 170, .14)";
    ctx.beginPath();
    ctx.ellipse(W * 0.25, H + 40, W * 0.45, 90, 0, 0, Math.PI * 2);
    ctx.ellipse(W * 0.8, H + 50, W * 0.4, 90, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface Spark { x: number; y: number; vx: number; vy: number; life: number; age: number; color: string }
export interface Popup { x: number; y: number; text: string; age: number; color: string; big?: boolean }

export function drawFx(ctx: CanvasRenderingContext2D, sparks: Spark[], popups: Popup[], dt: number) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    if (s.age > s.life) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 260 * dt;
    ctx.globalAlpha = 1 - s.age / s.life;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = "center";
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.age += dt;
    if (p.age > 0.9) { popups.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - p.age / 0.9;
    ctx.fillStyle = p.color;
    ctx.font = `800 ${p.big ? 22 : 16}px "Vazirmatn", system-ui, sans-serif`;
    ctx.fillText(p.text, p.x, p.y - p.age * 40);
  }
  ctx.globalAlpha = 1;
}

export function burst(sparks: Spark[], x: number, y: number, color: string, n = 12) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 60 + Math.random() * 140;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.5 + Math.random() * 0.4, age: 0, color });
  }
}

// ── Catch the stars ───────────────────────────────────────────────────────────

interface Faller { x: number; y: number; vy: number; sway: number; kind: "star" | "gold" | "heart" | "cloud"; rot: number }

const FALLERS = {
  star: { emoji: "⭐", points: 1, size: 26 },
  gold: { emoji: "🌟", points: 3, size: 30 },
  heart: { emoji: "💖", points: 2, size: 26 },
  cloud: { emoji: "⛈️", points: -2, size: 32 },
} as const;

function catchTheStars(env: GameEnv): Game {
  const { ctx, host } = env;
  const fallers: Faller[] = [];
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  let x = env.W / 2;
  let target = x;
  let left = false;
  let right = false;
  let elapsed = 0;
  let startedAt: number | null = null;
  let spawnIn = 0.6;
  let combo = 0;
  let bestCombo = 0;
  let caught = 0;
  let missed = 0;
  let zapped = 0;
  let shake = 0;

  const game: Game = {
    score: 0,
    over: false,
    start() {
      env.mochi.engine.triggerEmote("excited");
      env.mochiBox.style.transition = "none";
    },
    move(px) { target = Math.max(30, Math.min(env.W - 30, px)); },
    key(e, down) {
      if (e.key === "ArrowLeft") left = down;
      if (e.key === "ArrowRight") right = down;
    },
    frame(dt, now) {
      const { W, H } = env;
      // The round runs on the wall clock, even if frames are slow.
      startedAt ??= now;
      elapsed = now - startedAt;
      if (left || right) target = Math.max(30, Math.min(W - 30, target + (right ? 1 : -1) * 520 * dt));
      x += (target - x) * (1 - Math.pow(0.0005, dt));
      env.mochiBox.style.transform = `translateX(${x - W / 2}px)`;
      env.mochi.engine.lookX = Math.max(-1, Math.min(1, (target - x) / 60));

      // Faster and busier as the round goes on.
      const speed = 110 + Math.min(180, elapsed * 4);
      spawnIn -= dt;
      if (spawnIn <= 0) {
        const r = Math.random();
        const kind: Faller["kind"] = r < 0.62 ? "star" : r < 0.71 ? "gold" : r < 0.77 ? "heart" : "cloud";
        fallers.push({ x: 30 + Math.random() * (W - 60), y: -30, vy: speed * (kind === "cloud" ? 0.85 : kind === "gold" ? 1.15 : 1) * (0.85 + Math.random() * 0.3), sway: Math.random() * 6, kind, rot: (Math.random() - 0.5) * 0.6 });
        spawnIn = Math.max(0.28, 0.75 - elapsed * 0.008) * (0.7 + Math.random() * 0.6);
      }

      ctx.save();
      if (shake > 0) {
        shake -= dt;
        ctx.translate((Math.random() - 0.5) * 8 * shake * 4, 0);
      }
      drawBackdrop(env, "stars", now);
      const catchY = H - 62;
      for (let i = fallers.length - 1; i >= 0; i--) {
        const f = fallers[i];
        f.y += f.vy * dt;
        const fx = f.x + Math.sin(now * 2 + f.sway) * 10;
        const spec = FALLERS[f.kind];
        if (Math.abs(f.y - catchY) < 26 && Math.abs(fx - x) < 40) {
          fallers.splice(i, 1);
          if (f.kind === "cloud") {
            combo = 0;
            zapped++;
            shake = 0.25;
            game.score = Math.max(0, game.score + spec.points);
            popups.push({ x: fx, y: catchY - 30, text: String(spec.points), age: 0, color: "#9fb4ff" });
            burst(sparks, fx, catchY - 10, "#9fb4ff", 10);
            env.mochi.engine.triggerEmote(Math.random() < 0.5 ? "sneeze" : "pout");
          } else {
            combo++;
            caught++;
            bestCombo = Math.max(bestCombo, combo);
            const mult = combo >= 15 ? 3 : combo >= 6 ? 2 : 1;
            const pts = spec.points * mult;
            game.score += pts;
            popups.push({ x: fx, y: catchY - 30, text: `+${host.num(pts)}`, age: 0, color: f.kind === "gold" ? "#ffd36e" : f.kind === "heart" ? "#ff8fb8" : "#fff3b0", big: mult > 1 });
            burst(sparks, fx, catchY - 10, f.kind === "heart" ? "#ff8fb8" : "#ffd36e", f.kind === "gold" ? 18 : 10);
            env.mochi.engine.squash();
            if (f.kind === "heart") env.mochi.engine.triggerEmote("love");
            else if (combo === 6 || combo === 15) {
              env.mochi.engine.triggerEmote("excited");
              popups.push({ x: W / 2, y: H / 2 - 40, text: `${host.t("Combo")} ×${host.num(mult)}!`, age: 0, color: "#ffd36e", big: true });
            }
          }
          env.setCombo(combo);
          continue;
        }
        if (f.y > H + 30) {
          fallers.splice(i, 1);
          if (f.kind !== "cloud") {
            missed++;
            if (combo >= 3) env.mochi.engine.triggerEmote("shy");
            combo = 0;
            env.setCombo(0);
          }
          continue;
        }
        ctx.save();
        ctx.translate(fx, f.y);
        ctx.rotate(f.rot + Math.sin(now * 3 + f.sway) * 0.15);
        ctx.font = `${spec.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // Colour emoji still take the fill's alpha — keep it opaque.
        ctx.fillStyle = "#fff";
        if (f.kind === "gold") {
          ctx.shadowColor = "rgba(255, 211, 110, .9)";
          ctx.shadowBlur = 16;
        }
        ctx.fillText(spec.emoji, 0, 0);
        ctx.restore();
      }
      drawFx(ctx, sparks, popups, dt);
      // The round's time, as a thin bar along the top.
      const p = Math.min(1, elapsed / ROUND.stars);
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(0, 0, W, 3);
      ctx.fillStyle = "#ffd36e";
      ctx.fillRect(0, 0, W * (1 - p), 3);
      ctx.restore();
      if (elapsed >= ROUND.stars) game.over = true;
    },
    summary: () => [
      { label: host.t("Stars caught"), value: host.num(caught) },
      { label: host.t("Best combo"), value: host.num(bestCombo) },
      { label: host.t("Stars missed"), value: host.num(missed) },
      { label: host.t("Storms hit"), value: host.num(zapped) },
    ],
    dispose() {
      env.mochiBox.style.transform = "";
      env.mochiBox.style.transition = "";
    },
  };
  return game;
}

// ── Mochi beat ────────────────────────────────────────────────────────────────

interface BeatNote { beat: number; judged: boolean; result?: "perfect" | "good" | "miss"; at?: number }

function mochiBeat(env: GameEnv): Game {
  const { ctx, host } = env;
  const sparks: Spark[] = [];
  const popups: Popup[] = [];
  const notes: BeatNote[] = [];
  let startBeat: number | null = null;
  let startedMusic = false;
  let combo = 0;
  let bestCombo = 0;
  let perfect = 0;
  let good = 0;
  let miss = 0;
  let generatedTo = 0;
  let flash = 0;
  let lastCount = "";

  const PX_PER_BEAT = 190;
  const hitX = () => Math.min(170, env.W * 0.22);
  const laneY = () => env.H * 0.4;

  // Use whatever plays if it's in 4/4; otherwise put on something bouncy.
  const ensureMusic = () => {
    const s = music.state;
    if (s.playing && (stationById(s.station).stepsPerBar ?? 16) === 16) return;
    startedMusic = true;
    music.play(Math.random() < 0.5 ? "bounce" : "chiptune", "manual");
  };

  const generate = (upTo: number) => {
    if (startBeat == null) return;
    while (generatedTo < upTo) {
      const b = generatedTo;
      const rel = b - startBeat;
      if (rel >= 4 && rel < 4 + ROUND.beat) {
        const busy = Math.min(0.4, 0.08 + (rel / ROUND.beat) * 0.35);
        if (rel % 4 === 0 || Math.random() < 0.72) notes.push({ beat: b, judged: false });
        if (rel % 2 === 1 && Math.random() < busy) notes.push({ beat: b + 0.5, judged: false });
      }
      generatedTo++;
    }
  };

  const judge = (n: BeatNote, result: "perfect" | "good" | "miss", now: number) => {
    n.judged = true;
    n.result = result;
    n.at = now;
    const x = hitX();
    const y = laneY();
    if (result === "miss") {
      miss++;
      if (combo >= 6) env.mochi.engine.triggerEmote("pout");
      combo = 0;
      popups.push({ x, y: y - 48, text: host.t("Miss"), age: 0, color: "#8f95a3" });
    } else {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      const mult = combo >= 24 ? 3 : combo >= 10 ? 2 : 1;
      const pts = (result === "perfect" ? 3 : 1) * mult;
      game.score += pts;
      if (result === "perfect") perfect++;
      else good++;
      flash = 1;
      popups.push({ x, y: y - 48, text: host.t(result === "perfect" ? "Perfect!" : "Good"), age: 0, color: result === "perfect" ? "#ffd36e" : "#9be3c4", big: result === "perfect" });
      burst(sparks, x, y, result === "perfect" ? "#ffd36e" : "#9be3c4", result === "perfect" ? 14 : 8);
      env.mochi.engine.squash();
      if (combo === 10 || combo === 24) env.mochi.engine.triggerEmote(combo === 24 ? "celebrate" : "spin");
      else if (Math.random() < 0.25) env.mochi.engine.emit("note", 1);
    }
    env.setCombo(combo);
  };

  const game: Game = {
    score: 0,
    over: false,
    start() {
      ensureMusic();
      env.mochiBox.style.transform = `translateX(${hitX() - env.W / 2}px)`;
    },
    press() {
      const pos = music.beatPos();
      if (pos == null || startBeat == null) return;
      const bpm = music.state.bpm;
      // The closest note still waiting.
      let best: BeatNote | null = null;
      for (const n of notes) {
        if (n.judged) continue;
        if (!best || Math.abs(n.beat - pos) < Math.abs(best.beat - pos)) best = n;
      }
      if (!best) return;
      const ms = Math.abs(best.beat - pos) * (60000 / bpm);
      if (ms <= 75) judge(best, "perfect", pos);
      else if (ms <= 150) judge(best, "good", pos);
      else if (ms <= 260) judge(best, "miss", pos);
    },
    frame(dt, now) {
      const { W, H } = env;
      drawBackdrop(env, "beat", now);
      const pos = music.beatPos();
      const s = music.state;
      if (pos == null || !s.playing) {
        // Waiting for the music to start.
        ctx.fillStyle = "rgba(255,255,255,.6)";
        ctx.font = `700 15px "Vazirmatn", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(host.t("Warming up the music…"), W / 2, H / 2);
        return;
      }
      if (startBeat == null) {
        startBeat = Math.ceil(pos) + 1;
        generatedTo = startBeat;
      }
      generate(Math.ceil(pos) + 4);
      const bpm = s.bpm;
      const x0 = hitX();
      const y = laneY();
      const [c0, c1] = stationById(s.station).colors;

      // A spotlight from the hit ring down onto Mochi's little stage.
      const beam = ctx.createLinearGradient(0, y, 0, H);
      beam.addColorStop(0, `${c0}33`);
      beam.addColorStop(1, `${c0}08`);
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x0 - 22, y);
      ctx.lineTo(x0 + 22, y);
      ctx.lineTo(x0 + 90, H);
      ctx.lineTo(x0 - 90, H);
      ctx.closePath();
      ctx.fill();
      const floor = ctx.createRadialGradient(x0, H - 8, 4, x0, H - 8, 110);
      floor.addColorStop(0, `${c0}55`);
      floor.addColorStop(1, `${c0}00`);
      ctx.fillStyle = floor;
      ctx.beginPath();
      ctx.ellipse(x0, H - 8, 110, 22, 0, 0, Math.PI * 2);
      ctx.fill();

      // The lane.
      const lane = ctx.createLinearGradient(x0, 0, W, 0);
      lane.addColorStop(0, "rgba(255,255,255,.10)");
      lane.addColorStop(1, "rgba(255,255,255,.02)");
      ctx.fillStyle = lane;
      ctx.beginPath();
      ctx.roundRect(x0 - 30, y - 30, W - x0 + 10, 60, 30);
      ctx.fill();
      // Beat lines slide with the music.
      for (let b = Math.ceil(pos); b < pos + (W - x0) / PX_PER_BEAT; b++) {
        const bx = x0 + (b - pos) * PX_PER_BEAT;
        ctx.fillStyle = b % 4 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.06)";
        ctx.fillRect(bx - 1, y - 30, 2, 60);
      }
      // Hit ring, glowing on every beat.
      const beatPhase = pos - Math.floor(pos);
      flash = Math.max(0, flash - dt * 4);
      ctx.strokeStyle = c0;
      ctx.lineWidth = 3;
      ctx.shadowColor = c0;
      ctx.shadowBlur = 8 + 18 * Math.max(flash, 1 - beatPhase);
      ctx.beginPath();
      ctx.arc(x0, y, 26 + 3 * (1 - beatPhase), 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Count-in.
      if (startBeat != null && pos < startBeat + 4) {
        const left = Math.ceil(startBeat + 4 - pos);
        const label = left > 3 ? host.t("Ready…") : left > 0 ? host.num(left) : host.t("Go!");
        if (label !== lastCount) {
          lastCount = label;
          if (left <= 3) env.mochi.engine.squash();
        }
        ctx.fillStyle = "#fff";
        ctx.font = `800 ${left <= 3 ? 46 : 26}px "Vazirmatn", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.globalAlpha = 0.85;
        ctx.fillText(label, W / 2 + 40, H * 0.28);
        ctx.globalAlpha = 1;
      }

      // Notes.
      const missAfter = 150 / (60000 / bpm);
      for (const n of notes) {
        if (!n.judged && pos - n.beat > missAfter) judge(n, "miss", pos);
        if (n.judged && n.result !== "miss") continue;
        const nx = x0 + (n.beat - pos) * PX_PER_BEAT;
        if (nx > W + 30 || nx < -30) continue;
        const half = n.beat % 1 !== 0;
        ctx.globalAlpha = n.judged ? Math.max(0, 1 - (pos - (n.at ?? pos)) * 2) : 1;
        const grad = ctx.createLinearGradient(nx - 16, y - 16, nx + 16, y + 16);
        grad.addColorStop(0, half ? c1 : c0);
        grad.addColorStop(1, half ? c0 : c1);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(nx, y, half ? 12 : 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(20,14,30,.75)";
        ctx.font = `800 ${half ? 12 : 15}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("♪", nx, y + 1);
        ctx.textBaseline = "alphabetic";
      }
      ctx.globalAlpha = 1;
      drawFx(ctx, sparks, popups, dt);

      // Round progress along the top.
      if (startBeat != null) {
        const p = Math.max(0, Math.min(1, (pos - startBeat - 4) / ROUND.beat));
        ctx.fillStyle = "rgba(255,255,255,.08)";
        ctx.fillRect(0, 0, W, 3);
        ctx.fillStyle = c0;
        ctx.fillRect(0, 0, W * (1 - p), 3);
        if (pos > startBeat + 4 + ROUND.beat + 1 && notes.every((n) => n.judged)) game.over = true;
      }
    },
    summary: () => {
      const total = perfect + good + miss;
      return [
        { label: host.t("Perfect"), value: host.num(perfect) },
        { label: host.t("Good"), value: host.num(good) },
        { label: host.t("Best combo"), value: host.num(bestCombo) },
        { label: host.t("Accuracy"), value: `${host.num(total ? Math.round(((perfect + good * 0.6) / total) * 100) : 0)}%` },
      ];
    },
    dispose() {
      env.mochiBox.style.transform = "";
      if (startedMusic && music.state.reason === "manual") music.stop("manual");
    },
  };
  return game;
}
