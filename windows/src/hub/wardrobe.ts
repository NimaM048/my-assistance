// Mochi's wardrobe — the Hub page where Mochi's level, XP and outfits live —
// plus the "+10 XP" pops and the level-up party shown anywhere in the Hub.

import { h, svg, clear } from "../views/dom";
import { ICONS } from "../views/icons";
import { BotEngine } from "../mochi/engine";
import { createPortrait, type Portrait } from "../mochi/portrait";
import {
  ITEMS, XP, equip, growthStore, isUnlocked, levelInfo, randomOutfit, wornOutfit,
  type GrowthState, type Item, type Outfit, type Slot,
} from "../mochi/growth";

export interface WardrobeHost {
  num(n: number): string;
  toast(message: string): void;
  confetti(from: HTMLElement): void;
  ago(at: number): string;
}

type Tab = "all" | Slot;

const TABS: [Tab, string][] = [
  ["all", "Everything"], ["hat", "Hats"], ["face", "Glasses"], ["neck", "Scarves & ties"], ["phones", "Headphones"],
];

const REASONS: Record<string, string> = {
  task: "Task finished",
  focus: "Focus session",
  "all-done": "Cleared today's list",
  streak: "Streak milestone",
  agent: "Agent session done",
  game: "Break game",
  care: "Took a care break",
};

let host: WardrobeHost;
let tab: Tab = "all";
let preview: Portrait | null = null;
let root: HTMLElement | null = null;
let wired = false;

/** The outfit the big Mochi shows: what's worn, or an item being hovered. */
function showOutfit(o: Outfit) {
  if (!preview) return;
  preview.engine.outfit = o;
  preview.engine.wearPhones(Boolean(o.phones));
}

/** A tiny static Mochi wearing just one item — the closet's thumbnails. */
function thumbnail(item: Item, locked: boolean): HTMLCanvasElement {
  const size = 74;
  const canvas = h("canvas", { class: "wd-thumb", "aria-hidden": "true" }) as HTMLCanvasElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const engine = new BotEngine();
  engine.particleOverhang = 10;
  engine.outfit = { [item.slot]: item.id };
  if (item.slot === "phones") engine.phones = 1;
  if (locked) engine.eyeOverride = "closed";
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engine.draw(ctx, size, size);
  }
  return canvas;
}

