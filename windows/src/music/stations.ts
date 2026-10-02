// Mochi's radio stations and the little composer that writes their tunes.
//
// Nothing is pre-recorded. Each station is a tempo, a key, a chord progression
// and an arrangement; the composer invents a melody motif from the station's
// scale, repeats it the way pop songs do (A A' B A), and writes a fresh one
// every sixteen bars — so the music never loops the same way twice.

import {
  bass, bell, chip, chipNoise, clap, crackle, drop, hat, keys, kick, pad, pluck,
  rainBed, shaker, snare, type Rig,
} from "./synth";

export type StationId = "bounce" | "lofi" | "chiptune" | "musicbox" | "rain";

export interface StepInfo {
  /** 16th note inside the bar, 0…15. */
  step: number;
  bar: number;
  /** Chord tones around middle C for this bar. */
  chord: number[];
  /** Bass root for this bar. */
  root: number;
  /** Melody note starting on this step, if any. */
  lead: { midi: number; steps: number } | null;
  stepDur: number;
  rand: () => number;
}

export interface Station {
  id: StationId;
  name: string;
  tagline: string;
  emoji: string;
  /** Two colours for the station art and Mochi's headphones. */
  colors: [string, string];
  bpm: number;
  /** 0 = straight 16ths; 0.2 ≈ lazy hip-hop swing. */
  swing: number;
  /** Optional lowpass on the station, for warmth. */
  filter?: number;
  /** Loudness trim so every station plays at about the same level. */
  gain?: number;
  key: number;
  scale: number[];
  progression: number[];
  sevenths: boolean;
  /** How busy the melody is, 0…1. */
  density: number;
  play(r: Rig, t: number, s: StepInfo): void;
  ambient?(r: Rig, t: number): (at: number) => void;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];

