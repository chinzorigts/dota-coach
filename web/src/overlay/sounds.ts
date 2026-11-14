// "Arcane" open/close sounds for the overlay, synthesized with Web Audio (no audio files to ship or license).
// Open: an air whoosh sweeping up into a metallic bell. Close: the sweep falling into a lower bell.
// Chosen from the sound drafts (Glass / Arcane / Tactile / Shimmer).

export type OverlaySound = "open" | "close";

/** The slider maps 0..1 onto this boost; peaks sit around -15 dBFS at gain 1, too quiet over game audio */
const GAIN = 2.2;
const REVERB = 0.3;

let ctx: AudioContext | null = null;
let master: GainNode;
let dry: GainNode;
let convolver: ConvolverNode;

function audio(): AudioContext {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }
  ctx = new AudioContext();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master = ctx.createGain();
  master.connect(comp).connect(ctx.destination);
  dry = ctx.createGain();
  dry.connect(master);
  // Small-room reverb from a decaying stereo noise impulse
  convolver = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 1.4);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  convolver.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = REVERB;
  convolver.connect(wet).connect(master);
  return ctx;
}

function tone(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number) {
  const now = c.currentTime + t;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.setValueAtTime(f, now);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(out);
  o.start(now);
  o.stop(now + dur + 0.05);
}

/** Inharmonic partials decaying at different rates read as metal rather than a pure tone */
function bell(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number) {
  for (const [m, a] of [[1, 1], [2.76, 0.35], [5.4, 0.12]]) tone(c, out, f * m, t, dur / Math.sqrt(m), gain * a);
}

function whoosh(c: AudioContext, out: AudioNode, dur: number, gain: number, f0: number, f1: number, attack: number) {
  const now = c.currentTime;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  const flt = c.createBiquadFilter();
  const g = c.createGain();
  src.buffer = buf;
  flt.type = "bandpass";
  flt.Q.value = 2.2;
  flt.frequency.setValueAtTime(f0, now);
  flt.frequency.exponentialRampToValueAtTime(f1, now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(flt).connect(g).connect(out);
  src.start(now);
  src.stop(now + dur + 0.02);
}

/** Plays the Arcane open/close sound. `volume` is 0..1. Never throws: a missing audio device just means silence. */
export function playOverlaySound(kind: OverlaySound, volume: number) {
  if (volume <= 0) return;
  try {
    const c = audio();
    master.gain.setValueAtTime(Math.min(1, volume) * GAIN, c.currentTime);
    const out = c.createGain();
    out.connect(dry);
    out.connect(convolver);
    if (kind === "open") {
      whoosh(c, out, 0.42, 0.09, 380, 3200, 0.18);
      bell(c, out, 880, 0.2, 1.4, 0.13);
      bell(c, out, 1320, 0.26, 1.2, 0.05);
    } else {
      whoosh(c, out, 0.36, 0.08, 3000, 420, 0.04);
      bell(c, out, 440, 0.12, 1.0, 0.13);
    }
  } catch (err) {
    console.warn("[overlay] sound failed:", err);
  }
}
