// Things to put in the room besides files: notes, stickers, pictures, a clock,
// a whiteboard, a mirror, and a plant, a rose and an apple that change with
// real time.
//
// Everything here is drawn with plain HTML and SVG so it bends into the room's
// perspective together with its surface.

export type DecorKind =
  | "note" | "sticker" | "image" | "clock" | "plant" | "rose" | "apple" | "whiteboard" | "mirror"
  | "recycle" | "thermometer" | "hygrometer" | "map" | "window" | "fireplace" | "tv";

export const DECOR_KINDS: DecorKind[] = [
  "note", "sticker", "image", "clock", "plant", "rose", "apple", "whiteboard", "mirror",
  "recycle", "thermometer", "hygrometer", "map", "window", "fireplace", "tv",
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
  recycle: 0.13,
  thermometer: 0.08,
  hygrometer: 0.14,
  map: 0.4,
  window: 0.42,
  fireplace: 0.42,
  tv: 0.5,
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

// ---------- Digital clock ----------

export const DIGITAL_CLOCK_HTML = '<div class="digiclock"><div class="dtime"></div><div class="ddate"></div></div>';

export function tickDigital(root: ParentNode, date = new Date()): void {
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const day = date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  root.querySelectorAll<HTMLElement>(".digiclock").forEach((c) => {
    const t = c.querySelector(".dtime") as HTMLElement;
    const d = c.querySelector(".ddate") as HTMLElement;
    if (t.textContent !== time) t.textContent = time;
    if (d.textContent !== day) d.textContent = day;
  });
}

// ---------- Recycle bin ----------

/** A mesh waste basket, with crumpled paper in it when the bin has something. */
export function recycleSvg(items: number): string {
  const fill = Math.min(1, items / 40);
  const papers =
    items > 0
      ? [
          [34, 30, 11, "#f4f1ea"],
          [52, 26, 12, "#e9eef5"],
          [66, 32, 10, "#f4f1ea"],
          [44, 20, 9, "#fff7d6"],
          [60, 16, 9, "#f4f1ea"],
        ]
          .slice(0, 2 + Math.round(fill * 3))
          .map(([x, y, r, c]) => `<path d="M${Number(x) - Number(r)} ${y} q ${Number(r) * 0.4} ${-Number(r)} ${r} ${-Number(r) * 0.8} q ${Number(r) * 0.8} ${-Number(r) * 0.2} ${r} ${r} q ${-Number(r) * 0.2} ${Number(r) * 0.9} ${-r} ${Number(r) * 0.8} q ${-Number(r) * 0.8} 0 ${-r} ${-r}z" fill="${c}" stroke="#c9c4b8" stroke-width="1"/>`)
          .join("")
      : "";
  return `<svg viewBox="0 0 100 110" xmlns="http://www.w3.org/2000/svg">
    <ellipse cx="50" cy="104" rx="30" ry="4" fill="rgba(0,0,0,.25)"/>
    ${papers}
    <path d="M14 30h72l-8 70a5 5 0 0 1-5 4H27a5 5 0 0 1-5-4z" fill="rgba(170,190,205,.55)" stroke="#8fa6b8" stroke-width="2"/>
    <g stroke="#8fa6b8" stroke-width="1.4" opacity=".9">${Array.from({ length: 9 }, (_, i) => `<path d="M${22 + i * 7} 31 L${27 + i * 5.8} 103"/>`).join("")}
    <path d="M17 52h66M19 74h62M21 94h58"/></g>
    <rect x="11" y="26" width="78" height="7" rx="3" fill="#dfe8ef" stroke="#8fa6b8" stroke-width="1.5"/>
  </svg>`;
}

// ---------- Weather sensors ----------

/** A wall thermometer. `c` = degrees Celsius (null while unknown). */
export function thermometerSvg(c: number | null, label: string): string {
  // The scale runs from -30 °C to 50 °C.
  const t = c === null ? 0 : Math.max(0, Math.min(1, (c + 30) / 80));
  const top = 150 - t * 120;
  const ticks = Array.from({ length: 9 }, (_, i) => {
    const y = 150 - i * 15;
    return `<path d="M36 ${y}h${i % 2 ? 5 : 8}" stroke="#555" stroke-width="1"/>` +
      (i % 2 ? "" : `<text x="47" y="${y + 3}" font-size="8" fill="#444" font-family="Segoe UI, sans-serif">${-30 + i * 10}</text>`);
  }).join("");
  return `<svg viewBox="0 0 70 200" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="4" width="62" height="192" rx="31" fill="#f7f5f0" stroke="#c9c4b8" stroke-width="2"/>
    ${ticks}
    <rect x="24" y="22" width="10" height="140" rx="5" fill="#e6e2da" stroke="#bbb" stroke-width="1"/>
    ${c === null ? "" : `<rect x="26.5" y="${top}" width="5" height="${165 - top}" rx="2.5" fill="#d6283a"/>`}
    <circle cx="29" cy="168" r="11" fill="${c === null ? "#bbb" : "#d6283a"}" stroke="#bbb" stroke-width="1"/>
    <text x="35" y="190" font-size="9" text-anchor="middle" fill="#555" font-family="Segoe UI, sans-serif">${escapeHtml(label)}</text>
  </svg>`;
}

/** A round dial hygrometer. `h` = relative humidity in percent (null while unknown). */
export function hygrometerSvg(h: number | null, label: string): string {
  const a = -120 + ((h ?? 0) / 100) * 240;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const ang = ((-120 + i * 24) * Math.PI) / 180;
    const r1 = 38;
    const r2 = i % 5 ? 34 : 31;
    return `<path d="M${50 + Math.sin(ang) * r1} ${50 - Math.cos(ang) * r1}L${50 + Math.sin(ang) * r2} ${50 - Math.cos(ang) * r2}" stroke="#444" stroke-width="${i % 5 ? 1 : 1.8}"/>`;
  }).join("");
  const arc = (from: number, to: number, color: string) => {
    const p = (d: number) => `${50 + Math.sin((d * Math.PI) / 180) * 41} ${50 - Math.cos((d * Math.PI) / 180) * 41}`;
    return `<path d="M${p(from)} A41 41 0 0 1 ${p(to)}" stroke="${color}" stroke-width="4" fill="none"/>`;
  };
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="48" fill="#b8964f"/>
    <circle cx="50" cy="50" r="44" fill="#f7f5f0"/>
    ${arc(-120, -48, "#e8a33d")}${arc(-48, 48, "#4caf7a")}${arc(48, 120, "#4c8fd6")}
    ${ticks}
    <text x="50" y="34" font-size="7" text-anchor="middle" fill="#666" font-family="Segoe UI, sans-serif">HUMIDITY %</text>
    <text x="50" y="74" font-size="11" font-weight="600" text-anchor="middle" fill="#333" font-family="Segoe UI, sans-serif">${h === null ? "—" : Math.round(h)}</text>
    <text x="50" y="86" font-size="6.5" text-anchor="middle" fill="#666" font-family="Segoe UI, sans-serif">${escapeHtml(label)}</text>
    ${h === null ? "" : `<path d="M50 50 L50 15" stroke="#222" stroke-width="2" stroke-linecap="round" transform="rotate(${a} 50 50)"/>`}
    <circle cx="50" cy="50" r="3.5" fill="#222"/>
  </svg>`;
}

/** What clicking an item does when the room is behind the desktop icons. */
export const CLICK_ACTION: Partial<Record<DecorKind, string>> = {
  note: "Click to write on it",
  whiteboard: "Click to draw on it",
  plant: "Click to water it",
  rose: "Click for a fresh rose",
  apple: "Click for a fresh apple",
  recycle: "Click to open the Recycle Bin",
  thermometer: "Click to choose the place",
  hygrometer: "Click to choose the place",
  map: "Click to move and zoom the map",
  window: "Click to change the view and the sound outside",
  fireplace: "Click to turn the fire sound on or off",
  tv: "Click to watch it big, change the channel or the sound",
};

export const FIREPLACE_HTML =
  '<div class="fireplace"><div class="mantel"></div><div class="fpbody"><div class="firebox">' +
  '<div class="glow"></div><div class="flames"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
  '<div class="logs"><b></b><b></b></div><div class="embers"><s></s><s></s><s></s></div>' +
  '</div></div><div class="fpbase"></div></div>';

/** The view from a new window until you choose a picture: the sea at dusk. */
export const SEA_VIEW = `<svg class="outside" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b4c7a"/><stop offset=".55" stop-color="#d98a7a"/><stop offset=".7" stop-color="#f6c890"/></linearGradient>
  <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6f98"/><stop offset="1" stop-color="#22304f"/></linearGradient></defs>
  <rect width="160" height="120" fill="url(#dusk)"/>
  <circle cx="104" cy="72" r="11" fill="#ffe2b0" opacity=".95"/>
  <path d="M0 70 30 62 52 67 80 60 112 68 136 63 160 69V80H0z" fill="#6b5f86" opacity=".7"/>
  <rect y="76" width="160" height="44" fill="url(#sea)"/>
  <path d="M96 78h16M92 84h24M98 90h12M88 97h32" stroke="#ffd9a0" stroke-width="1.2" opacity=".75"/>
  <path d="M8 88h30M50 95h24M120 104h30M20 108h40" stroke="#8ea3c8" stroke-width="1" opacity=".6"/>
</svg>`;
