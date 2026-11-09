// Perspective math: map a flat rectangle onto any four-cornered shape on screen.
//
// A "homography" is the 3×3 matrix that does this. CSS can apply it directly with
// `matrix3d(...)`, so any HTML element (a grid now, desktop items later) can be
// drawn so it looks like it lies on a wall or the floor of the room photo.

export type Point = { x: number; y: number };
/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Solve the 8×8 system A·h = b with Gaussian elimination (partial pivoting). */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * The homography that maps the rectangle (0,0)–(width,height) onto `quad`.
 * Returns [a, b, c, d, e, f, g, h, 1] (row by row), or null if the shape is degenerate.
 */
export function rectToQuad(width: number, height: number, quad: Quad): number[] | null {
  const src: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  const h = solve(A, B);
  return h ? [...h, 1] : null;
}

/** Apply a homography to a point. */
export function apply(h: number[], p: Point): Point {
  const [a, b, c, d, e, f, g, hh, i] = h;
  const w = g * p.x + hh * p.y + i;
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

/** The opposite mapping (screen → flat rectangle), or null if it can't be undone. */
export function invert(h: number[]): number[] | null {
  const [a, b, c, d, e, f, g, hh, i] = h;
  const A = e * i - f * hh;
  const B = -(d * i - f * g);
  const C = d * hh - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    A, -(b * i - c * hh), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * hh - b * g), a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

/** The CSS `matrix3d(...)` for a homography (use with `transform-origin: 0 0`). */
export function toMatrix3d(h: number[]): string {
  const [a, b, c, d, e, f, g, hh, i] = h;
  // CSS lists the 4×4 matrix column by column.
  const m = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, i];
  return `matrix3d(${m.map((n) => +n.toFixed(10)).join(",")})`;
}

/** True when the four corners form a proper (convex, not twisted) shape. */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