export function renderWardrobePage(container: HTMLElement, h0: WardrobeHost) {
  host = h0;
  preview ??= createPortrait({
    size: 150, overhang: 46, padX: 60, outfit: "manual", dance: true, follow: true, greet: true,
    idleMoods: ["wink", "lookAround", "hop", "spin", "giggle"],
    clickMoods: ["love", "giggle", "excited", "shy", "dance"],
    label: "Mochi",
  });
  showOutfit(wornOutfit());

  const stage = h("div", { class: "wd-stage" }, h("div", { class: "wd-spot", "aria-hidden": "true" }));
  preview.mount(stage);
  const levelBadge = h("span", { class: "wd-level" });
  const xpFill = h("i", { class: "wd-xp-fill" });
  const xpText = h("div", { class: "wd-xp-text" });
  const nextUnlock = h("div", { class: "wd-next" });

  const left = h("section", { class: "wd-card wd-profile" },
    stage,
    h("div", { class: "wd-name-row" }, h("h2", { text: "Mochi" }), levelBadge),
    h("div", { class: "wd-xp" }, xpFill),
    xpText,
    h("div", { class: "wd-actions" },
      h("button", { class: "wd-btn primary", onclick: () => {
        const o = randomOutfit();
        growthStore.write({ equipped: o });
        preview?.engine.triggerEmote("excited");
      } }, svg(ICONS.shuffle, 13), h("span", { text: "Surprise outfit" })),
      h("button", { class: "wd-btn", onclick: () => {
        growthStore.write({ equipped: {} });
        preview?.engine.triggerEmote("shy");
      } }, h("span", { text: "Take it all off" })),
    ),
    nextUnlock,
  );

  const tabs = h("div", { class: "wd-tabs", role: "tablist" });
  const grid = h("div", { class: "wd-grid" });
  const earn = h("section", { class: "wd-card wd-earn" });
  const log = h("div", { class: "wd-log" });

  const right = h("div", { class: "wd-right" },
    h("section", { class: "wd-card wd-closet" },
      h("header", { class: "wd-head" }, h("div", {}, h("div", { class: "eyebrow", text: "WARDROBE" }), h("h3", { text: "Dress Mochi up" })), tabs),
      grid,
    ),
    h("div", { class: "wd-bottom" }, earn, h("section", { class: "wd-card wd-history" },
      h("div", { class: "eyebrow", text: "RECENT XP" }), log)),
  );

  root = h("div", { class: "wd-page" }, left, right);
  container.append(root);

  const draw = (s: GrowthState) => {
    if (!root?.isConnected) return;
    const info = levelInfo(s.xp);
    const worn = wornOutfit(s);
    showOutfit(worn);

    clear(levelBadge);
    levelBadge.append(h("span", { text: "Level" }), " ", h("strong", { text: host.num(info.level) }));
    xpFill.style.width = `${Math.round(info.progress * 100)}%`;
    clear(xpText);
    xpText.append(h("strong", { text: host.num(info.into) }), " / ", h("span", { text: host.num(info.need) }), " ", h("span", { text: "XP" }),
      h("small", {}, " · ", h("span", { text: "total" }), " ", h("span", { text: host.num(s.xp) })));

    const upcoming = ITEMS.filter((i) => i.level > info.level).sort((a, b) => a.level - b.level)[0];
    clear(nextUnlock);
    if (upcoming) nextUnlock.append(h("span", { text: "Next unlock" }), h("b", {}, h("span", { text: upcoming.emoji }), " ", h("span", { text: upcoming.name })), h("small", {}, h("span", { text: "level" }), " ", h("span", { text: host.num(upcoming.level) })));
    else nextUnlock.append(h("b", { text: "Everything unlocked — Mochi is a legend ✨" }));

    clear(tabs);
    for (const [key, label] of TABS) {
      const items = ITEMS.filter((i) => key === "all" || i.slot === key);
      const open = items.filter((i) => isUnlocked(i, info.level)).length;
      tabs.append(h("button", { class: `wd-tab ${tab === key ? "active" : ""}`, role: "tab", "aria-selected": String(tab === key), onclick: () => { tab = key; draw(growthStore.read()); } },
        h("span", { text: label }), h("small", {}, h("span", { text: host.num(open) }), "/", h("span", { text: host.num(items.length) }))));
    }

    clear(grid);
    ITEMS.filter((i) => tab === "all" || i.slot === tab).forEach((item, idx) => {
      const unlocked = isUnlocked(item, info.level);
      const wearing = worn[item.slot] === item.id;
      const card = h("button", {
        class: `wd-item ${unlocked ? "" : "locked"} ${wearing ? "wearing" : ""}`,
        style: `animation-delay:${idx * 25}ms`,
        title: unlocked ? (wearing ? "Take it off" : "Wear it") : "Unlocks at a higher level",
        "aria-pressed": String(wearing),
        onclick: () => {
          if (!unlocked) {
            card.classList.remove("nope");
            void card.offsetWidth;
            card.classList.add("nope");
            preview?.engine.triggerEmote("pout", 0.8);
            return;
          }
          equip(wearing ? null : item, item.slot);
          preview?.engine.triggerEmote(wearing ? "shy" : "excited");
        },
      },
        thumbnail(item, !unlocked),
        h("span", { class: "wd-item-name", text: item.name }),
        unlocked
          ? h("span", { class: "wd-item-state", text: wearing ? "Wearing" : "Wear" })
          : h("span", { class: "wd-item-state lock" }, svg(ICONS.lock, 10), h("span", { text: "Level" }), " ", h("span", { text: host.num(item.level) })),
      );
      // Hovering an unlocked item tries it on the big Mochi.
      card.addEventListener("mouseenter", () => { if (unlocked) showOutfit({ ...worn, [item.slot]: item.id }); });
      card.addEventListener("mouseleave", () => showOutfit(wornOutfit()));
      grid.append(card);
    });

    clear(earn);
    earn.append(h("div", { class: "eyebrow", text: "HOW MOCHI GROWS" }));
    const rows: [string, string, string][] = [
      [ICONS.check, "Finish a task", `+${XP.task}`],
      [ICONS.star, "High-priority task", `+${XP.taskHighPriority}`],
      [ICONS.timer, "Focus session (per minute)", `+${XP.focusPerMinute}`],
      [ICONS.stack, "Clear today's list", `+${XP.allDone}`],
      [ICONS.bell, "Streak of 3, 7, 14, 30 days", "+50"],
      [ICONS.code, "Agent session finished", `+${XP.agentSession}`],
      [ICONS.music, "Play a break game", `+${XP.breakGame}–${XP.breakGame + 10}`],
    ];
    for (const [icon, label, amount] of rows) {
      earn.append(h("div", { class: "wd-earn-row" }, h("span", { class: "wd-earn-icon" }, svg(icon, 12)), h("span", { text: label }), h("b", { text: amount })));
    }

    clear(log);
    if (!s.log.length) log.append(h("p", { class: "wd-empty", text: "Finish a task or a focus session and Mochi's first XP shows up here." }));
    for (const e of s.log.slice(0, 7)) {
      log.append(h("div", { class: "wd-log-row" },
        h("b", { text: `+${host.num(e.amount)}` }),
        h("span", { text: REASONS[e.reason] ?? e.reason }),
        h("time", { text: host.ago(e.at) })));
    }
  };

  drawCurrent = draw;
  if (!wired) {
    wired = true;
    growthStore.subscribe((s) => drawCurrent?.(s));
  }
  draw(growthStore.read());
}

