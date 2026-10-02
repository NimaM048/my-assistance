// The music player: schedules the stations' notes ahead of time on the audio
// clock (the standard Web Audio "lookahead" pattern), crossfades between
// stations, ducks under alerts, plays jingles, and tells listeners about every
// beat so Mochi can dance in time.
//
// When nothing plays, the scheduler timer is cleared and the AudioContext is
// suspended, so silence costs nothing.

import { Composer, STATIONS, stationById, type Station, type StationId } from "./stations";
import { bell, chip, makeNoise, wah, type Rig } from "./synth";

export type MusicReason = "work" | "focus" | "manual";
export type JingleKind = "finish" | "error" | "birthday";

export interface MusicState {
  playing: boolean;
  station: StationId;
  reason: MusicReason | null;
  bpm: number;
  ducked: boolean;
  /** Wall-clock time (Date.now()) of the first beat, so other windows can follow the groove. */
  beatEpoch: number;
}

export type MusicEvent =
  | { type: "beat"; beat: number; bar: number; downbeat: boolean }
  | { type: "state"; state: MusicState }
  | { type: "jingle"; kind: JingleKind };

const LOOKAHEAD = 0.14; // seconds of notes scheduled ahead
const TICK_MS = 25;

interface Session {
  station: Station;
  composer: Composer;
  bus: GainNode;
  rig: Rig;
  startTime: number;
  step: number;
  nextTime: number;
  stopAmbient?: (at: number) => void;
}

function stepTime(st: Station, start: number, step: number): number {
  const d = 60 / st.bpm / 4;
  return start + step * d + (step % 2 === 1 ? st.swing * d : 0);
}

/** Schedules one 16th-note step of a station. Shared by live play and offline renders. */
function scheduleStep(s: Session, t: number, rand: () => number) {
  const stepInBar = s.step % 16;
  const bar = Math.floor(s.step / 16);
  const lead = s.composer.melody(bar).find((n) => n.step === stepInBar) ?? null;
  s.station.play(s.rig, t, {
    step: stepInBar,
    bar,
    chord: s.composer.chord(bar),
    root: s.composer.root(bar),
    lead,
    stepDur: 60 / s.station.bpm / 4,
    rand,
  });
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
      bpm: stationById(this.station).bpm,
      ducked: this.ducked,
      beatEpoch: this.beatEpoch,
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

    const station = stationById(id);
    const bus = ctx.createGain();
    const now = ctx.currentTime;
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(station.gain ?? 1, now + 1.4);
    let out: AudioNode = bus;
    if (station.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = station.filter;
      lp.connect(bus);
      out = lp;
    }
    bus.connect(this.duckGain);
    const start = now + 0.08;
    const rig: Rig = { ctx, out, noise: this.noise };
    this.session = {
      station, composer: new Composer(station), bus, rig,
      startTime: start, step: 0, nextTime: start,
      stopAmbient: station.ambient?.(rig, start),
    };
    this.station = id;
    this.reason = reason;
    this.beatEpoch = Date.now() + (start - now) * 1000;
    if (this.timer == null) this.timer = window.setInterval(() => this.pump(), TICK_MS);
    this.pump();
    this.emit({ type: "state", state: this.state });
  }

  stop(fade = 0.9) {
    if (!this.session) return;
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

  /** Lower the music while Mochi needs your attention. */
  duck(on: boolean) {
    if (this.ducked === on) return;
    this.ducked = on;
    if (this.ctx) this.duckGain.gain.setTargetAtTime(on ? 0.18 : 1, this.ctx.currentTime, on ? 0.15 : 0.6);
    this.emit({ type: "state", state: this.state });
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
    if (!this.session) this.suspendLater(3);
  }

  /** Beats since the music started (fractional), or null when silent. */
  beatPos(): number | null {
    if (!this.session || !this.ctx) return null;
    const elapsed = this.ctx.currentTime - this.session.startTime;
    if (elapsed < 0) return 0;
    return (elapsed * this.session.station.bpm) / 60;
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
    while (s.nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(s, s.nextTime, Math.random);
      if (s.step % 4 === 0) {
        const beat = s.step / 4;
        const delay = Math.max(0, (s.nextTime - ctx.currentTime) * 1000);
        const id = window.setTimeout(() => {
          this.beatTimers.delete(id);
          this.emit({ type: "beat", beat, bar: Math.floor(beat / 4), downbeat: beat % 4 === 0 });
        }, delay);
        this.beatTimers.add(id);
      }
      s.step++;
      s.nextTime = stepTime(s.station, s.startTime, s.step);
    }
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
      if (!this.session) void this.ctx?.suspend();
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
export async function renderStation(id: StationId, seconds: number, sampleRate = 44100): Promise<AudioBuffer> {
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
  const s: Session = { station, composer: new Composer(station, 7), bus: out, rig, startTime: 0.05, step: 0, nextTime: 0.05 };
  station.ambient?.(rig, 0.05);
  while (s.nextTime < seconds) {
    scheduleStep(s, s.nextTime, Math.random);
    s.step++;
    s.nextTime = stepTime(station, s.startTime, s.step);
  }
  return ctx.startRendering();
}

export { STATIONS, stationById };
export type { StationId };
