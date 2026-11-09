// Things to put in the room besides files: notes, stickers, pictures, a clock,
// a whiteboard, a mirror, and a plant, a rose and an apple that change with
// real time.
//
// Everything here is drawn with plain HTML and SVG so it bends into the room's
// perspective together with its surface.

export type DecorKind =
  | "note" | "sticker" | "image" | "clock" | "plant" | "rose" | "apple" | "whiteboard" | "mirror";

export const DECOR_KINDS: DecorKind[] = [
  "note", "sticker", "image", "clock", "plant", "rose", "apple", "whiteboard", "mirror",
];

/** Size (fraction of the surface height) a new item starts at. */
export const DECOR_SIZE: Record<DecorKind, number> = {
  note: 0.2,
  sticker: 0.09,
  image: 0.28,
  clock: 0.16,
  plant: 0.22,
  rose: 0.11,
  apple: 0.08,
  whiteboard: 0.55,
  mirror: 0.26,
};

export const NOTE_COLORS = ["#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#fed7aa"];

export const STICKERS: Record<string, string> = {
  star: '<path d="M50 6l13 29 32 3-24 21 7 32-28-17-28 17 7-32L5 38l32-3z" fill="#ffd34d" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>',
  heart: '<path d="M50 88S8 62 8 34a21 21 0 0 1 42-6 21 21 0 0 1 42 6c0 28-42 54-42 54z" fill="#f25c78" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>',
  smile: '<circle cx="50" cy="50" r="42" fill="#ffcf3f" stroke="#fff" stroke-width="6"/><circle cx="36" cy="40" r="5" fill="#5a3b12"/><circle cx="64" cy="40" r="5" fill="#5a3b12"/><path d="M30 58q20 22 40 0" stroke="#5a3b12" stroke-width="6" fill="none" stroke-linecap="round"/>',
  check: '<circle cx="50" cy="50" r="42" fill="#34c37a" stroke="#fff" stroke-width="6"/><path d="M30 52l13 13 27-29" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<g stroke="#ffb020" stroke-width="7" stroke-linecap="round"><path d="M50 4v12M50 84v12M4 50h12M84 50h12M17 17l9 9M74 74l9 9M17 83l9-9M74 26l9-9"/></g><circle cx="50" cy="50" r="24" fill="#ffd34d" stroke="#fff" stroke-width="5"/>',
  bolt: '<path d="M58 4L18 56h26l-6 40 42-56H52z" fill="#7c6cff" stroke="#fff" stroke-width="6" stroke-linejoin="round"/>',
};