let drawCurrent: ((s: GrowthState) => void) | null = null;

// ── XP pop & level-up party ──────────────────────────────────────────────────

/** "+10 XP" floats up from an element and fades. */
export function xpPop(from: HTMLElement, amount: number, num: (n: number) => string) {
  if (!from.isConnected) return;
  const r = from.getBoundingClientRect();
  const el = h("div", { class: "xp-pop", "aria-hidden": "true" }, h("span", { text: `+${num(amount)}` }), " ", h("span", { text: "XP" }));
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.top}px`;
  document.body.append(el);
  window.setTimeout(() => el.remove(), 1300);
}

/**
 * Shows the level-up card once per new level — right away when the Hub is on
 * screen, or the next time it is (XP can be earned in the island meanwhile).
 */
export function watchLevelUps(h0: WardrobeHost, openWardrobe: () => void) {
  host = h0;
  const check = () => {
    if (document.hidden || document.querySelector(".levelup-overlay")) return;
    const s = growthStore.read();
    const level = levelInfo(s.xp).level;
    if (level <= s.celebratedLevel) return;
    const from = s.celebratedLevel;
    growthStore.write({ celebratedLevel: level });
    showLevelUp(from, level, openWardrobe);
  };
  growthStore.subscribe(() => window.setTimeout(check, 400));
  document.addEventListener("visibilitychange", check);
  window.setTimeout(check, 1200);
}

function showLevelUp(from: number, level: number, openWardrobe: () => void) {
  const unlocked = ITEMS.filter((i) => i.level > from && i.level <= level);
  const p = createPortrait({ size: 120, overhang: 40, padX: 60, outfit: "manual", dance: true, label: "Mochi" });
  const firstNew = unlocked[0];
  p.engine.outfit = firstNew ? { ...wornOutfit(), [firstNew.slot]: firstNew.id } : wornOutfit();
  if (firstNew?.slot === "phones") p.engine.wearPhones(true);
  const close = () => overlay.remove();
  const list = h("div", { class: "lu-items" });
  for (const item of unlocked) {
    list.append(h("button", { class: "lu-item", onclick: () => {
      equip(item, item.slot);
      host.toast(item.name);
      close();
    } }, h("span", { class: "lu-emoji", text: item.emoji }), h("span", { text: item.name }), h("small", { text: "Wear it" })));
  }
  const card = h("section", { class: "levelup", role: "dialog", "aria-modal": "true", "aria-label": "Level up" },
    h("div", { class: "lu-stage" }, p.canvas),
    h("div", { class: "eyebrow", text: "LEVEL UP" }),
    h("h2", {}, h("span", { text: "Mochi reached level" }), " ", h("strong", { text: host.num(level) }), "!"),
    unlocked.length ? h("p", { text: "New things in the wardrobe:" }) : h("p", { text: "Keep going — new outfits are on the way." }),
    list,
    h("div", { class: "lu-actions" },
      h("button", { class: "wd-btn", text: "Later", onclick: close }),
      h("button", { class: "wd-btn primary", text: "Open the wardrobe", onclick: () => { close(); openWardrobe(); } }),
    ),
  );
  const overlay = h("div", { class: "levelup-overlay" }, card);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") close(); });
  document.body.append(overlay);
  window.setTimeout(() => {
    p.engine.triggerEmote("celebrate");
    host.confetti(card);
    window.setTimeout(() => host.confetti(card), 350);
  }, 300);
  (card.querySelector(".lu-actions .primary") as HTMLElement | null)?.focus();
}
