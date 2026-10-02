// Mochi grows with you: XP for focus and finished tasks, levels, and a wardrobe
// of accessories that unlock along the way.
//
// Everything is local (see core/shared.ts). Rewards are idempotent where it
// matters — a task pays out once even if you untick and tick it again — and
// small daily caps keep it from turning into a slot machine.

import { sharedStore } from "../core/shared";

export type Slot = "hat" | "face" | "neck" | "phones";

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  emoji: string;
  /** Level at which it unlocks. */
  level: number;
}

export const ITEMS: Item[] = [
  { id: "sprout", slot: "hat", name: "Little sprout", emoji: "🌱", level: 1 },
  { id: "party", slot: "hat", name: "Party hat", emoji: "🥳", level: 2 },
  { id: "round-glasses", slot: "face", name: "Round glasses", emoji: "👓", level: 2 },
  { id: "beanie", slot: "hat", name: "Cozy beanie", emoji: "🧢", level: 3 },
  { id: "scarf", slot: "neck", name: "Red scarf", emoji: "🧣", level: 3 },
  { id: "bow", slot: "hat", name: "Pink bow", emoji: "🎀", level: 4 },
  { id: "bowtie", slot: "neck", name: "Bow tie", emoji: "👔", level: 4 },
  { id: "flowers", slot: "hat", name: "Flower crown", emoji: "🌸", level: 5 },
  { id: "phones-midnight", slot: "phones", name: "Midnight headphones", emoji: "🌌", level: 5 },
  { id: "sunglasses", slot: "face", name: "Sunglasses", emoji: "😎", level: 6 },
  { id: "cat-ears", slot: "hat", name: "Cat ears", emoji: "🐱", level: 7 },
  { id: "phones-mint", slot: "phones", name: "Mint headphones", emoji: "🍃", level: 7 },
  { id: "hearts", slot: "face", name: "Heart cheeks", emoji: "💗", level: 8 },
  { id: "bandana", slot: "neck", name: "Bandana", emoji: "🤠", level: 9 },
  { id: "star-shades", slot: "face", name: "Star shades", emoji: "🌟", level: 10 },
  { id: "phones-gold", slot: "phones", name: "Gold headphones", emoji: "🏆", level: 11 },
  { id: "crown", slot: "hat", name: "Royal crown", emoji: "👑", level: 12 },
  { id: "pearls", slot: "neck", name: "Pearl necklace", emoji: "🦪", level: 13 },
  { id: "monocle", slot: "face", name: "Monocle", emoji: "🧐", level: 14 },
  { id: "wizard", slot: "hat", name: "Wizard hat", emoji: "🧙", level: 15 },
  { id: "phones-rainbow", slot: "phones", name: "Rainbow headphones", emoji: "🌈", level: 16 },
];

export const itemById = (id: string | undefined) => ITEMS.find((i) => i.id === id);

export type Outfit = Partial<Record<Slot, string>>;

export interface XpEntry {
  at: number;
  amount: number;
  reason: string;
}

export interface GrowthState {
  xp: number;
  equipped: Outfit;
  /** Ids already paid out (tasks, days…), so a reward can't be farmed. */
  rewarded: string[];
  log: XpEntry[];
  /** The level last celebrated — a higher one means "show the party". */
  celebratedLevel: number;
}

export const growthStore = sharedStore<GrowthState>(
  "coucou.mochi.growth.v1",
  () => ({ xp: 0, equipped: { hat: "sprout" }, rewarded: [], log: [], celebratedLevel: 1 }),
  (s) => ({
    ...s,
    xp: Math.max(0, Number(s.xp) || 0),
    equipped: s.equipped && typeof s.equipped === "object" ? s.equipped : {},
    rewarded: Array.isArray(s.rewarded) ? s.rewarded.slice(-800) : [],
    log: Array.isArray(s.log) ? s.log.slice(0, 60) : [],
    celebratedLevel: Math.max(1, Number(s.celebratedLevel) || 1),
  }),
);

/** Total XP needed to *reach* a level. Level 1 is free. */
export function xpForLevel(level: number): number {
  return level <= 1 ? 0 : Math.round(60 * Math.pow(level - 1, 1.5));
}

export function levelInfo(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, into: xp - floor, need: next - floor, progress: (xp - floor) / (next - floor), next };
}

export const isUnlocked = (item: Item, level: number) => level >= item.level;

/** XP rewards — kept in one place so the Wardrobe page can explain them. */
export const XP = {
  task: 10,
  taskHighPriority: 15,
  focusPerMinute: 1,
  focusBonus: 5,
  allDone: 30,
  agentSession: 3,
  agentDailyCap: 30,
  breakGame: 5,
  care: 5,
} as const;

export interface AwardResult {
  amount: number;
  level: number;
  levelUp: boolean;
  unlocked: Item[];
}

/**
 * Gives Mochi XP. With a `key`, the same reward is only ever paid once (a task
 * id, a day). With a `dailyCap`, all rewards sharing `capGroup` stop for the
 * day once the cap is reached.
 */
export function awardXp(amount: number, reason: string, opts: { key?: string; capGroup?: string; dailyCap?: number } = {}): AwardResult | null {
  const before = growthStore.read();
  if (opts.key && before.rewarded.includes(opts.key)) return null;
  let grant = amount;
  if (opts.capGroup && opts.dailyCap) {
    const day = new Date().toDateString();
    const today = before.log.filter((e) => e.reason.startsWith(opts.capGroup!) && new Date(e.at).toDateString() === day)
      .reduce((sum, e) => sum + e.amount, 0);
    grant = Math.max(0, Math.min(amount, opts.dailyCap - today));
  }
  if (grant <= 0) return null;
  const oldLevel = levelInfo(before.xp).level;
  const after = growthStore.write((s) => ({
    xp: s.xp + grant,
    rewarded: opts.key ? [...s.rewarded, opts.key].slice(-800) : s.rewarded,
    log: [{ at: Date.now(), amount: grant, reason }, ...s.log].slice(0, 60),
  }));
  const level = levelInfo(after.xp).level;
  return {
    amount: grant,
    level,
    levelUp: level > oldLevel,
    unlocked: ITEMS.filter((i) => i.level > oldLevel && i.level <= level),
  };
}

export function equip(item: Item | null, slot: Slot) {
  growthStore.write((s) => ({ equipped: { ...s.equipped, [slot]: item?.id } }));
}

/** Only what is unlocked can be worn — guards against a hand-edited store. */
export function wornOutfit(s: GrowthState = growthStore.read()): Outfit {
  const level = levelInfo(s.xp).level;
  const out: Outfit = {};
  for (const [slot, id] of Object.entries(s.equipped) as [Slot, string | undefined][]) {
    const item = itemById(id);
    if (item && item.slot === slot && isUnlocked(item, level)) out[slot] = id;
  }
  return out;
}

/** A random look from what's unlocked — every slot has a chance to stay empty. */
export function randomOutfit(): Outfit {
  const level = levelInfo(growthStore.read().xp).level;
  const out: Outfit = {};
  for (const slot of ["hat", "face", "neck", "phones"] as Slot[]) {
    const options = ITEMS.filter((i) => i.slot === slot && isUnlocked(i, level));
    if (options.length && Math.random() < 0.75) out[slot] = options[Math.floor(Math.random() * options.length)].id;
  }
  return out;
}
