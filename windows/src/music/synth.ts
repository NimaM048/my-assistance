// Tiny instruments for Mochi's music, built from plain Web Audio nodes.
//
// No samples, no files, no network: every sound is an oscillator or a bit of
// noise with an envelope, so the music works offline on the desktop and costs
// nothing to ship. Each function schedules one note at an exact audio time and
// lets its nodes stop (and be garbage collected) on their own.

export interface Rig {
  ctx: BaseAudioContext;
  /** Where instruments plug in (the station bus). */
  out: AudioNode;
  /** Two seconds of white noise, shared by every percussive sound. */
  noise: AudioBuffer;
}

export const mtof = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Attack–decay envelope on a fresh gain node. */
function envGain(r: Rig, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function osc(r: Rig, type: OscillatorType, freq: number, t: number, stop: number): OscillatorNode {
  const o = r.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(stop);
  return o;
}

function noiseSrc(r: Rig, t: number, dur: number): AudioBufferSourceNode {
  const s = r.ctx.createBufferSource();
  s.buffer = r.noise;
  // A random offset keeps repeated hits from sounding identical.
  s.start(t, Math.random() * 1.5, dur + 0.05);
  return s;
}

// ── Drums ─────────────────────────────────────────────────────────────────────

export function kick(r: Rig, t: number, vel = 1) {
  const o = osc(r, "sine", 150, t, t + 0.4);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = envGain(r, t, 0.9 * vel, 0.004, 0.32);
  o.connect(g).connect(r.out);
}

export function snare(r: Rig, t: number, vel = 1) {
  const n = noiseSrc(r, t, 0.2);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900;
  bp.Q.value = 0.8;
  const g = envGain(r, t, 0.42 * vel, 0.002, 0.16);
  n.connect(bp).connect(g).connect(r.out);
  const body = osc(r, "triangle", 190, t, t + 0.12);
  const bg = envGain(r, t, 0.25 * vel, 0.002, 0.08);
  body.connect(bg).connect(r.out);
}

export function hat(r: Rig, t: number, vel = 1, open = false) {
  const n = noiseSrc(r, t, open ? 0.3 : 0.06);
  const hp = r.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7200;
  const g = envGain(r, t, 0.16 * vel, 0.001, open ? 0.24 : 0.04);
  n.connect(hp).connect(g).connect(r.out);
}

export function clap(r: Rig, t: number, vel = 1) {
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1400;
  bp.Q.value = 1.2;
  bp.connect(r.out);
  // Three tight bursts make a hand clap rather than a hiss.
  for (const [k, offset] of [[0.55, 0], [0.45, 0.012], [0.6, 0.024]] as const) {
    const n = noiseSrc(r, t + offset, 0.14);
    const g = envGain(r, t + offset, k * vel, 0.001, offset === 0.024 ? 0.13 : 0.012);
    n.connect(g).connect(bp);
  }
}

export function shaker(r: Rig, t: number, vel = 1) {
  const n = noiseSrc(r, t, 0.08);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 5200;
  bp.Q.value = 2;
  const g = envGain(r, t, 0.12 * vel, 0.012, 0.05);
  n.connect(bp).connect(g).connect(r.out);
}

/** 8-bit noise drum for the chiptune station. */
export function chipNoise(r: Rig, t: number, vel = 1, long = false) {
  const n = noiseSrc(r, t, long ? 0.18 : 0.05);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = long ? 4000 : 9000;
  const g = envGain(r, t, (long ? 0.3 : 0.12) * vel, 0.001, long ? 0.15 : 0.04);
  n.connect(lp).connect(g).connect(r.out);
}

/** Vinyl dust: a single quiet click. */
export function crackle(r: Rig, t: number, vel = 1) {
  const n = noiseSrc(r, t, 0.01);
  const hp = r.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 2500;
  const g = envGain(r, t, 0.05 * vel, 0.0005, 0.006);
  n.connect(hp).connect(g).connect(r.out);
}

// ── Pitched ───────────────────────────────────────────────────────────────────

export function bass(r: Rig, t: number, midi: number, dur: number, vel = 1, type: OscillatorType = "triangle") {
  const o = osc(r, type, mtof(midi), t, t + dur + 0.1);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(type === "triangle" ? 1400 : 900, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + dur);
  const g = envGain(r, t, 0.42 * vel, 0.008, dur);
  o.connect(lp).connect(g).connect(r.out);
}

/** Soft electric piano: a sine pair with a bell-ish attack. */
export function keys(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const g = envGain(r, t, 0.16 * vel, 0.01, dur);
  const a = osc(r, "sine", f, t, t + dur + 0.1);
  const b = osc(r, "triangle", f * 2.001, t, t + dur + 0.1);
  const bg = r.ctx.createGain();
  bg.gain.setValueAtTime(0.25, t);
  bg.gain.exponentialRampToValueAtTime(0.02, t + 0.3);
  a.connect(g);
  b.connect(bg).connect(g);
  g.connect(r.out);
}

/** Square-wave lead with a little vibrato — the chiptune voice. */
export function chip(r: Rig, t: number, midi: number, dur: number, vel = 1, vibrato = true) {
  const o = osc(r, "square", mtof(midi), t, t + dur + 0.05);
  if (vibrato && dur > 0.2) {
    const lfo = osc(r, "sine", 6, t, t + dur + 0.05);
    const depth = r.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(mtof(midi) * 0.012, t + dur);
    lfo.connect(depth).connect(o.frequency);
  }
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.005);
  g.gain.setValueAtTime(0.07 * vel, t + dur * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(r.out);
}

/** Music-box tine: a sine with an inharmonic partial that dies fast. */
export function bell(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const g = envGain(r, t, 0.16 * vel, 0.002, Math.max(0.6, dur));
  osc(r, "sine", f, t, t + dur + 0.7).connect(g);
  const p = envGain(r, t, 0.07 * vel, 0.001, 0.35);
  osc(r, "sine", f * 2.76, t, t + 0.5).connect(p).connect(r.out);
  g.connect(r.out);
}

/** Marimba-ish pluck for the bouncy station. */
export function pluck(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const g = envGain(r, t, 0.2 * vel, 0.002, Math.min(0.5, dur + 0.15));
  osc(r, "sine", f, t, t + 0.7).connect(g);
  const p = envGain(r, t, 0.08 * vel, 0.001, 0.06);
  osc(r, "sine", f * 4, t, t + 0.1).connect(p).connect(r.out);
  g.connect(r.out);
}

/** Warm pad under a chord: two detuned saws through a lowpass. */
export function pad(r: Rig, t: number, midis: number[], dur: number, vel = 1) {
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.035 * vel, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  for (const m of midis) {
    for (const detune of [-7, 7]) {
      const o = osc(r, "sawtooth", mtof(m), t, t + dur + 0.05);
      o.detune.value = detune;
      o.connect(lp);
    }
  }
  lp.connect(g).connect(r.out);
}

/** A raindrop on the window: a tiny falling blip. */
export function drop(r: Rig, t: number, vel = 1) {
  const f = 1800 + Math.random() * 2600;
  const o = osc(r, "sine", f, t, t + 0.06);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.05);
  const g = envGain(r, t, 0.035 * vel, 0.001, 0.045);
  o.connect(g).connect(r.out);
}