export const STATIONS: Station[] = [
  {
    id: "bounce",
    name: "Mochi Bounce",
    tagline: "Bouncy beats for busy agents",
    emoji: "🫧",
    colors: ["#ff8fab", "#ffd166"],
    bpm: 112, swing: 0.1, key: 55, scale: MAJOR, progression: [0, 5, 1, 4], sevenths: false, density: 0.55,
    play(r, t, s) {
      const d = s.stepDur;
      if ([0, 8].includes(s.step) || (s.step === 6 && s.bar % 2 === 1)) kick(r, t, s.step === 6 ? 0.6 : 0.95);
      if (s.step === 4 || s.step === 12) clap(r, t, 0.8);
      shaker(r, t, s.step % 2 ? 0.9 : 0.45);
      if (s.step === 14) hat(r, t, 0.5, true);
      const bassSteps: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 };
      if (s.step in bassSteps) bass(r, t, s.root + bassSteps[s.step], d * 1.6, 0.9, "sine");
      if (s.step === 2 || s.step === 10) for (const m of s.chord) pluck(r, t, m, d, 0.32);
      if (s.lead) pluck(r, t, s.lead.midi + 12, d * s.lead.steps, 0.95);
    },
  },
  {
    id: "lofi",
    name: "Lo-fi Mochi",
    tagline: "Warm keys, dusty drums, deep focus",
    emoji: "🌙",
    colors: ["#a78bfa", "#60a5fa"],
    bpm: 76, swing: 0.22, filter: 2600, key: 53, scale: MAJOR, progression: [1, 4, 0, 5], sevenths: true, density: 0.3,
    play(r, t, s) {
      const d = s.stepDur;
      if (s.step === 0 || s.step === 10 || (s.step === 7 && s.bar % 2 === 1)) kick(r, t, s.step === 0 ? 0.85 : 0.55);
      if (s.step === 4 || s.step === 12) snare(r, t, 0.55);
      if (s.step % 2 === 0) hat(r, t, 0.22 + s.rand() * 0.18);
      if (s.rand() < 0.22) crackle(r, t + s.rand() * d, 0.6 + s.rand());
      if (s.step === 0) for (const m of s.chord) keys(r, t + s.rand() * 0.02, m, d * 14, 0.7);
      if (s.step === 10 && s.rand() < 0.35) for (const m of s.chord) keys(r, t, m, d * 5, 0.4);
      if (s.step === 0) bass(r, t, s.root, d * 7, 0.85);
      if (s.step === 10) bass(r, t, s.root + 7, d * 5, 0.6);
      if (s.lead) keys(r, t, s.lead.midi + 12, d * s.lead.steps, 0.55);
    },
  },
  {
    id: "chiptune",
    name: "Pixel Picnic",
    tagline: "Happy 8-bit adventures",
    emoji: "🎮",
    colors: ["#34d399", "#22d3ee"],
    bpm: 132, swing: 0, key: 60, scale: MAJOR, progression: [0, 4, 5, 3], sevenths: false, density: 0.7,
    play(r, t, s) {
      const d = s.stepDur;
      if (s.step === 0 || s.step === 8) kick(r, t, 0.7);
      if (s.step === 4 || s.step === 12) chipNoise(r, t, 1, true);
      if (s.step % 4 === 2) chipNoise(r, t, 0.8);
      if (s.step % 2 === 0) bass(r, t, s.root + (s.step % 4 === 2 ? 12 : 0), d * 1.6, 0.7);
      if (!s.lead) chip(r, t, s.chord[s.step % s.chord.length], d * 0.8, 0.35, false);
      else chip(r, t, s.lead.midi + 12, d * s.lead.steps, 0.95);
    },
  },
  {
    id: "musicbox",
    name: "Music Box Dreams",
    tagline: "Gentle bells for calm work",
    emoji: "🎠",
    colors: ["#f9a8d4", "#c4b5fd"],
    bpm: 92, swing: 0.08, gain: 1.9, key: 57, scale: PENTA, progression: [0, 5, 3, 4], sevenths: false, density: 0.5,
    play(r, t, s) {
      const d = s.stepDur;
      if (s.step === 0) pad(r, t, s.chord, d * 16, 0.8);
      if (s.step % 4 === 0) bell(r, t, s.chord[(s.step / 4) % s.chord.length], d * 4, 0.42);
      if (s.lead) bell(r, t, s.lead.midi + 12, d * s.lead.steps, 0.85);
      if (s.rand() < 0.03) bell(r, t, (s.lead?.midi ?? s.chord[0]) + 24, d * 2, 0.35);
    },
  },
  {
    id: "rain",
    name: "Rainy Café",
    tagline: "Soft rain and slow piano",
    emoji: "🌧",
    colors: ["#38bdf8", "#94a3b8"],
    bpm: 64, swing: 0.15, filter: 3200, gain: 1.7, key: 50, scale: MAJOR, progression: [0, 3, 5, 4], sevenths: true, density: 0.22,
    ambient: (r, t) => rainBed(r, t),
    play(r, t, s) {
      const d = s.stepDur;
      if (s.rand() < 0.4) drop(r, t + s.rand() * d, 0.5 + s.rand() * 0.8);
      if (s.step === 0 && s.bar % 2 === 0) for (const m of s.chord) keys(r, t + s.rand() * 0.04, m, d * 28, 0.5);
      if (s.step === 0) bass(r, t, s.root, d * 14, 0.45, "sine");
      if (s.lead && s.rand() < 0.75) keys(r, t, s.lead.midi + 12, d * s.lead.steps, 0.45);
    },
  },
];

export const stationById = (id: string): Station => STATIONS.find((s) => s.id === id) ?? STATIONS[0];

/** The cheerful ones, for "surprise me" work music. */
export const WORK_PICKS: StationId[] = ["bounce", "bounce", "chiptune", "musicbox", "lofi"];

// ── Composer ──────────────────────────────────────────────────────────────────

