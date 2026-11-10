// Ambient sounds for the room: a crackling fire, ocean waves, wind and rain.
// They are made live with the Web Audio API from filtered noise, so no sound
// files are needed and they never loop audibly.

export type SoundKind = "fire" | "ocean" | "wind" | "rain";
export const SOUND_NAMES: Record<SoundKind, string> = {
  fire: "Crackling fire",
  ocean: "Ocean waves",
  wind: "Wind",
  rain: "Rain",
};

let ctx: AudioContext | null = null;
/** True while a game or full-screen app is open: everything stays silent. */
let resting = false;

const shouldPlay = () => !document.hidden && !resting;

/** Go silent (or come back) while something full-screen is open. */
export function setResting(on: boolean): void {
  resting = on;
  if (!ctx) return;
  if (shouldPlay()) void ctx.resume();
  else void ctx.suspend();
}
let noise: AudioBuffer | null = null;

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    // Ten seconds of white noise, reused by every sound.
    noise = ctx.createBuffer(1, ctx.sampleRate * 10, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // When every room window is hidden (Pause in the tray), stay quiet.
    document.addEventListener("visibilitychange", () => {
      if (shouldPlay()) void ctx?.resume();
      else void ctx?.suspend();
    });
  }
  if (ctx.state === "suspended" && shouldPlay()) void ctx.resume();
  return ctx;
}

function noiseSource(c: AudioContext): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.loopStart = Math.random() * 5;
  return src;
}

/** A slow wobble (0..1 around `base`) applied to an audio parameter. */
function wobble(c: AudioContext, param: AudioParam, base: number, depth: number, seconds: number): AudioScheduledSourceNode {
  const lfo = c.createOscillator();
  lfo.frequency.value = 1 / seconds;
  const amount = c.createGain();
  amount.gain.value = depth;
  param.value = base;
  lfo.connect(amount).connect(param);
  lfo.start();
  return lfo;
}

type Playing = { kind: SoundKind; out: GainNode; stop: () => void };

function build(kind: SoundKind, c: AudioContext, out: GainNode): () => void {
  const sources: AudioScheduledSourceNode[] = [];
  const timers: number[] = [];
  const src = noiseSource(c);
  sources.push(src);

  if (kind === "ocean") {
    // Deep rumble that swells and fades like waves, plus a hiss at each crest.
    const low = c.createBiquadFilter();
    low.type = "lowpass";
    sources.push(wobble(c, low.frequency, 500, 350, 9));
    const swell = c.createGain();
    sources.push(wobble(c, swell.gain, 0.55, 0.45, 9));
    src.connect(low).connect(swell).connect(out);
    const hissSrc = noiseSource(c);
    sources.push(hissSrc);
    const hiss = c.createBiquadFilter();
    hiss.type = "highpass";
    hiss.frequency.value = 2500;
    const hissGain = c.createGain();
    sources.push(wobble(c, hissGain.gain, 0.08, 0.08, 9));
    hissSrc.connect(hiss).connect(hissGain).connect(out);
    hissSrc.start();
  } else if (kind === "wind") {
    // A whistling band of noise that drifts in pitch and strength.
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    sources.push(wobble(c, band.frequency, 420, 260, 13));
    const gust = c.createGain();
    sources.push(wobble(c, gust.gain, 0.6, 0.4, 7));
    src.connect(band).connect(gust).connect(out);
  } else if (kind === "rain") {
    const high = c.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 900;
    const soft = c.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 7000;
    const g = c.createGain();
    g.gain.value = 0.35;
    src.connect(high).connect(soft).connect(g).connect(out);
  } else {
    // Fire: a low roar, plus random crackles and pops.
    const low = c.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 260;
    const roar = c.createGain();
    sources.push(wobble(c, roar.gain, 0.5, 0.15, 3));
    src.connect(low).connect(roar).connect(out);
    const crackle = () => {
      const now = c.currentTime;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const t = now + i * (0.01 + Math.random() * 0.04);
        const s = c.createBufferSource();
        s.buffer = noise;
        const f = c.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 1500 + Math.random() * 4500;
        f.Q.value = 0.8;
        const g = c.createGain();
        const peak = 0.15 + Math.random() * 0.5;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.06);
        s.connect(f).connect(g).connect(out);
        s.start(t, Math.random() * 9, 0.12);
      }
      timers.push(window.setTimeout(crackle, 40 + Math.random() * (Math.random() < 0.2 ? 900 : 260)));
    };
    crackle();
  }
  src.start();
  return () => {
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    timers.forEach((t) => window.clearTimeout(t));
    out.disconnect();
  };
}

const playing = new Map<string, Playing>();

/** Make the sounds playing match `wanted` (item id → sound and volume 0–1). */
export function syncSounds(wanted: Map<string, { kind: SoundKind; volume: number }>): void {
  for (const [id, p] of playing) {
    const w = wanted.get(id);
    if (!w || w.kind !== p.kind) {
      const out = p.out;
      const stop = p.stop;
      out.gain.setTargetAtTime(0, out.context.currentTime, 0.2);
      window.setTimeout(stop, 800);
      playing.delete(id);
    }
  }
  if (wanted.size === 0) return;
  const c = audio();
  for (const [id, w] of wanted) {
    let p = playing.get(id);
    if (!p) {
      const out = c.createGain();
      out.gain.value = 0;
      out.connect(c.destination);
      p = { kind: w.kind, out, stop: build(w.kind, c, out) };
      playing.set(id, p);
    }
    // Fade to the new volume instead of jumping.
    p.out.gain.setTargetAtTime(Math.max(0, Math.min(1, w.volume)) * 0.5, c.currentTime, 0.4);
  }
}
