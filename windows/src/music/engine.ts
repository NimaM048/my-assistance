// The music player: schedules the stations' notes ahead of time on the audio
// clock (the standard Web Audio "lookahead" pattern), crossfades between
// stations, ducks under alerts, plays jingles, and tells listeners about every
// beat so Mochi can dance in time.
//
// It also follows your agent: `setEnergy` nudges the tempo and adds layers as
// tool calls pile up, `setTension` suspends the harmony while a question waits
// for you, and `finale` ends the song on a real cadence instead of a fade.
//
// When nothing plays, the scheduler timer is cleared and the AudioContext is
// suspended, so silence costs nothing.

import { Ambience, type AmbienceLevels } from "./ambience";
import { Composer, STATIONS, stationById, type Station, type StationId } from "./stations";
import { bell, chip, kick, makeNoise, pad, wah, type Rig } from "./synth";

export type MusicReason = "work" | "focus" | "manual";
export type JingleKind = "finish" | "error" | "birthday";

export interface MusicState {
  playing: boolean;
  station: StationId;
  reason: MusicReason | null;
  bpm: number;
  ducked: boolean;
  /**
   * Wall-clock time (Date.now()) when beat 0 would have fallen at the current
   * tempo, so other windows can follow the groove.
   */
  beatEpoch: number;
  /** The dastgah Tehran Nights is in, if that's what plays. */
  mode: string | null;
  /** The music is holding its breath for your answer. */
  tension: boolean;
}

export type MusicEvent =
  | { type: "beat"; beat: number; bar: number; downbeat: boolean }
  | { type: "state"; state: MusicState }
  | { type: "jingle"; kind: JingleKind }
  /** A melody note starting now — Mochi sings along to these. */
  | { type: "note"; midi: number; dur: number; low: number; high: number };

const LOOKAHEAD = 0.14; // seconds of notes scheduled ahead
const TICK_MS = 25;

interface Session {
  station: Station;
  composer: Composer;
  bus: GainNode;
  /** Brightness: opens up with energy. */
  tone: BiquadFilterNode;
  rig: Rig;
  /** Steps per bar and per beat (16/4 in 4/4, 12/6 in 6/8). */
  spBar: number;
  spBeat: number;
  /** Tempo is piecewise: from `anchorStep` (unswung at `anchorTime`) on, it's `bpm`. */
  bpm: number;
  anchorStep: number;
  anchorTime: number;
  step: number;
  nextTime: number;
  energy: number;
  tension: boolean;
  /** Bar the closing cadence starts on; the next bar's downbeat is the last chord. */
  finaleBar: number | null;
  /** Nothing more to schedule (the last chord rang). */
  ended: boolean;
  stopAmbient?: (at: number) => void;
}

const stepDur = (s: Session) => 60 / s.bpm / s.spBeat;

function stepTime(s: Session, step: number): number {
  const d = stepDur(s);
  return s.anchorTime + (step - s.anchorStep) * d + (step % 2 === 1 ? s.station.swing * d : 0);
}

function newSession(station: Station, composer: Composer, bus: GainNode, tone: BiquadFilterNode, rig: Rig, start: number): Session {
  return {
    station, composer, bus, tone, rig,
    spBar: station.stepsPerBar ?? 16, spBeat: station.stepsPerBeat ?? 4,
    bpm: station.bpm, anchorStep: 0, anchorTime: start, step: 0, nextTime: start,
    energy: 0.5, tension: false, finaleBar: null, ended: false,
  };
}

interface Played { lead: { midi: number; steps: number } | null; stepDur: number }

