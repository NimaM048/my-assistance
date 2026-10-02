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

// ── Persian ensemble (the "Tehran Nights" station) ────────────────────────────
//
// Pitches may be fractional MIDI numbers: 0.5 is a quarter tone, so the koron
// notes of the dastgahs come out exactly.

/** Santur: a hammered dulcimer — two strings per course, bright partials, a mezrab click. */
export function santur(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const ring = Math.min(2.4, 0.6 + dur * 1.6);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(12000, f * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(600, f * 2.5), t + ring);
  const g = envGain(r, t, 0.1 * vel, 0.0015, ring);
  // The two strings of a course are never quite in tune — that's the shimmer.
  for (const cents of [-6, 5]) {
    const o = osc(r, "triangle", f, t, t + ring + 0.1);
    o.detune.value = cents;
    o.connect(lp);
  }
  lp.connect(g).connect(r.out);
  const p = envGain(r, t, 0.045 * vel, 0.001, 0.16);
  osc(r, "sine", f * 3.01, t, t + 0.3).connect(p).connect(r.out);
  const p2 = envGain(r, t, 0.022 * vel, 0.001, 0.07);
  osc(r, "sine", f * 5.02, t, t + 0.15).connect(p2).connect(r.out);
  const n = noiseSrc(r, t, 0.02);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(9000, f * 4);
  bp.Q.value = 1.4;
  const ng = envGain(r, t, 0.05 * vel, 0.0005, 0.014);
  n.connect(bp).connect(ng).connect(r.out);
}

/** Tar: a plucked lute — nasal, woody, with a tiny scoop up into the note. */
export function tar(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const len = Math.min(0.9, dur + 0.25);
  const o = osc(r, "sawtooth", f * 0.985, t, t + len + 0.05);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
  const body = r.ctx.createBiquadFilter();
  body.type = "bandpass";
  body.frequency.value = 1100;
  body.Q.value = 1.1;
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(5200, t);
  lp.frequency.exponentialRampToValueAtTime(700, t + len);
  const g = envGain(r, t, 0.2 * vel, 0.002, len);
  o.connect(lp).connect(body).connect(g).connect(r.out);
  const sub = osc(r, "triangle", f, t, t + len + 0.05);
  const sg = envGain(r, t, 0.06 * vel, 0.003, len * 0.8);
  sub.connect(sg).connect(r.out);
}

/** Daf: the big frame drum — a deep "dum", a bright "tak", and the rings inside it. */
export function daf(r: Rig, t: number, stroke: "dum" | "tak", vel = 1) {
  if (stroke === "dum") {
    const o = osc(r, "sine", 105, t, t + 0.45);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.2);
    const g = envGain(r, t, 0.75 * vel, 0.003, 0.38);
    o.connect(g).connect(r.out);
    const n = noiseSrc(r, t, 0.12);
    const lp = r.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    const ng = envGain(r, t, 0.3 * vel, 0.002, 0.1);
    n.connect(lp).connect(ng).connect(r.out);
  } else {
    const n = noiseSrc(r, t, 0.1);
    const bp = r.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2300;
    bp.Q.value = 0.9;
    const g = envGain(r, t, 0.34 * vel, 0.001, 0.07);
    n.connect(bp).connect(g).connect(r.out);
  }
  // The chain of rings on the inside of the frame keeps shimmering a moment.
  for (const [offset, k] of [[0, 1], [0.018, 0.6]] as const) {
    const z = noiseSrc(r, t + offset, 0.3);
    const hp = r.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const zg = envGain(r, t + offset, (stroke === "dum" ? 0.05 : 0.08) * k * vel, 0.004, 0.22);
    z.connect(hp).connect(zg).connect(r.out);
  }
}

