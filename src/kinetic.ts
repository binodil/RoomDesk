// The kinetic clock: a wall of 12 × 6 small clocks. For most of each minute
// their hands line up to draw the time in big digits. Then, a little before
// the minute changes, they all start turning together through a couple of
// patterns and settle on the next minute exactly as it begins.
//
// Every hand's angle is worked out from the time alone, so all kinetic clocks
// in the room (and on every monitor) move in step, and nothing needs saving.

const COLS = 12;
const ROWS = 6;
const HANDS = COLS * ROWS * 2;

export const KINETIC_CLOCK_HTML =
  '<div class="kinetic">' +
  Array.from({ length: COLS * ROWS }, () => "<span><b></b><b></b></span>").join("") +
  "</div>";

// ---------- The digits ----------
// Each digit is 3 clocks wide and 6 tall. Each clock is two letters, one per
// hand: u, r, d, l point up, right, down, left; x is a resting hand (7:30).
// The hands trace the outline of a thick digit.
const DIGITS: string[][] = [
  ["rd lr ld", "ud dd ud", "ud ud ud", "ud ud ud", "ud uu ud", "ur lr ul"], // 0
  ["xx rd ld", "xx ud ud", "xx ud ud", "xx ud ud", "xx ud ud", "xx ur ul"], // 1
  ["rd lr ld", "ur ld ud", "rd ul ud", "ud rd ul", "ud ur ld", "ur lr ul"], // 2
  ["rd lr ld", "ur ld ud", "rd ul ud", "ur ld ud", "rd ul ud", "ur lr ul"], // 3
  ["rd dd ld", "ud ud ud", "ud uu ud", "ur ld ud", "xx ud ud", "xx ur ul"], // 4
  ["rd lr ld", "ud rd ul", "ud ur ld", "ur ld ud", "rd ul ud", "ur lr ul"], // 5
  ["rd lr ld", "ud rd ul", "ud ur ld", "ud dd ud", "ud uu ud", "ur lr ul"], // 6
  ["rd lr ld", "ur ld ud", "xx ud ud", "xx ud ud", "xx ud ud", "xx ur ul"], // 7
  ["rd lr ld", "ud dd ud", "ud uu ud", "ud dd ud", "ud uu ud", "ur lr ul"], // 8
  ["rd lr ld", "ud dd ud", "ud uu ud", "ur ld ud", "rd ul ud", "ur lr ul"], // 9
];
const BLANK = Array.from({ length: ROWS }, () => "xx xx xx");
const DIR: Record<string, number> = { u: 0, r: 90, d: 180, l: 270, x: 225 };

/** Hand angles (degrees, clockwise from 12) that spell out a time like "0945". */
function timePose(digits: (number | null)[]): number[] {
  const out = new Array<number>(HANDS);
  digits.forEach((d, i) => {
    const glyph = d === null ? BLANK : DIGITS[d];
    for (let r = 0; r < ROWS; r++) {
      const cells = glyph[r].split(" ");
      for (let c = 0; c < 3; c++) {
        const k = (r * COLS + i * 3 + c) * 2;
        out[k] = DIR[cells[c][0]];
        out[k + 1] = DIR[cells[c][1]];
      }
    }
  });
  return out;
}

const twelveHour = (() => {
  try {
    const hc = new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions().hourCycle;
    return hc === "h11" || hc === "h12";
  } catch {
    return false;
  }
})();

function digitsFor(date: Date): (number | null)[] {
  let h = date.getHours();
  if (twelveHour) h = h % 12 || 12;
  const m = date.getMinutes();
  return [h >= 10 ? Math.floor(h / 10) : twelveHour ? null : 0, h % 10, Math.floor(m / 10), m % 10];
}

// ---------- Patterns the clocks pass through between minutes ----------

type Pose = (c: number, r: number) => [number, number];
const cx = (COLS - 1) / 2;
const cy = (ROWS - 1) / 2;
const toCentre = (c: number, r: number) => (Math.atan2(c - cx, cy - r) * 180) / Math.PI;

const PATTERNS: Pose[] = [
  () => [45, 225], // diagonal lines across the whole wall
  (c) => [c * 30, c * 30 + 180], // a twisting ribbon
  (c, r) => [toCentre(c, r), toCentre(c, r) + 180], // rays from the middle
  () => [0, 180], // tall stripes
  (c, r) => [toCentre(c, r) + 90, toCentre(c, r) + 270], // a whirlpool
  (c, r) => [(c + r) * 45, (c + r) * 45 + 90], // a woven grid of corners
  () => [90, 270], // flat lines
  (c, r) => [r * 60 + c * 15, r * 60 + c * 15 + 180], // waves
];