/**
 * Continuous rain: two bands of filtered noise that drift slowly. Returns a
 * function that fades it out.
 */
export function rainBed(r: Rig, t: number): (at: number) => void {
  const src = r.ctx.createBufferSource();
  src.buffer = r.noise;
  src.loop = true;
  const lo = r.ctx.createBiquadFilter();
  lo.type = "lowpass";
  lo.frequency.value = 1200;
  const hi = r.ctx.createBiquadFilter();
  hi.type = "bandpass";
  hi.frequency.value = 4200;
  hi.Q.value = 0.6;
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.11, t + 3);
  const hg = r.ctx.createGain();
  hg.gain.value = 0.35;
  src.connect(lo).connect(g);
  src.connect(hi).connect(hg).connect(g);
  g.connect(r.out);
  // A slow swell so the rain breathes instead of hissing flat.
  const lfo = r.ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = r.ctx.createGain();
  depth.gain.value = 0.03;
  lfo.connect(depth).connect(g.gain);
  src.start(t);
  lfo.start(t);
  return (at: number) => {
    g.gain.cancelScheduledValues(at);
    g.gain.setValueAtTime(g.gain.value, at);
    g.gain.linearRampToValueAtTime(0.0001, at + 1.2);
    src.stop(at + 1.3);
    lfo.stop(at + 1.3);
  };
}

/** The descending "wah-wah" of a cartoon fail. */
export function wah(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const o = osc(r, "sawtooth", mtof(midi), t, t + dur + 0.05);
  o.frequency.linearRampToValueAtTime(mtof(midi - 1), t + dur);
  const lfo = osc(r, "sine", 7, t, t + dur + 0.05);
  const depth = r.ctx.createGain();
  depth.gain.value = mtof(midi) * 0.02;
  lfo.connect(depth).connect(o.frequency);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.linearRampToValueAtTime(1600, t + dur * 0.3);
  lp.frequency.linearRampToValueAtTime(500, t + dur);
  const g = envGain(r, t, 0.12 * vel, 0.03, dur);
  o.connect(lp).connect(g).connect(r.out);
}