const DAY = 24 * 60 * 60 * 1000;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Blend two #rrggbb colours. */
export function mix(a: string, b: string, t: number): string {
  t = clamp01(t);
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export const daysSince = (time: number | undefined, now: number) =>
  Math.max(0, (now - (time ?? now)) / DAY);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---------- Plant: grows over two weeks, droops when it hasn't been watered ----------

/** `age` = days since planted, `thirst` = days since last watered. */
export function plantSvg(age: number, thirst: number): string {
  const grown = clamp01(age / 14);
  // Fine for 3 days without water, then it droops and yellows; after 8 days it is brown.
  const dry = clamp01((thirst - 3) / 5);
  const n = 3 + Math.floor(grown * 7);
  const h = 16 + grown * 52;
  let leaves = "";
  for (let i = 0; i < n; i++) {
    const y = 64 - (i + 1) * (h / (n + 1));
    const side = i % 2 ? 1 : -1;
    const len = 12 + Math.min(i, 5) * 2.6 * (0.6 + grown * 0.4);
    const droop = dry * 28 * side;
    const col = mix(mix("#86cf86", "#3f8f5a", i / n), mix("#c9b458", "#8a6a3a", dry), dry);
    leaves +=
      `<g transform="rotate(${droop} 40 ${y + 4})"><path d="M40 ${y + 4} q ${side * len * 0.6} ${-len * 0.55} ${side * len} ${-len * 0.15} ` +
      `q ${-side * len * 0.45} ${len * 0.45} ${-side * len} ${len * 0.15}" fill="${col}" stroke="${mix("#2c6b42", "#6b5a2a", dry)}" stroke-width=".8"/></g>`;
  }
  const stem = mix("#2f7a45", "#7a6a3a", dry);
  const soil = mix("#4a2f1c", "#8a6a4a", clamp01(thirst / 6));
  return `<svg viewBox="0 0 80 110" xmlns="http://www.w3.org/2000/svg">
    <path d="M40 66 Q ${40 + dry * 6} ${66 - h / 2} ${40 + dry * 10} ${64 - h}" stroke="${stem}" stroke-width="2.4" fill="none"/>${leaves}
    <path d="M18 64h44l-6 42a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="#c4683f"/>
    <rect x="15" y="60" width="50" height="9" rx="2" fill="#d97a4f"/>
    <ellipse cx="40" cy="62" rx="20" ry="2.5" fill="${soil}"/>
    <g class="drops" fill="#6fb8ff"><path d="M30 20q3 5 0 8q-3-3 0-8z"/><path d="M44 10q3 5 0 8q-3-3 0-8z"/><path d="M52 26q3 5 0 8q-3-3 0-8z"/></g>
  </svg>`;
}

// ---------- Rose: a bud for ~3 days, full bloom until ~day 7, wilts until ~day 10, dry by ~day 14 ----------

export function roseSvg(d: number): string {
  const open = clamp01(d / 3);
  const wilt = clamp01((d - 7) / 3);
  const dry = clamp01((d - 10) / 4);
  const petal = mix(mix("#e0284a", "#8f2c3a", wilt), "#6b4a3a", dry);
  const r = (4 + open * 6) * (1 - wilt * 0.12 - dry * 0.2);
  const droop = wilt * 40 + dry * 25;
  const leaf = mix(mix("#3f8f5a", "#7a7a3a", wilt), "#6e5a34", dry);
  const stem = mix(mix("#2f7a45", "#6b6a3a", wilt), "#6e5a34", dry);
  const headX = 30 + droop * 0.3;
  const headY = 30 + droop * 0.12;
  let fallen = "";
  const lost = Math.floor(clamp01((d - 8) / 5) * 6);
  for (let i = 0; i < lost; i++) {
    const x = 12 + i * 7;
    fallen += `<ellipse cx="${x}" cy="${117 - (i % 2) * 1.5}" rx="3.2" ry="1.6" fill="${petal}" transform="rotate(${i * 37} ${x} 117)"/>`;
  }
  const count = 5 - Math.min(3, Math.floor(lost / 2));
  const petals =
    open < 0.35
      ? `<path d="M30 ${-r * 1.6} c ${r} ${r * 0.6} ${r} ${r * 1.4} 0 ${r * 1.8} c ${-r} ${-r * 0.4} ${-r} ${-r * 1.2} 0 ${-r * 1.8}z" fill="${petal}"/>` +
        `<path d="M30 ${r * 0.2} q -5 4 -7 -2 M30 ${r * 0.2} q 5 4 7 -2" stroke="${leaf}" stroke-width="2" fill="none"/>`
      : Array.from({ length: count }, (_, i) => {
          const a = (360 / count) * i;
          return `<ellipse cx="30" cy="${-r * 0.6}" rx="${r * 0.62}" ry="${r * 0.9}" fill="${petal}" transform="rotate(${a} 30 0)" opacity=".95"/>`;
        }).join("") + `<circle cx="30" cy="0" r="${r * 0.45}" fill="${mix(petal, "#000000", 0.25)}"/>`;
  return `<svg viewBox="0 0 60 120" xmlns="http://www.w3.org/2000/svg">
    <path d="M30 92 Q ${30 + droop * 0.15} 55 ${headX} ${headY}" stroke="${stem}" stroke-width="2" fill="none"/>
    <path d="M30 70 q -10 -6 -14 -2 q 6 6 14 2" fill="${leaf}"/><path d="M31 58 q 10 -6 14 -2 q -6 6 -14 2" fill="${leaf}"/>
    <g transform="translate(${headX - 30} ${headY}) rotate(${droop} 30 0) translate(0 -2)">${petals}</g>
    <path d="M18 86h24l-2 30a3 3 0 0 1-3 3H23a3 3 0 0 1-3-3z" fill="rgba(200,225,240,.45)" stroke="rgba(255,255,255,.7)" stroke-width="1"/>
    <rect x="20" y="100" width="20" height="16" fill="rgba(120,170,200,${0.35 - dry * 0.25})"/>${fallen}
  </svg>`;
}

// ---------- Apple: red and shiny, fully brown by day 7, then shrivels ----------

export function appleSvg(d: number): string {
  const brown = clamp01(d / 7);
  const shrivel = clamp01((d - 6) / 7);
  const body = mix(mix("#d6283a", "#a8552e", clamp01(d / 4)), "#6e4a2c", clamp01((d - 3) / 4));
  const sc = 1 - shrivel * 0.18;
  const shine = Math.max(0, 0.55 - brown * 0.6);
  let spots = "";
  const n = Math.floor(clamp01((d - 1.5) / 5) * 9);
  for (let i = 0; i < n; i++) {
    spots += `<circle cx="${18 + ((i * 13) % 26)}" cy="${26 + ((i * 7) % 18)}" r="${1.5 + (i % 3) + brown * 1.5}" fill="#4a2e18" opacity=".55"/>`;
  }
  const wrinkles =
    shrivel > 0.1
      ? `<path d="M16 34 q 6 -3 10 1 M32 40 q 5 -4 9 0 M20 46 q 6 -2 12 1 M26 28 q 4 -3 8 0" stroke="#3a2416" stroke-width=".9" fill="none" opacity="${shrivel}"/>`
      : "";
  return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="30" cy="57" rx="16" ry="2.5" fill="rgba(0,0,0,.25)"/>
    <g transform="translate(30 56) scale(${sc}) translate(-30 -56)">
      <path d="M30 18 c -6 -6 -22 -6 -22 12 c 0 16 10 26 16 26 c 3 0 4 -1.5 6 -1.5 s 3 1.5 6 1.5 c 6 0 16 -10 16 -26 c 0 -18 -16 -18 -22 -12z" fill="${body}"/>
      <ellipse cx="20" cy="27" rx="4" ry="7" fill="#fff" opacity="${shine}" transform="rotate(20 20 27)"/>${spots}${wrinkles}
      <path d="M30 18 q 1 -6 4 -9" stroke="#5a3a20" stroke-width="2" fill="none"/>
      <path d="M33 11 q 8 -6 13 -1 q -7 5 -13 1" fill="${mix("#4caf50", "#7a6a38", brown)}"/>
    </g>
  </svg>`;
}

export function stickerSvg(glyph: string | undefined): string {
  const body = STICKERS[glyph ?? "star"] ?? STICKERS.star;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

export const CLOCK_HTML =
  '<div class="clockface">' +
  Array.from({ length: 12 }, (_, i) => `<i style="transform:rotate(${i * 30}deg)"></i>`).join("") +
  '<b class="hh"></b><b class="mh"></b><b class="sh"></b><span class="pin"></span></div>';

/** Turn the hands of every clock on the page to the current time. */
export function tickClocks(root: ParentNode, date = new Date()): void {
  const s = date.getSeconds();
  const m = date.getMinutes() + s / 60;
  const h = (date.getHours() % 12) + m / 60;
  root.querySelectorAll<HTMLElement>(".clockface").forEach((c) => {
    (c.querySelector(".hh") as HTMLElement).style.transform = `rotate(${h * 30}deg)`;
    (c.querySelector(".mh") as HTMLElement).style.transform = `rotate(${m * 6}deg)`;
    (c.querySelector(".sh") as HTMLElement).style.transform = `rotate(${s * 6}deg)`;
  });
}

/** What clicking an item does when the room is behind the desktop icons. */
export const CLICK_ACTION: Partial<Record<DecorKind, string>> = {
  note: "Click to write on it",
  whiteboard: "Click to draw on it",
  plant: "Click to water it",
  rose: "Click for a fresh rose",
  apple: "Click for a fresh apple",
};
