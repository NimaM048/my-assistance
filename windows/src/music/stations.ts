// Mochi's radio stations and the little composer that writes their tunes.
//
// Nothing is pre-recorded. Each station is a tempo, a key, a chord progression
// and an arrangement; the composer invents a melody motif from the station's
// scale, repeats it the way pop songs do (A A' B A), and writes a fresh one
// every sixteen bars — so the music never loops the same way twice.

import {
  bass, bell, chip, chipNoise, clap, crackle, daf, drone, drop, hat, keys, kick, pad, pluck,
  rainBed, santur, shaker, snare, tar, tombak, type Rig,
} from "./synth";

export type StationId = "bounce" | "lofi" | "chiptune" | "musicbox" | "rain" | "tehran";

export interface StepInfo {
  /** 16th note inside the bar, 0…stepsPerBar-1. */
  step: number;
  /** Steps in this station's bar (16 in 4/4, 12 in 6/8). */
  steps: number;
  bar: number;
  /** Chord tones around middle C for this bar. */
  chord: number[];
  /** Bass root for this bar. */
  root: number;
  /** Melody note starting on this step, if any. */
  lead: { midi: number; steps: number } | null;
  stepDur: number;
  rand: () => number;
  /**
   * How hard your agent is working, 0…1 (0.5 when nobody is). Stations add
   * layers above ~0.65 and thin out below ~0.3.
   */
  energy: number;
  /** Your agent is waiting for you: hold back, keep it suspended. */
  tension: boolean;
}

/** A Persian dastgah (or avaz): the scale the melody lives in for a while. */
export interface Mode {
  name: string;
  /** Semitones above the tonic; .5 is a quarter tone (koron / sori). */
  scale: number[];
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
  /** When set, the composer moves between these modes every sixteen bars. */
  modes?: Mode[];
  /** Tonic-and-fifth drones instead of triads (modal music). */
  drone?: boolean;
  /** 16 (4/4, default) or 12 (6/8). */
  stepsPerBar?: number;
  /** 4 (default), or 6 for the dotted-quarter beat of 6/8. */
  stepsPerBeat?: number;
  progression: number[];
  sevenths: boolean;
  /** How busy the melody is, 0…1. */
  density: number;
  play(r: Rig, t: number, s: StepInfo): void;
  ambient?(r: Rig, t: number): (at: number) => void;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];

