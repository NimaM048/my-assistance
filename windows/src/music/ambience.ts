// Mochi's ambience mixer: rain, a café, a fireplace, wind, birds and crickets.
//
// Like the music, every sound is made here from noise and oscillators — no
// recordings, no network. Each channel is a steady "bed" (filtered noise) and/or
// little events (a drop, a clink, a crackle, a chirp) scheduled a moment ahead
// on the audio clock. Channels you turn down to zero stop completely.

import { mtof, type Rig } from "./synth";

export type AmbienceId = "rain" | "cafe" | "fire" | "wind" | "birds" | "crickets";
export type AmbienceLevels = Record<AmbienceId, number>;

export const AMBIENCE: { id: AmbienceId; name: string; emoji: string }[] = [
  { id: "rain", name: "Rain", emoji: "🌧" },
  { id: "cafe", name: "Café", emoji: "☕" },
  { id: "fire", name: "Fireplace", emoji: "🔥" },
  { id: "wind", name: "Wind", emoji: "🍃" },
  { id: "birds", name: "Birds", emoji: "🐦" },
  { id: "crickets", name: "Crickets", emoji: "🦗" },
];

export const SILENT: AmbienceLevels = { rain: 0, cafe: 0, fire: 0, wind: 0, birds: 0, crickets: 0 };

export const AMBIENCE_PRESETS: { id: string; name: string; emoji: string; levels: Partial<AmbienceLevels> }[] = [
  { id: "rainy-cafe", name: "Rainy café", emoji: "☕", levels: { rain: 0.55, cafe: 0.5 } },
  { id: "cabin", name: "Cabin night", emoji: "🛖", levels: { fire: 0.7, wind: 0.3, crickets: 0.25 } },
  { id: "forest", name: "Forest morning", emoji: "🌲", levels: { birds: 0.7, wind: 0.25 } },
  { id: "storm", name: "Storm", emoji: "⛈", levels: { rain: 0.9, wind: 0.6 } },
  { id: "summer", name: "Summer night", emoji: "🌙", levels: { crickets: 0.65, wind: 0.15, fire: 0.2 } },
];

/** How loud each channel is at full slider, so they mix evenly. */
const TRIM: AmbienceLevels = { rain: 2.1, cafe: 1.0, fire: 1.3, wind: 1.8, birds: 6, crickets: 3.2 };
const LOOKAHEAD = 0.4;

interface Channel {
  gain: GainNode;
  level: number;
  stopBed: ((at: number) => void) | null;
  /** Audio time of the next event. */
  next: number;
  /** Seconds since the level reached zero (the bed stops after a while). */
  silentSince: number | null;
  /** Café and wind steer their beds through these. */
  voices?: { filter: BiquadFilterNode; gain: GainNode }[];
}

export class Ambience {
  private channels = new Map<AmbienceId, Channel>();
  private timer: number | null = null;
  private brown: AudioBuffer;
  private bus: GainNode;

  constructor(private rig: Rig) {
    this.brown = brownNoise(rig.ctx);
    this.bus = rig.ctx.createGain();
    this.bus.connect(rig.out);
  }

  /** True while any channel is audible. */
  get active(): boolean {
    for (const c of this.channels.values()) if (c.level > 0) return true;
    return false;
  }

  set(levels: Partial<AmbienceLevels>) {
    const ctx = this.rig.ctx;
    const now = ctx.currentTime;
    for (const [id, raw] of Object.entries(levels) as [AmbienceId, number][]) {
      const level = Math.max(0, Math.min(1, raw ?? 0));
      let c = this.channels.get(id);
      if (!c && level <= 0) continue;
      if (!c) {
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        gain.connect(this.bus);
        c = { gain, level: 0, stopBed: null, next: now + 0.1, silentSince: null };
        this.channels.set(id, c);
      }
      c.level = level;
      const target = level > 0 ? Math.pow(level, 1.6) * TRIM[id] : 0.0001;
      c.gain.gain.setTargetAtTime(target, now, 0.35);
      if (level > 0) {
        c.silentSince = null;
        if (!c.stopBed) c.stopBed = this.startBed(id, c, now);
      } else {
        c.silentSince ??= now;
      }
    }
    if (this.active && this.timer == null) {
      this.timer = window.setInterval(() => this.pump(), 120);
      this.pump();
    }
  }

  /** Fades everything out and frees the nodes. */
  stopAll() {
    this.set({ ...SILENT });
  }