function patternPose(p: Pose): number[] {
  const out = new Array<number>(HANDS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const [a, b] = p(c, r);
      const k = (r * COLS + c) * 2;
      out[k] = a;
      out[k + 1] = b;
    }
  }
  return out;
}

/** How long (ms) each clock waits before it starts moving in a step: a sweep across the wall. */
type Sweep = (c: number, r: number) => number; // 0..1
const SWEEPS: Sweep[] = [
  (c) => c / (COLS - 1),
  (c) => 1 - c / (COLS - 1),
  (_c, r) => r / (ROWS - 1),
  (c, r) => Math.hypot(c - cx, r - cy) / Math.hypot(cx, cy),
  (c, r) => (c + r) / (COLS + ROWS - 2),
  () => 0,
];

// ---------- One minute ----------
// 0–40 s: the time. 40–46 s and 46–52 s: two patterns. 52–60 s: the next time.

type Step = { at: number; len: number; to: number[]; sweep: Sweep; spread: number; spin: number; ccw: boolean };

const cache = new Map<number, { steps: Step[]; start: number[] }>();

function minutePlan(minuteStart: number): { steps: Step[]; start: number[] } {
  let plan = cache.get(minuteStart);
  if (plan) return plan;
  const n = Math.floor(minuteStart / 60000);
  const pick = <T,>(list: T[], salt: number) => list[(((n * 7 + salt * 13) % list.length) + list.length) % list.length];
  const now = timePose(digitsFor(new Date(minuteStart)));
  const next = timePose(digitsFor(new Date(minuteStart + 60000)));
  const p1 = patternPose(pick(PATTERNS, 1));
  const p2 = patternPose(pick(PATTERNS, 4 + (n % 3)));
  const steps: Step[] = [
    { at: 40000, len: 6000, to: p1, sweep: pick(SWEEPS, 2), spread: 1800, spin: 0, ccw: false },
    { at: 46000, len: 6000, to: p2, sweep: pick(SWEEPS, 3), spread: 1500, spin: 1, ccw: n % 2 === 0 },
    { at: 52000, len: 8000, to: next, sweep: pick(SWEEPS, 5), spread: 2500, spin: 1, ccw: false },
  ];
  plan = { steps, start: now };
  cache.set(minuteStart, plan);
  if (cache.size > 4) cache.delete(cache.keys().next().value as number);
  return plan;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mod = (a: number) => ((a % 360) + 360) % 360;

/** Every hand's angle at `time` (ms since 1970). */
function anglesAt(time: number): { angles: number[]; still: boolean } {
  const minuteStart = time - (time % 60000);
  const t = time - minuteStart;
  const { steps, start } = minutePlan(minuteStart);
  const angles = start.slice();
  let still = true;
  for (const s of steps) {
    if (t < s.at) break;
    const move = s.len - s.spread - 300;
    for (let k = 0; k < HANDS; k++) {
      const cell = k >> 1;
      const c = cell % COLS;
      const r = (cell - c) / COLS;
      const delay = s.sweep(c, r) * s.spread;
      const p = Math.max(0, Math.min(1, (t - s.at - delay) / move));
      if (p > 0 && p < 1) still = false;
      const from = angles[k];
      // The two hands of a clock turn opposite ways in some steps, like scissors.
      const back = s.ccw && k % 2 === 1;
      const delta = back ? -(mod(from - s.to[k]) + 360 * s.spin) : mod(s.to[k] - from) + 360 * s.spin;
      angles[k] = from + delta * ease(p);
    }
  }
  return { angles, still };
}

const handsOf = new WeakMap<HTMLElement, HTMLElement[]>();
let lastStill = -1;

/** Turn the hands of every kinetic clock under `root`. Cheap to call every frame. */
export function tickKinetic(root: ParentNode, time = Date.now(), force = false): void {
  const walls = root.querySelectorAll<HTMLElement>(".kinetic");
  if (walls.length === 0) return;
  const { angles, still } = anglesAt(time);
  // While the time just sits there, nothing needs redrawing (except new clocks).
  const second = Math.floor(time / 1000);
  const skip = still && !force && lastStill === second;
  lastStill = still ? second : -1;
  walls.forEach((wall) => {
    let hands = handsOf.get(wall);
    const fresh = !hands;
    if (!hands) {
      hands = Array.from(wall.querySelectorAll<HTMLElement>("b"));
      handsOf.set(wall, hands);
    }
    if (skip && !fresh) return;
    for (let k = 0; k < hands.length && k < HANDS; k++) hands[k].style.transform = `rotate(${angles[k].toFixed(2)}deg)`;
  });
}

/** Keep every kinetic clock under `root` moving smoothly, except while `paused()`. */
export function runKinetic(root: ParentNode, paused: () => boolean): void {
  const frame = () => {
    if (!paused()) tickKinetic(root);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