/** Small seeded PRNG so a song can be replayed exactly (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RHYTHMS: Record<"low" | "mid" | "high", number[][]> = {
  low: [[0, 6, 8], [0, 8, 12], [0, 3, 8, 14], [0, 10]],
  mid: [[0, 2, 4, 7, 8, 12], [0, 3, 6, 8, 11, 14], [0, 4, 6, 8, 10, 12], [0, 2, 6, 8, 12, 14]],
  high: [[0, 2, 3, 4, 6, 8, 10, 11, 12, 14], [0, 1, 2, 4, 6, 8, 9, 10, 12, 14], [0, 2, 4, 5, 6, 8, 10, 12, 13, 14]],
};

interface Note { step: number; midi: number; steps: number }

export class Composer {
  private rand: () => number;
  private motifA: Note[][] = [];
  private motifB: Note[][] = [];
  private scaleNotes: number[];

  constructor(private station: Station, seed = Math.floor(Math.random() * 1e9)) {
    this.rand = seeded(seed);
    // Two octaves of the scale for the melody to wander in.
    const s = station.scale;
    this.scaleNotes = [];
    for (let o = 0; o < 2; o++) for (const i of s) this.scaleNotes.push(station.key + o * 12 + i);
    this.writeMotifs(0);
  }

  get stationInfo() { return this.station; }

  /** Chord tones for a bar, voiced around middle C. */
  chord(bar: number): number[] {
    const st = this.station;
    const deg = st.progression[bar % st.progression.length];
    const s = st.scale;
    const n = s.length;
    const tone = (k: number) => st.key + 12 + s[(deg + k) % n] + 12 * Math.floor((deg + k) / n);
    const tones = [tone(0), tone(2), tone(4)];
    if (st.sevenths) tones.push(tone(6));
    return tones;
  }

  root(bar: number): number {
    return this.chord(bar)[0] - 24;
  }

  /** The melody for a bar, following the A A' B A form. */
  melody(bar: number): Note[] {
    if (bar > 0 && bar % 16 === 0) this.writeMotifs(bar);
    const pos = bar % 8;
    const half = pos % 2;
    if (pos < 2) return this.motifA[half];
    if (pos < 4) return half === 0 ? this.motifA[0] : this.vary(this.motifA[1], bar);
    if (pos < 6) return this.motifB[half];
    return this.motifA[half];
  }

  private writeMotifs(bar: number) {
    this.motifA = [this.writeBar(bar), this.writeBar(bar + 1)];
    this.motifB = [this.writeBar(bar + 4), this.writeBar(bar + 5)];
  }

  private writeBar(bar: number): Note[] {
    const r = this.rand;
    const tier = this.station.density < 0.35 ? "low" : this.station.density < 0.65 ? "mid" : "high";
    const pattern = RHYTHMS[tier][Math.floor(r() * RHYTHMS[tier].length)];
    const chord = this.chord(bar).map((m) => m - 12);
    const notes: Note[] = [];
    let idx = this.nearestIndex(chord[Math.floor(r() * chord.length)]);
    pattern.forEach((step, i) => {
      if (step === 0 || step === 8) {
        // Strong beats land on a chord tone near where the tune already is.
        const target = chord.reduce((best, m) => Math.abs(m - this.scaleNotes[idx]) < Math.abs(best - this.scaleNotes[idx]) ? m : best, chord[0]);
        idx = this.nearestIndex(target + (r() < 0.3 ? 12 : 0));
      } else {
        const moves = [-2, -1, -1, 1, 1, 2, 0];
        idx += moves[Math.floor(r() * moves.length)];
      }
      idx = Math.max(2, Math.min(this.scaleNotes.length - 3, idx));
      const next = pattern[i + 1] ?? 16;
      notes.push({ step, midi: this.scaleNotes[idx], steps: Math.min(4, next - step) });
    });
    return notes;
  }

  /** Same rhythm, a different ending — keeps the repeat from feeling copy-pasted. */
  private vary(notes: Note[], bar: number): Note[] {
    const chord = this.chord(bar).map((m) => m - 12);
    return notes.map((n, i) => i < notes.length - 2 ? n : { ...n, midi: chord[(i + bar) % chord.length] + (n.midi > chord[0] + 7 ? 12 : 0) });
  }

  private nearestIndex(midi: number): number {
    let best = 0;
    for (let i = 0; i < this.scaleNotes.length; i++) {
      if (Math.abs(this.scaleNotes[i] - midi) < Math.abs(this.scaleNotes[best] - midi)) best = i;
    }
    return best;
  }
}