/** Tombak: the goblet drum — a round "tom" from the centre, a dry "bak" from the rim. */
export function tombak(r: Rig, t: number, stroke: "tom" | "bak", vel = 1) {
  if (stroke === "tom") {
    const o = osc(r, "sine", 175, t, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(112, t + 0.07);
    const g = envGain(r, t, 0.55 * vel, 0.002, 0.24);
    o.connect(g).connect(r.out);
  } else {
    const o = osc(r, "triangle", 640, t, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.04);
    const g = envGain(r, t, 0.16 * vel, 0.001, 0.05);
    o.connect(g).connect(r.out);
  }
  const n = noiseSrc(r, t, 0.04);
  const hp = r.ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = stroke === "tom" ? 1800 : 3200;
  const ng = envGain(r, t, (stroke === "tom" ? 0.06 : 0.14) * vel, 0.0005, 0.03);
  n.connect(hp).connect(ng).connect(r.out);
}

/** A soft drone on the tonic and fifth, under the whole tune. */
export function drone(r: Rig, t: number, midis: number[], dur: number, vel = 1) {
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1100;
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.05 * vel, t + dur * 0.3);
  g.gain.setValueAtTime(0.05 * vel, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  for (const m of midis) {
    osc(r, "sine", mtof(m), t, t + dur + 0.05).connect(lp);
    const o = osc(r, "triangle", mtof(m) * 2, t, t + dur + 0.05);
    o.detune.value = 4;
    const og = r.ctx.createGain();
    og.gain.value = 0.25;
    o.connect(og).connect(lp);
  }
  lp.connect(g).connect(r.out);
}

// ── More instruments (Island Breeze, Neon Drive, Sakura Garden, Midnight Jazz,
// Space Drift and Bandar Party) ────────────────────────────────────────────────

/** Steel pan: a round sine, a hollow octave and a quick bright knock on top. */
export function steelPan(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const len = Math.min(1.4, 0.45 + dur);
  const g = envGain(r, t, 0.15 * vel, 0.006, len);
  osc(r, "sine", f, t, t + len + 0.1).connect(g);
  const p = envGain(r, t, 0.06 * vel, 0.004, len * 0.5);
  osc(r, "sine", f * 2, t, t + len).connect(p).connect(r.out);
  const p2 = envGain(r, t, 0.035 * vel, 0.002, 0.16);
  osc(r, "sine", f * 3.02, t, t + 0.3).connect(p2).connect(r.out);
  g.connect(r.out);
}

/** Synthwave lead: two detuned saws, a filter that blooms on each note, a little vibrato. */
export function synthLead(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const len = dur + 0.12;
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(700, t);
  lp.frequency.exponentialRampToValueAtTime(3600, t + 0.06);
  lp.frequency.exponentialRampToValueAtTime(1300, t + len);
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.055 * vel, t + 0.012);
  g.gain.setValueAtTime(0.05 * vel, t + len * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  for (const cents of [-9, 9]) {
    const o = osc(r, "sawtooth", f, t, t + len + 0.05);
    o.detune.value = cents;
    if (dur > 0.25) {
      const lfo = osc(r, "sine", 5.5, t + 0.15, t + len + 0.05);
      const depth = r.ctx.createGain();
      depth.gain.value = f * 0.006;
      lfo.connect(depth).connect(o.frequency);
    }
    o.connect(lp);
  }
  lp.connect(g).connect(r.out);
}

/** Koto: a plucked silk string with a little pitch settle and a pick click. */
export function koto(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const len = Math.min(1.8, 0.5 + dur * 1.3);
  const o = osc(r, "triangle", f * 1.012, t, t + len + 0.05);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(11000, f * 9), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(500, f * 2), t + len);
  const g = envGain(r, t, 0.2 * vel, 0.002, len);
  o.connect(lp).connect(g).connect(r.out);
  const n = noiseSrc(r, t, 0.02);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(8000, f * 5);
  bp.Q.value = 2;
  const ng = envGain(r, t, 0.05 * vel, 0.0005, 0.012);
  n.connect(bp).connect(ng).connect(r.out);
}

/** Taiko: a big, soft boom. */
export function taiko(r: Rig, t: number, vel = 1) {
  const o = osc(r, "sine", 92, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(46, t + 0.3);
  const g = envGain(r, t, 0.8 * vel, 0.006, 0.55);
  o.connect(g).connect(r.out);
  const n = noiseSrc(r, t, 0.12);
  const lp = r.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const ng = envGain(r, t, 0.25 * vel, 0.003, 0.1);
  n.connect(lp).connect(ng).connect(r.out);
}

/** Jazz brush on the snare: a soft swish rather than a crack. */
export function brush(r: Rig, t: number, vel = 1) {
  const n = noiseSrc(r, t, 0.2);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  bp.Q.value = 0.7;
  const g = envGain(r, t, 0.12 * vel, 0.02, 0.14);
  n.connect(bp).connect(g).connect(r.out);
}

/** Ride cymbal: a quiet ping that hangs in the air. */
export function ride(r: Rig, t: number, vel = 1) {
  const n = noiseSrc(r, t, 0.6);
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 8200;
  bp.Q.value = 1.6;
  const g = envGain(r, t, 0.09 * vel, 0.001, 0.5);
  n.connect(bp).connect(g).connect(r.out);
  const ping = envGain(r, t, 0.012 * vel, 0.001, 0.4);
  osc(r, "sine", 5100, t, t + 0.5).connect(ping).connect(r.out);
}

/** The bandari keyboard: a reedy organ with a quick scoop and a wide, singing vibrato. */
export function organ(r: Rig, t: number, midi: number, dur: number, vel = 1) {
  const f = mtof(midi);
  const len = dur + 0.06;
  const bp = r.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = Math.min(6000, f * 3);
  bp.Q.value = 0.8;
  const g = r.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.01);
  g.gain.setValueAtTime(0.08 * vel, t + len * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const lfo = osc(r, "sine", 6.5, t, t + len + 0.05);
  const depth = r.ctx.createGain();
  depth.gain.value = f * 0.011;
  for (const [type, mul] of [["square", 1], ["sawtooth", 2]] as const) {
    const o = osc(r, type, f * mul * 0.97, t, t + len + 0.05);
    o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.03);
    lfo.connect(depth).connect(o.frequency);
    const og = r.ctx.createGain();
    og.gain.value = mul === 1 ? 1 : 0.35;
    o.connect(og).connect(bp);
  }
  bp.connect(g).connect(r.out);
}