/** Schedules one step of a station. Shared by live play and offline renders. */
function scheduleStep(s: Session, t: number, rand: () => number): Played {
  const stepInBar = s.step % s.spBar;
  const bar = Math.floor(s.step / s.spBar);
  const d = stepDur(s);
  const base = {
    step: stepInBar, steps: s.spBar, bar, stepDur: d, rand,
    energy: s.energy, tension: s.tension,
  };

  // The ending: one bar on the dominant with a run into home, then the last chord.
  if (s.finaleBar != null && bar >= s.finaleBar) {
    if (bar === s.finaleBar) {
      const every = s.spBar === 12 ? 3 : 2;
      const run = s.composer.run(s.spBar / every);
      const lead = stepInBar % every === 0 ? { midi: run[stepInBar / every] - 12, steps: every } : null;
      const dominant = s.station.drone ? s.composer.chordOn(0) : s.composer.chordOn(4);
      s.station.play(s.rig, t, { ...base, chord: dominant, root: dominant[0] - 24, lead, energy: Math.max(0.5, s.energy), tension: false });
      return { lead, stepDur: d };
    }
    if (stepInBar === 0) {
      const home = s.composer.chordOn(0);
      const lead = { midi: s.station.key + 12, steps: s.spBar };
      s.station.play(s.rig, t, { ...base, step: 0, chord: home, root: home[0] - 24, lead, energy: 0.5, tension: false });
      kick(s.rig, t, 0.8);
      pad(s.rig, t, home, d * s.spBar * 1.5, 1);
      home.forEach((m, i) => bell(s.rig, t + 0.12 + i * 0.07, m + 24, 1.4, 0.45));
      bell(s.rig, t + 0.12 + home.length * 0.07, s.station.key + 48, 1.8, 0.4);
      s.ended = true;
      return { lead, stepDur: d };
    }
    return { lead: null, stepDur: d };
  }

  let lead = s.composer.melody(bar).find((n) => n.step === stepInBar) ?? null;
  let chord = s.composer.chord(bar);
  let root = s.composer.root(bar);
  if (s.tension) {
    // Waiting for you: suspended harmony over a tonic pedal, a sparse melody, a held pad.
    chord = s.station.drone ? chord : s.composer.sus(bar);
    root = s.composer.tonic;
    if (lead && lead.step !== 0 && lead.step !== s.spBar / 2) lead = null;
    if (stepInBar === 0) pad(s.rig, t, chord, d * s.spBar, 0.9);
  }
  s.station.play(s.rig, t, { ...base, chord, root, lead });
  return { lead, stepDur: d };
}

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private duckGain!: GainNode;
  private analyser!: AnalyserNode;
  private noise!: AudioBuffer;
  private session: Session | null = null;
  private timer: number | null = null;
  private suspendTimer: number | null = null;
  private beatTimers = new Set<number>();
  private listeners = new Set<(e: MusicEvent) => void>();
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;
  private ambience: Ambience | null = null;
  private ambienceLevels: Partial<AmbienceLevels> = {};
  private energy = 0.5;
  private tension = false;
  private finaleTimer: number | null = null;
  /** Ask for melody notes (Mochi sings); off costs nothing. */
  wantNotes = false;

  station: StationId = "bounce";
  reason: MusicReason | null = null;
  ducked = false;
  volume = 0.6;
  private beatEpoch = 0;

  subscribe(fn: (e: MusicEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: MusicEvent) {
    for (const fn of this.listeners) fn(e);
  }

  get playing(): boolean {
    return this.session != null;
  }

  get state(): MusicState {
    return {
      playing: this.playing,
      station: this.station,
      reason: this.reason,
      bpm: this.session?.bpm ?? stationById(this.station).bpm,
      ducked: this.ducked,
      beatEpoch: this.beatEpoch,
      mode: this.session?.composer.mode?.name ?? null,
      tension: this.tension && this.playing,
    };
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "playback" });
    this.ctx = ctx;
    this.noise = makeNoise(ctx);
    this.master = ctx.createGain();
    this.master.gain.value = this.curve(this.volume);
    this.duckGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.duckGain.connect(this.master).connect(comp).connect(this.analyser).connect(ctx.destination);
    return ctx;
  }

  /** Perceptual volume: a slider at half sounds like half. */
  private curve(v: number): number {
    return Math.pow(Math.max(0, Math.min(1, v)), 2) * 0.9;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.ctx) this.master.gain.setTargetAtTime(this.curve(this.volume), this.ctx.currentTime, 0.05);
  }

  /** Start (or switch to) a station. Switching crossfades. */
  play(id: StationId, reason: MusicReason) {
    const ctx = this.ensureCtx();
    this.cancelSuspend();
    void ctx.resume();
    if (this.session && this.session.station.id === id) {
      this.reason = reason;
      this.emit({ type: "state", state: this.state });
      return;
    }
    if (this.session) this.fadeOut(this.session, 0.9);
    this.cancelFinale();

    const station = stationById(id);
    const bus = ctx.createGain();
    const now = ctx.currentTime;
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(station.gain ?? 1, now + 1.4);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = station.filter ?? 18000;
    tone.connect(bus);
    bus.connect(this.duckGain);
    const start = now + 0.08;
    const rig: Rig = { ctx, out: tone, noise: this.noise };
    const session = newSession(station, new Composer(station), bus, tone, rig, start);
    session.stopAmbient = station.ambient?.(rig, start);
    this.session = session;
    this.station = id;
    this.reason = reason;
    // Energy only means something while your agent works.
    this.applyEnergy(reason === "work" ? this.energy : 0.5, true);
    session.tension = this.tension && reason === "work";
    this.beatEpoch = Date.now() + (start - now) * 1000;
    if (this.timer == null) this.timer = window.setInterval(() => this.pump(), TICK_MS);
    this.pump();
    this.emit({ type: "state", state: this.state });
  }

  stop(fade = 0.9) {
    if (!this.session) return;
    this.cancelFinale();
    this.fadeOut(this.session, fade);
    this.session = null;
    this.reason = null;
    this.ducked = false;
    if (this.ctx) this.duckGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1);
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    for (const id of this.beatTimers) window.clearTimeout(id);
    this.beatTimers.clear();
    this.suspendLater(fade + 1.5);
    this.emit({ type: "state", state: this.state });
  }

  /** Lower the music while Mochi needs your attention (`level` is how far down). */
  duck(on: boolean, level = 0.18) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (this.ctx) this.duckGain.gain.setTargetAtTime(on ? level : 1, this.ctx.currentTime, on ? 0.15 : 0.6);
    this.emit({ type: "state", state: this.state });
  }

  /**
   * How busy your agent is, 0…1 (0.5 = neutral). Up to ±7 % tempo, a darker or
   * brighter tone, and extra layers in the stations above ~0.65.
   */
  setEnergy(e: number) {
    this.energy = Math.max(0, Math.min(1, e));
    if (this.session && this.reason === "work") this.applyEnergy(this.energy);
  }

  private applyEnergy(e: number, initial = false) {
    const s = this.session;
    if (!s || !this.ctx) return;
    s.energy = e;
    const max = s.station.filter ?? 18000;
    // Below neutral the music mellows (the lowpass closes); above it stays open.
    const cutoff = e >= 0.5 ? max : max * Math.pow(0.25, (0.5 - e) * 2);
    s.tone.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, initial ? 0.01 : 1.2);
    const target = s.station.bpm * (1 + 0.14 * (e - 0.5));
    if (Math.abs(target - s.bpm) < 0.6) return;
    // Change tempo from the next step on, keeping the beat continuous.
    const beatsNow = this.beatPos() ?? 0;
    s.anchorTime = stepTime(s, s.step) - (s.step % 2 === 1 ? s.station.swing * stepDur(s) : 0);
    s.anchorStep = s.step;
    s.bpm = target;
    s.nextTime = stepTime(s, s.step);
    this.beatEpoch = Date.now() - (beatsNow * 60000) / s.bpm;
    if (!initial) this.emit({ type: "state", state: this.state });
  }

  /** Your agent is waiting for you: hold the harmony on a suspended chord. */
  setTension(on: boolean) {
    if (this.tension === on) return;
    this.tension = on;
    if (this.session) this.session.tension = on && this.reason === "work";
    this.emit({ type: "state", state: this.state });
  }

  /**
   * End the song properly: a bar on the dominant with a run up (or, in a
   * dastgah, a forud down to the tonic), then the home chord rings out.
   * Returns false when nothing is playing. `onLastChord` fires on that chord.
   */
  finale(onLastChord?: () => void): boolean {
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx || s.finaleBar != null) return false;
    s.tension = false;
    this.tension = false;
    this.applyEnergy(Math.max(0.5, s.energy));
    // Start on the next bar, or the one after if this one is nearly over.
    const left = s.spBar - (s.step % s.spBar);
    s.finaleBar = Math.floor(s.step / s.spBar) + (left <= 3 ? 2 : 1);
    const lastAt = stepTime(s, (s.finaleBar + 1) * s.spBar);
    const delay = Math.max(0, (lastAt - ctx.currentTime) * 1000);
    this.cancelFinale();
    this.finaleTimer = window.setTimeout(() => {
      this.finaleTimer = null;
      onLastChord?.();
      // Everyone listening (Mochi!) hears the ending like a victory jingle.
      this.emit({ type: "jingle", kind: "finish" });
      // Let the last chord ring, then stop for real.
      this.finaleTimer = window.setTimeout(() => {
        this.finaleTimer = null;
        if (this.session === s) this.stop(1.6);
      }, 2200);
    }, delay);
    return true;
  }

  private cancelFinale() {
    if (this.finaleTimer != null) window.clearTimeout(this.finaleTimer);
    this.finaleTimer = null;
  }

  /** Set the ambience mixer (rain, café, fire…). Plays with or without music. */
  setAmbience(levels: Partial<AmbienceLevels>) {
    this.ambienceLevels = { ...this.ambienceLevels, ...levels };
    const anyOn = Object.values(this.ambienceLevels).some((v) => (v ?? 0) > 0);
    if (!anyOn && !this.ambience) return;
    const ctx = this.ensureCtx();
    if (anyOn) {
      this.cancelSuspend();
      void ctx.resume();
    }
    this.ambience ??= new Ambience({ ctx, out: this.duckGain, noise: this.noise });
    this.ambience.set(this.ambienceLevels);
    if (!anyOn && !this.session) this.suspendLater(3.5);
  }

  get ambienceOn(): boolean {
    return this.ambience?.active ?? false;
  }

  /** A short tune on top of (or instead of) the music: a win or a fail. */
  jingle(kind: JingleKind) {
    const ctx = this.ensureCtx();
    this.cancelSuspend();
    void ctx.resume();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.master);
    const r: Rig = { ctx, out, noise: this.noise };
    const t = ctx.currentTime + 0.05;
    if (kind === "finish") {
      [72, 76, 79, 84].forEach((m, i) => {
        bell(r, t + i * 0.09, m, 0.5, 0.9);
        chip(r, t + i * 0.09, m, 0.08, 0.5, false);
      });
      for (const m of [84, 88, 91]) bell(r, t + 0.42, m, 1.2, 0.7);
      for (let i = 0; i < 5; i++) bell(r, t + 0.55 + i * 0.07, 96 + [0, 4, 7, 12, 16][i], 0.4, 0.35);
    } else if (kind === "birthday") {
      // "Happy Birthday" (public domain), in 3/4 with a little bell accompaniment.
      const beat = 0.5;
      const tune: [number, number][] = [
        [67, 0.75], [67, 0.25], [69, 1], [67, 1], [72, 1], [71, 2],
        [67, 0.75], [67, 0.25], [69, 1], [67, 1], [74, 1], [72, 2],
        [67, 0.75], [67, 0.25], [79, 1], [76, 1], [72, 1], [71, 1], [69, 2],
        [77, 0.75], [77, 0.25], [76, 1], [72, 1], [74, 1], [72, 3],
      ];
      let at = t;
      for (const [m, len] of tune) {
        bell(r, at, m + 12, len * beat, 0.9);
        chip(r, at, m, len * beat * 0.9, 0.35, false);
        at += len * beat;
      }
      for (let bar = 0; bar < 8; bar++) {
        const root = [60, 55, 55, 60, 60, 65, 60, 60][bar];
        bell(r, t + 0.25 * beat * 4 + bar * 3 * beat, root, 1.2, 0.35);
      }
    } else {
      [67, 66, 65].forEach((m, i) => wah(r, t + i * 0.36, m, 0.32, 1));
      wah(r, t + 1.08, 64, 1.0, 1);
    }
    this.emit({ type: "jingle", kind });
    if (!this.session) this.suspendLater(kind === "birthday" ? 12 : 3);
  }

  /** Beats since the music started (fractional), or null when silent. */
  beatPos(): number | null {
    const s = this.session;
    if (!s || !this.ctx) return null;
    const beats = s.anchorStep / s.spBeat + ((this.ctx.currentTime - s.anchorTime) * s.bpm) / 60;
    return Math.max(0, beats);
  }

  /** Loudness right now, 0…1 — cheap enough to read every frame. */
  level(): number {
    if (!this.ctx || !this.session) return 0;
    if (!this.levelBuf) this.levelBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 3.2);
  }

  private pump() {
    const s = this.session;
    const ctx = this.ctx;
    if (!s || !ctx) return;
    while (!s.ended && s.nextTime < ctx.currentTime + LOOKAHEAD) {
      const modeBefore = s.composer.mode;
      const played = scheduleStep(s, s.nextTime, Math.random);
      const delay = Math.max(0, (s.nextTime - ctx.currentTime) * 1000);
      if (s.step % s.spBeat === 0) {
        const beat = s.step / s.spBeat;
        const perBar = s.spBar / s.spBeat;
        this.later(delay, () => this.emit({ type: "beat", beat, bar: Math.floor(beat / perBar), downbeat: beat % perBar === 0 }));
      }
      if (played.lead && this.wantNotes) {
        const { midi, steps } = played.lead;
        const key = s.station.key;
        this.later(delay, () => this.emit({ type: "note", midi, dur: steps * played.stepDur, low: key, high: key + 24 }));
      }
      if (s.composer.mode !== modeBefore) this.later(delay, () => this.emit({ type: "state", state: this.state }));
      s.step++;
      s.nextTime = stepTime(s, s.step);
    }
  }

  /** Runs `fn` when the audio gets there; cancelled if the music stops. */
  private later(delay: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.beatTimers.delete(id);
      fn();
    }, delay);
    this.beatTimers.add(id);
  }

  private fadeOut(s: Session, fade: number) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    s.bus.gain.cancelScheduledValues(now);
    s.bus.gain.setValueAtTime(Math.max(0.0001, s.bus.gain.value), now);
    s.bus.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    s.stopAmbient?.(now);
    window.setTimeout(() => s.bus.disconnect(), (fade + 2) * 1000);
  }

  private suspendLater(seconds: number) {
    this.cancelSuspend();
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null;
      if (!this.session && !this.ambienceOn) void this.ctx?.suspend();
    }, seconds * 1000);
  }

  private cancelSuspend() {
    if (this.suspendTimer != null) window.clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }
}