  private pump() {
    const now = this.rig.ctx.currentTime;
    let alive = false;
    for (const [id, c] of this.channels) {
      if (c.level > 0) {
        alive = true;
        if (c.next < now) c.next = now + 0.05;
        while (c.next < now + LOOKAHEAD) c.next += this.event(id, c, c.next);
      } else if (c.silentSince != null && now - c.silentSince > 2) {
        c.stopBed?.(now);
        c.stopBed = null;
        c.gain.disconnect();
        this.channels.delete(id);
      } else if (c.stopBed) {
        alive = true;
      }
    }
    if (!alive && this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Beds ────────────────────────────────────────────────────────────────────

  private startBed(id: AmbienceId, c: Channel, t: number): ((at: number) => void) | null {
    const ctx = this.rig.ctx;
    const sources: AudioScheduledSourceNode[] = [];
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(t, Math.random() * 1.5);
      sources.push(s);
      return s;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };
    const gain = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };

    switch (id) {
      case "rain": {
        const n = loop(this.rig.noise);
        n.connect(filter("lowpass", 1300)).connect(gain(0.16)).connect(c.gain);
        n.connect(filter("bandpass", 4600, 0.5)).connect(gain(0.07)).connect(c.gain);
        const rumble = loop(this.brown);
        rumble.connect(filter("lowpass", 260)).connect(gain(0.12)).connect(c.gain);
        break;
      }
      case "cafe": {
        // A room full of quiet conversations: a few "voices" of band-passed
        // noise whose pitch and loudness wander like speech.
        const room = loop(this.brown);
        room.connect(filter("lowpass", 520)).connect(gain(0.08)).connect(c.gain);
        const src = loop(this.rig.noise);
        const lp = filter("lowpass", 2400);
        lp.connect(c.gain);
        c.voices = [];
        for (let i = 0; i < 4; i++) {
          const f = filter("bandpass", 400 + i * 220, 5);
          const g = gain(0.0001);
          src.connect(f).connect(g).connect(lp);
          c.voices.push({ filter: f, gain: g });
        }
        break;
      }
      case "fire": {
        const rumble = loop(this.brown);
        rumble.connect(filter("lowpass", 190)).connect(gain(0.32)).connect(c.gain);
        const hiss = loop(this.rig.noise);
        const hg = gain(0.012);
        hiss.connect(filter("highpass", 3200)).connect(hg).connect(c.gain);
        break;
      }
      case "wind": {
        const n = loop(this.brown);
        c.voices = [];
        for (const [freq, q, v] of [[520, 1.1, 0.5], [1300, 9, 0.05]] as const) {
          const f = filter("bandpass", freq, q);
          const g = gain(v);
          n.connect(f).connect(g).connect(c.gain);
          c.voices.push({ filter: f, gain: g });
        }
        break;
      }
      default:
        // Birds and crickets are made only of events.
        return () => undefined;
    }
    return (at: number) => {
      for (const s of sources) {
        try { s.stop(at + 0.6); } catch { /* already stopped */ }
      }
      c.voices = undefined;
    };
  }

  // ── Events ──────────────────────────────────────────────────────────────────

  /** Plays one event at `t` and returns the seconds until the next one. */
  private event(id: AmbienceId, c: Channel, t: number): number {
    const r = Math.random;
    switch (id) {
      case "rain":
        this.drop(c, t, 0.3 + r() * 0.7);
        return 0.025 + r() * 0.12;
      case "cafe": {
        // Steer one voice somewhere new; now and then a cup or a spoon.
        const v = c.voices?.[Math.floor(r() * (c.voices?.length ?? 1))];
        if (v) {
          v.filter.frequency.setTargetAtTime(280 + r() * 900, t, 0.08);
          v.gain.gain.setTargetAtTime(r() < 0.35 ? 0.0001 : 0.25 + r() * 0.6, t, 0.06);
        }
        if (r() < 0.035) this.clink(c, t + r() * 0.1);
        return 0.07 + r() * 0.16;
      }
      case "fire": {
        const burst = r() < 0.18;
        const n = burst ? 3 + Math.floor(r() * 5) : 1;
        for (let i = 0; i < n; i++) this.crackle(c, t + i * (0.008 + r() * 0.03), Math.pow(r(), 1.5));
        if (r() < 0.04) this.pop(c, t + 0.05);
        return 0.04 + r() * 0.32;
      }
      case "wind": {
        const [body, whistle] = c.voices ?? [];
        if (body) {
          body.filter.frequency.setTargetAtTime(330 + r() * 700, t, 1.4);
          body.gain.gain.setTargetAtTime(0.2 + r() * 0.75, t, 1.2);
        }
        if (whistle) {
          whistle.filter.frequency.setTargetAtTime(1000 + r() * 900, t, 1.8);
          whistle.gain.gain.setTargetAtTime(r() < 0.5 ? 0.01 : 0.03 + r() * 0.06, t, 1.5);
        }
        return 1.2 + r() * 1.8;
      }
      case "birds":
        this.bird(c, t);
        return 1.1 + r() * 3.8;
      case "crickets":
        this.cricket(c, t, r() < 0.5 ? -0.55 : 0.55, r() < 0.5 ? 4350 : 4720);
        return 0.28 + r() * 0.4;
    }
  }