/** The modes of Tehran Nights, with their quarter tones. */
const PERSIAN_MODES: Mode[] = [
  { name: "Shur", scale: [0, 1.5, 3, 5, 7, 8, 10] },
  { name: "Homayoun", scale: [0, 1.5, 4, 5, 7, 8, 10] },
  { name: "Bayat-e Esfahan", scale: [0, 2, 3, 5, 7, 8.5, 11] },
  { name: "Chahargah", scale: [0, 1.5, 4, 5, 7, 8.5, 11] },
];

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
      if ((s.step === 4 || s.step === 12) && !s.tension) clap(r, t, 0.8);
      shaker(r, t, (s.step % 2 ? 0.9 : 0.45) * (s.energy < 0.3 ? 0.6 : 1));
      if (s.step === 14) hat(r, t, 0.5, true);
      // Your agent is on a roll: the groove gets busier.
      if (s.energy > 0.65 && s.step % 2 === 1) hat(r, t, 0.3 + (s.energy - 0.65));
      if (s.energy > 0.82 && s.step === 15) clap(r, t, 0.45);
      const bassSteps: Record<number, number> = { 0: 0, 3: 0, 6: 12, 8: 0, 11: 7, 14: 12 };
      if (s.step in bassSteps) bass(r, t, s.root + bassSteps[s.step], d * 1.6, 0.9, "sine");
      if (s.step === 2 || s.step === 10) for (const m of s.chord) pluck(r, t, m, d, 0.32);
      if (s.lead) pluck(r, t, s.lead.midi + 12, d * s.lead.steps, 0.95);
      if (s.lead && s.energy > 0.8) pluck(r, t, s.lead.midi + 24, d * s.lead.steps, 0.3);
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
      else if (s.energy > 0.65) hat(r, t, 0.12 + s.rand() * 0.1);
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
      if (s.lead && s.energy > 0.7) chip(r, t, s.chord[s.step % s.chord.length] + 12, d * 0.5, 0.18, false);
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
  {
    id: "tehran",
    name: "Tehran Nights",
    tagline: "Santur, tar and daf under the stars",
    emoji: "🏮",
    colors: ["#f4b860", "#d9435b"],
    // 6/8: two dotted-quarter beats a bar, the lilt of a reng.
    bpm: 74, swing: 0, gain: 1.35, key: 50, scale: PERSIAN_MODES[0].scale, modes: PERSIAN_MODES,
    drone: true, stepsPerBar: 12, stepsPerBeat: 6, progression: [0, 0, 3, 0], sevenths: false, density: 0.5,
    play(r, t, s) {
      const d = s.stepDur;
      const st = s.step;
      // Daf: DUM . . tak . . | dum . . tak tak .
      if (st === 0) daf(r, t, "dum", 0.9);
      if (st === 6 && !s.tension) daf(r, t, "dum", 0.6);
      if ((st === 3 || st === 9) && !s.tension) daf(r, t, "tak", 0.55);
      if (st === 10 && s.bar % 2 === 1 && !s.tension) daf(r, t, "tak", 0.32);
      // Tombak fills, and a little riz when your agent is busy.
      if (st === 11 && s.bar % 2 === 1) {
        tombak(r, t, "bak", 0.5);
        tombak(r, t + d * 0.5, "bak", 0.32);
      }
      if (st === 7 && s.bar % 4 === 2) tombak(r, t, "tom", 0.5);
      if (s.energy > 0.62 && st % 2 === 1 && st !== 11) tombak(r, t, "bak", 0.18 + s.rand() * 0.14);
      // The drone holds the dastgah's tonic and fifth.
      if (st === 0 && s.bar % 2 === 0) drone(r, t, s.chord.map((m) => m - 12), d * 24, 0.9);
      // Tar: a rocking ostinato.
      const tarAt: Record<number, number> = { 0: 0, 3: 12, 6: 1, 9: 12 };
      if (st in tarAt && !(s.tension && st !== 0)) {
        const m = tarAt[st] === 1 ? s.chord[1] - 12 : s.chord[0] - 12 + tarAt[st];
        tar(r, t, m, d * 2.2, st === 0 ? 0.6 : 0.4);
      }
      // Santur: the melody, with riz (tremolo) on the long notes.
      if (s.lead) {
        const m = s.lead.midi + 12;
        if (s.lead.steps >= 3) {
          const strikes = s.lead.steps * 2;
          for (let k = 0; k < strikes; k++) santur(r, t + (k * d) / 2, m, d / 2, k === 0 ? 0.95 : 0.34 + 0.12 * Math.sin(k * 1.7));
        } else {
          santur(r, t, m, d * s.lead.steps, 0.9);
        }
      } else if (st % 3 === 0 && s.rand() < 0.3) {
        santur(r, t, s.chord[(st / 3) % s.chord.length], d * 2, 0.32);
      }
    },
  },
];

export const stationById = (id: string): Station => STATIONS.find((s) => s.id === id) ?? STATIONS[0];

/** The cheerful ones, for "surprise me" work music. */
export const WORK_PICKS: StationId[] = ["bounce", "bounce", "chiptune", "musicbox", "lofi", "tehran"];

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