/**
 * Renders a few seconds of a station without playing it — used to check the
 * stations in tests and to make listening samples.
 */
export async function renderStation(id: StationId, seconds: number, sampleRate = 44100, opts: { energy?: number; tension?: boolean; finaleAt?: number } = {}): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const station = stationById(id);
  const out = ctx.createGain();
  out.gain.value = 0.55 * (station.gain ?? 1);
  let node: AudioNode = out;
  if (station.filter) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = station.filter;
    lp.connect(out);
    node = lp;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  out.connect(comp).connect(ctx.destination);
  const rig: Rig = { ctx, out: node, noise: makeNoise(ctx) };
  const tone = ctx.createBiquadFilter();
  const s = newSession(station, new Composer(station, 7), out, tone, rig, 0.05);
  s.energy = opts.energy ?? 0.5;
  s.tension = opts.tension ?? false;
  if (s.energy !== 0.5) s.bpm = station.bpm * (1 + 0.14 * (s.energy - 0.5));
  station.ambient?.(rig, 0.05);
  while (!s.ended && s.nextTime < seconds) {
    if (opts.finaleAt != null && s.finaleBar == null && s.nextTime >= opts.finaleAt) s.finaleBar = Math.floor(s.step / s.spBar) + 1;
    scheduleStep(s, s.nextTime, Math.random);
    s.step++;
    s.nextTime = stepTime(s, s.step);
  }
  return ctx.startRendering();
}

export { STATIONS, stationById };
export type { StationId };
