// Occasion cards — Mochi celebrates Persian occasions with you in the Hub.
//
// Nowruz: a haft-sin spread you can explore. Sizdah Bedar: tie the sabzeh and
// make a wish. Chaharshanbe Suri: Mochi jumps over the fire. Yalda: a Hafez
// fortune. Birthday: blow out the candles. All local, no network.

import { h, clear } from "../views/dom";
import { createPortrait } from "../mochi/portrait";
import { HAFEZ, type Occasion } from "../mochi/occasions";
import { music } from "../music/remote";

export interface OccasionHost {
  confetti(from: HTMLElement): void;
  toast(message: string): void;
}

const HAFT_SIN: [string, string, string][] = [
  ["🌱", "Sabzeh", "Rebirth and growth"],
  ["🍎", "Sib", "Health and beauty"],
  ["🪙", "Sekkeh", "Prosperity"],
  ["🧄", "Sir", "Good health"],
  ["🪻", "Sonbol", "The arrival of spring"],
  ["🫙", "Serkeh", "Patience and age"],
  ["🌰", "Senjed", "Love"],
  ["🥄", "Somaq", "The colour of sunrise"],
  ["🍯", "Samanu", "Sweetness and plenty"],
  ["🐠", "Goldfish", "Life"],
  ["🪞", "Mirror", "Reflection on the year"],
  ["🥚", "Eggs", "Fertility"],
];

export function openOccasion(occ: Occasion, host: OccasionHost) {
  if (document.querySelector(".occ-overlay")) return;
  const mochi = createPortrait({ size: 120, overhang: 40, padX: 70, dance: true, follow: true, outfit: "worn", label: "Mochi" });
  const stage = h("div", { class: "occ-stage" });
  mochi.mount(stage);
  const body = h("div", { class: "occ-body" });
  const close = () => overlay.remove();
  const card = h("section", { class: `occ-card occ-${occ.id}`, role: "dialog", "aria-modal": "true", "aria-label": occ.title, style: `--o0:${occ.colors[0]};--o1:${occ.colors[1]}` },
    h("button", { class: "occ-close", title: "Close", "aria-label": "Close", text: "×", onclick: close }),
    h("div", { class: "occ-hero" }, stage,
      h("div", { class: "occ-titles" },
        h("div", { class: "eyebrow", text: "MOCHI CELEBRATES" }),
        h("h2", { text: occ.title }),
        h("p", { class: "occ-fa", dir: "rtl", text: occ.greeting }),
      )),
    body,
  );
  const overlay = h("div", { class: "occ-overlay" }, card);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });
  document.body.append(overlay);

  const shower = (n = 10) => mochi.engine.emit(occ.particle === "confetti" ? "sparkle" : occ.particle, n);
  window.setTimeout(() => {
    mochi.engine.triggerEmote("excited");
    shower(12);
  }, 300);

  switch (occ.id) {
    case "nowruz": {
      const note = h("p", { class: "occ-note", text: "Hover the spread — every item on the haft-sin wishes you something." });
      const spread = h("div", { class: "occ-sofreh" });
      HAFT_SIN.forEach(([emoji, name, meaning], i) => {
        const item = h("button", { class: "occ-sin", style: `animation-delay:${i * 50}ms` }, h("span", { class: "occ-sin-emoji", text: emoji }), h("b", { text: name }));
        item.addEventListener("mouseenter", () => { note.textContent = meaning; });
        item.addEventListener("focus", () => { note.textContent = meaning; });
        item.addEventListener("click", () => {
          note.textContent = meaning;
          mochi.engine.triggerEmote(i % 2 ? "love" : "giggle");
          mochi.engine.emit("petal", 6);
        });
        spread.append(item);
      });
      body.append(spread, note, h("button", { class: "occ-action", text: "Make a wish for the new year", onclick: (e: Event) => {
        mochi.engine.triggerEmote("celebrate");
        shower(18);
        host.confetti(e.currentTarget as HTMLElement);
        music.jingle("finish");
      } }));
      break;
    }
    case "sizdah": {
      let knots = 0;
      const count = h("span", { class: "occ-count" });
      const grass = h("button", { class: "occ-grass", "aria-label": "Tie a knot in the sabzeh" }, ...Array.from({ length: 14 }, () => h("i")));
      const paint = () => {
        clear(count);
        count.append(h("strong", { text: String(knots) }), " ", h("span", { text: knots === 1 ? "wish tied" : "wishes tied" }));
      };
      paint();
      grass.addEventListener("click", () => {
        knots++;
        grass.classList.remove("tie");
        void grass.offsetWidth;
        grass.classList.add("tie");
        mochi.engine.triggerEmote(knots % 3 ? "wink" : "dance");
        mochi.engine.emit("petal", 5);
        paint();
      });
      body.append(h("p", { class: "occ-note", text: "Tie a knot in the sabzeh and make a wish — then let it go with the river." }), grass, count);
      break;
    }
    case "chaharshanbe": {
      const fire = h("div", { class: "occ-fire", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i"), h("i"));
      body.append(
        h("p", { class: "occ-note", text: "Jump over the fire: give it your paleness, take its warmth." }),
        fire,
        h("button", { class: "occ-action", text: "Jump! 🔥", onclick: () => {
          stage.classList.remove("jump");
          void stage.offsetWidth;
          stage.classList.add("jump");
          mochi.engine.triggerEmote("excited");
          mochi.engine.emit("ember", 14);
          window.setTimeout(() => mochi.engine.triggerEmote("celebrate"), 700);
        } }),
      );
      break;
    }
    case "yalda": {
      const verse = h("div", { class: "occ-verse", dir: "rtl" });
      const ask = h("button", { class: "occ-action", text: "Make a wish, then open a Hafez fortune", onclick: () => {
        const [a, b] = HAFEZ[Math.floor(Math.random() * HAFEZ.length)];
        clear(verse);
        verse.classList.remove("show");
        void verse.offsetWidth;
        verse.append(h("p", { text: a }), h("p", { text: b }), h("small", { text: "— حافظ" }));
        verse.classList.add("show");
        mochi.engine.triggerEmote("curious");
        mochi.engine.emit("seed", 12);
      } });
      body.append(h("p", { class: "occ-note", text: "The longest night of the year — pomegranates, watermelon and a little Hafez." }), verse, ask);
      break;
    }
    case "birthday": {
      let lit = true;
      const candles = h("div", { class: "occ-candles" }, ...[0, 1, 2].map(() => h("span", { class: "occ-candle" }, h("i"))));
      const cake = h("button", { class: "occ-cake", "aria-label": "Blow out the candles" }, candles, h("div", { class: "occ-cake-body" }), h("div", { class: "occ-plate" }));
      cake.addEventListener("click", () => {
        if (!lit) return;
        lit = false;
        cake.classList.add("out");
        mochi.engine.triggerEmote("celebrate");
        host.confetti(cake);
        window.setTimeout(() => host.confetti(cake), 300);
        music.jingle("birthday");
      });
      body.append(h("p", { class: "occ-note", text: "Make a wish and blow out the candles 🕯️" }), cake);
      break;
    }
  }
  (card.querySelector(".occ-close") as HTMLElement | null)?.focus();
}
