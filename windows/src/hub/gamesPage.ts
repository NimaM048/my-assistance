// The Hub's Games page: every arcade game on one shelf, with your best scores.
// Games are best on a break — that's when they earn Mochi XP — but they're
// never locked: outside a break they run as free play.

import { h, clear } from "../views/dom";
import { createPortrait } from "../mochi/portrait";
import { GAME_IDS, GAMES, arcadeStore, openArcade, type ArcadeHost, type GameId } from "./games";

export interface GamesPageHost {
  arcade: ArcadeHost;
  /** Focus timer state, for the break banner. */
  focusRunning(): boolean;
  /** Starts a short break right away. */
  startBreak(): void;
  num(n: number): string;
  clock(seconds: number): string;
}

let root: HTMLElement | null = null;
let host: GamesPageHost | null = null;
let banner: HTMLElement | null = null;
let timer: number | null = null;

export function renderGamesPage(container: HTMLElement, h0: GamesPageHost) {
  host = h0;
  clear(container);
  const stats = arcadeStore.read();
  const mochi = createPortrait({ size: 84, overhang: 26, padX: 30, greet: true, dance: true, idleMoods: ["juggle", "bubbleGum", "hop", "flip", "wink"], clickMoods: ["juggle", "flip", "jelly", "kiss", "giggle"], label: "Mochi, ready to play" });
  banner = h("div", { class: "gm-banner" });
  const shelf = h("div", { class: "gm-shelf" });
  for (const id of GAME_IDS) shelf.append(gameCard(id, stats.best[id] ?? 0, stats.played?.[id] ?? 0));

  const favourite = GAME_IDS.reduce<GameId | null>((best, id) => ((stats.played?.[id] ?? 0) > (best ? stats.played?.[best] ?? 0 : 0) ? id : best), null);
  root = h("section", { class: "gm-page" },
    h("div", { class: "gm-hero" },
      h("div", { class: "gm-hero-mochi" }, mochi.canvas),
      h("div", { class: "gm-hero-copy" },
        h("div", { class: "eyebrow", text: "BREAK GAMES" }),
        h("h2", { text: "Play a little, rest a lot" }),
        h("p", { text: "Short games for your breaks — they earn Mochi XP while a break is running." }),
        h("div", { class: "gm-stats" },
          h("span", {}, h("b", { text: h0.num(stats.plays) }), " ", h("span", { text: "rounds played" })),
          favourite ? h("span", {}, h("span", { text: "Mochi's favourite:" }), " ", h("b", { text: `${GAMES[favourite].emoji} ${GAMES[favourite].title}` })) : null,
        ),
      ),
      banner,
    ),
    shelf,
  );
  container.append(root);
  paintBanner();
  if (timer != null) window.clearInterval(timer);
  // The banner's clock; stops by itself once the page is gone.
  timer = window.setInterval(() => {
    if (!root?.isConnected) {
      if (timer != null) window.clearInterval(timer);
      timer = null;
      return;
    }
    paintBanner();
  }, 1000);
}

function gameCard(id: GameId, best: number, played: number): HTMLElement {
  const g = GAMES[id];
  const card = h("article", { class: "gm-card", style: `--gm:${g.color}` },
    h("div", { class: "gm-emoji", "aria-hidden": "true", text: g.emoji }),
    h("h3", { text: g.title }),
    h("p", { text: g.how }),
    h("div", { class: "gm-meta" },
      h("span", { class: "gm-kbd", text: g.keys }),
      h("span", { class: "gm-best" }, h("span", { text: "Best" }), " ", h("b", { text: host!.num(best) })),
    ),
    h("button", { class: "gm-play", onclick: () => openArcade(host!.arcade, id) }, h("span", { text: played ? "Play again" : "Play game" }), h("span", { "aria-hidden": "true", text: " ▶" })),
  );
  return card;
}

function paintBanner() {
  if (!banner || !host) return;
  const ends = host.arcade.breakEndsAt();
  const key = ends ? "break" : host.focusRunning() ? "focus" : "free";
  if (banner.dataset.key !== key) {
    banner.dataset.key = key;
    clear(banner);
    if (key === "break") {
      banner.append(h("span", { class: "gm-dot on" }), h("span", { class: "gm-banner-text" }, h("b", { text: "On a break" }), " · ", h("span", { class: "gm-left" }), " ", h("span", { text: "left — XP is on!" })));
    } else if (key === "focus") {
      banner.append(h("span", { class: "gm-dot focus" }), h("span", { class: "gm-banner-text" }, h("b", { text: "Focus session running" }), " · ", h("span", { text: "games are free play until your break." })));
    } else {
      banner.append(
        h("span", { class: "gm-dot" }),
        h("span", { class: "gm-banner-text" }, h("b", { text: "Free play" }), " · ", h("span", { text: "XP comes with break games." })),
        h("button", { class: "gm-break", onclick: () => { host?.startBreak(); paintBanner(); } }, "☕ ", h("span", { text: "Take a 5-min break" })),
      );
    }
  }
  const left = banner.querySelector(".gm-left");
  if (left && ends) left.textContent = host.clock(Math.max(0, Math.ceil((ends - Date.now()) / 1000)));
}