  private envGain(t: number, peak: number, attack: number, decay: number, out: AudioNode): GainNode {
    const g = this.rig.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(out);
    return g;
  }

  private panner(pan: number, out: AudioNode): AudioNode {
    const ctx = this.rig.ctx;
    if (!("createStereoPanner" in ctx)) return out;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    return p;
  }

  private tone(type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.rig.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private drop(c: Channel, t: number, vel: number) {
    const f = 1500 + Math.random() * 3200;
    const out = this.panner(Math.random() * 1.6 - 0.8, c.gain);
    const o = this.tone("sine", f, t, 0.05, this.envGain(t, 0.035 * vel, 0.001, 0.04, out));
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.045);
  }

  private clink(c: Channel, t: number) {
    const out = this.panner(Math.random() * 1.4 - 0.7, c.gain);
    const f = 2400 + Math.random() * 1400;
    for (const [mult, peak, decay] of [[1, 0.05, 0.35], [2.71, 0.025, 0.16], [4.13, 0.012, 0.08]] as const) {
      this.tone("sine", f * mult, t, decay + 0.05, this.envGain(t, peak, 0.001, decay, out));
    }
    if (Math.random() < 0.5) {
      for (const [mult, peak, decay] of [[1, 0.03, 0.25], [2.71, 0.015, 0.1]] as const) {
        this.tone("sine", f * 1.12 * mult, t + 0.11, decay + 0.05, this.envGain(t + 0.11, peak, 0.001, decay, out));
      }
    }
  }

  private crackle(c: Channel, t: number, vel: number) {
    const ctx = this.rig.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.rig.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 + Math.random() * 4800;
    bp.Q.value = 1.4;
    s.connect(bp).connect(this.envGain(t, 0.25 * vel + 0.03, 0.0005, 0.004 + Math.random() * 0.012, this.panner(Math.random() * 0.8 - 0.4, c.gain)));
    s.start(t, Math.random() * 1.5, 0.03);
  }

  private pop(c: Channel, t: number) {
    const o = this.tone("sine", 420, t, 0.08, this.envGain(t, 0.12, 0.001, 0.06, c.gain));
    o.frequency.exponentialRampToValueAtTime(180, t + 0.05);
  }

  /** A bird call: a few quick rising tweets, a trill, or a two-note whistle. */
  private bird(c: Channel, t: number) {
    const r = Math.random;
    const out = this.panner(r() * 1.8 - 0.9, c.gain);
    const kind = r();
    if (kind < 0.45) {
      const n = 2 + Math.floor(r() * 3);
      const base = 2800 + r() * 1600;
      for (let i = 0; i < n; i++) {
        const at = t + i * (0.1 + r() * 0.04);
        const o = this.tone("sine", base, at, 0.07, this.envGain(at, 0.05, 0.005, 0.06, out));
        o.frequency.exponentialRampToValueAtTime(base * (1.25 + r() * 0.2), at + 0.06);
      }
    } else if (kind < 0.75) {
      const f = 3600 + r() * 900;
      const dur = 0.35 + r() * 0.3;
      const g = this.rig.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.03);
      g.gain.setValueAtTime(0.04, t + dur - 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      // Amplitude flutter: gain swings 0…1 with a fast square wave.
      const am = this.rig.ctx.createGain();
      am.gain.value = 0.5;
      const depth = this.rig.ctx.createGain();
      depth.gain.value = 0.5;
      depth.connect(am.gain);
      g.connect(am).connect(out);
      this.tone("square", 22 + r() * 10, t, dur, depth);
      const o = this.tone("sine", f, t, dur, g);
      o.frequency.linearRampToValueAtTime(f * 0.9, t + dur);
    } else {
      // "fee-bee"
      const hi = mtof(98 + r() * 4);
      const lo = hi * 0.82;
      const o1 = this.tone("sine", hi, t, 0.22, this.envGain(t, 0.045, 0.02, 0.2, out));
      o1.frequency.linearRampToValueAtTime(hi * 0.97, t + 0.2);
      const o2 = this.tone("sine", lo, t + 0.3, 0.26, this.envGain(t + 0.3, 0.04, 0.02, 0.24, out));
      o2.frequency.linearRampToValueAtTime(lo * 1.02, t + 0.5);
    }
  }

  private cricket(c: Channel, t: number, pan: number, freq: number) {
    const out = this.panner(pan, c.gain);
    const pulses = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < pulses; i++) {
      const at = t + i * 0.042;
      this.tone("sine", freq, at, 0.03, this.envGain(at, 0.05, 0.004, 0.022, out));
    }
  }
}

/** Brown (red) noise: deeper than white, for rumble, room tone and wind. */
function brownNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}