/** Melody rhythms for 6/8 bars (twelve 16ths, strong beats on 0 and 6). */
const RHYTHMS_12: Record<"low" | "mid" | "high", number[][]> = {
  low: [[0, 6], [0, 3, 6], [0, 4, 6, 9], [0, 6, 9]],
  mid: [[0, 2, 3, 4, 6, 9], [0, 3, 4, 6, 8, 9, 10], [0, 2, 4, 6, 8, 10], [0, 1, 2, 3, 6, 9]],
  high: [[0, 1, 2, 3, 4, 6, 7, 8, 9, 10], [0, 2, 3, 4, 5, 6, 8, 9, 10, 11]],
};

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
  private scaleNotes: number[] = [];
  private scale: number[];
  /** The dastgah being played, for modal stations. */
  mode: Mode | null = null;
  readonly steps: number;

  constructor(private station: Station, seed = Math.floor(Math.random() * 1e9)) {
    this.rand = seeded(seed);
    this.steps = station.stepsPerBar ?? 16;
    this.scale = station.scale;
    this.writeMotifs(0);
  }

  get stationInfo() { return this.station; }

  /** Chord tones for a bar, voiced around middle C. */
  chord(bar: number): number[] {
    return this.chordOn(this.station.progression[bar % this.station.progression.length]);
  }

  /** The chord on a scale degree: a triad (or seventh), or tonic + fifth for drone stations. */
  chordOn(deg: number): number[] {
    const st = this.station;
    const s = this.scale;
    const n = s.length;
    const tone = (k: number) => st.key + 12 + s[(deg + k) % n] + 12 * Math.floor((deg + k) / n);
    if (st.drone) return [tone(0), tone(4)];
    const tones = [tone(0), tone(2), tone(4)];
    if (st.sevenths) tones.push(tone(6));
    return tones;
  }

  /** The same chord with its third lifted to a fourth: unresolved, waiting. */
  sus(bar: number): number[] {
    const deg = this.station.progression[bar % this.station.progression.length];
    const s = this.scale;
    const n = s.length;
    const tone = (k: number) => this.station.key + 12 + s[(deg + k) % n] + 12 * Math.floor((deg + k) / n);
    return [tone(0), tone(3), tone(4)];
  }

  root(bar: number): number {
    return this.chord(bar)[0] - 24;
  }

  /** The home note, low — a pedal under suspended chords. */
  get tonic(): number {
    return this.station.key - 12;
  }

  /** Scale notes for a run into the final chord: up a scale for pop, down to the tonic (forud) for modal music. */
  run(count: number): number[] {
    const home = this.station.key + 12;
    const notes = this.scaleNotes.filter((m) => m >= home - 12 && m <= home + 12);
    if (this.station.drone) {
      // Forud: settle down the scale onto the tonic.
      const from = notes.filter((m) => m > home).slice(0, count - 1).reverse();
      return [...from, home];
    }
    const below = notes.filter((m) => m < home + 12).slice(-count);
    return below;
  }

  /** The melody for a bar, following the A A' B A form. */
  melody(bar: number): Note[] {
    if (bar > 0 && bar % 16 === 0) this.writeMotifs(bar);
    const pos = bar % 8;
    const half = pos % 2;
    if (pos < 2) return this.motifA[half];
    if (pos < 4) return half === 0 ? this.motifA[0] : this.vary(this.motifA[1], bar);
    if (pos < 6) return this.motifB[half];
    if (pos === 7 && this.station.drone) return this.forud(this.motifA[1]);
    return this.motifA[half];
  }

  /** Modal phrases come home: the last note of the section lands on the tonic. */
  private forud(notes: Note[]): Note[] {
    if (!notes.length) return notes;
    const last = notes[notes.length - 1];
    const tonics = [this.station.key, this.station.key + 12];
    const home = tonics.reduce((a, b) => (Math.abs(b - last.midi) < Math.abs(a - last.midi) ? b : a));
    return [...notes.slice(0, -1), { ...last, midi: home, steps: Math.max(last.steps, 3) }];
  }

  private writeMotifs(bar: number) {
    const modes = this.station.modes;
    if (modes?.length) {
      // A new section, sometimes a new dastgah.
      const others = modes.filter((m) => m !== this.mode);
      this.mode = !this.mode || this.rand() < 0.6 ? others[Math.floor(this.rand() * others.length)] : this.mode;
      this.scale = this.mode.scale;
    }
    // Two octaves of the scale for the melody to wander in.
    this.scaleNotes = [];
    for (let o = 0; o < 2; o++) for (const i of this.scale) this.scaleNotes.push(this.station.key + o * 12 + i);
    this.motifA = [this.writeBar(bar), this.writeBar(bar + 1)];
    this.motifB = [this.writeBar(bar + 4), this.writeBar(bar + 5)];
  }

  private writeBar(bar: number): Note[] {
    const r = this.rand;
    const tier = this.station.density < 0.35 ? "low" : this.station.density < 0.65 ? "mid" : "high";
    const table = this.steps === 12 ? RHYTHMS_12 : RHYTHMS;
    const pattern = table[tier][Math.floor(r() * table[tier].length)];
    const chord = this.chord(bar).map((m) => m - 12);
    const notes: Note[] = [];
    let idx = this.nearestIndex(chord[Math.floor(r() * chord.length)]);
    pattern.forEach((step, i) => {
      if (step === 0 || step === this.steps / 2) {
        // Strong beats land on a chord tone near where the tune already is.
        const target = chord.reduce((best, m) => Math.abs(m - this.scaleNotes[idx]) < Math.abs(best - this.scaleNotes[idx]) ? m : best, chord[0]);
        idx = this.nearestIndex(target + (r() < 0.3 ? 12 : 0));
      } else {
        const moves = [-2, -1, -1, 1, 1, 2, 0];
        idx += moves[Math.floor(r() * moves.length)];
      }
      idx = Math.max(2, Math.min(this.scaleNotes.length - 3, idx));
      const next = pattern[i + 1] ?? this.steps;
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
