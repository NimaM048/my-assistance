// Music preferences, shared by every Coucou window.
//
// All windows load from the same origin, so they share localStorage — and the
// browser fires a `storage` event in the *other* windows when one of them
// writes. That keeps the island, the Hub and Settings in sync without any
// round trip through Rust, and nothing ever leaves this PC.

import type { StationId } from "./stations";

export interface MusicPrefs {
  /** Play music while Claude Code / Codex is working. */
  workMusic: boolean;
  /** Station for work music; "auto" picks a cheerful one per session. */
  workStation: StationId | "auto";
  /** Start music with a Hub focus session. */
  focusMusic: boolean;
  focusStation: StationId;
  /** Little win / fail tunes when a session ends. */
  jingles: boolean;
  /** 0…1 */
  volume: number;
}

export const DEFAULT_MUSIC_PREFS: MusicPrefs = {
  workMusic: true,
  workStation: "auto",
  focusMusic: true,
  focusStation: "lofi",
  jingles: true,
  volume: 0.55,
};

const KEY = "coucou.music.player.v1";
const listeners = new Set<(p: MusicPrefs) => void>();

export function readMusicPrefs(): MusicPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<MusicPrefs> | null;
    return { ...DEFAULT_MUSIC_PREFS, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULT_MUSIC_PREFS };
  }
}

export function writeMusicPrefs(patch: Partial<MusicPrefs>): MusicPrefs {
  const next = { ...readMusicPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage can be unavailable; the change still applies to this window */
  }
  for (const fn of listeners) fn(next);
  return next;
}

/** Called for changes made in this window and in any other Coucou window. */
export function onMusicPrefs(fn: (p: MusicPrefs) => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) fn(readMusicPrefs());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
