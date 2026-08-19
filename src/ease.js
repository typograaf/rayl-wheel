/**
 * The three curves, and how to read one.
 *
 * The long tool draws a bezier with two handles you can drag and four numbers
 * you can type. The short panel does not: it offers three curves as three
 * buttons, which is the design's answer to the same question and the right one
 * for a tool that is deciding how a wheel turns rather than authoring an
 * easing. The numbers are the same control points either way, so a look found
 * here transfers to the long tool as it stands.
 */

/* Straight off the short panel — the control points of a curve from (0,0) to
   (1,1). */
export const CURVES = {
  "In & Out": [0.8, 0, 0.2, 1],
  "Out & In": [0, 0.8, 1, 0.2],
  Linear: [0, 0, 1, 1],
};

export const CURVE_NAMES = Object.keys(CURVES);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function coefficients([x1, y1, x2, y2]) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return { ax, bx, cx, ay, by, cy };
}

/**
 * The curve is parametric, so the x you have is not the t it is drawn by: the y
 * has to be found by solving for t first. Newton gets there in two or three
 * steps wherever the curve is steep, and a deep ease is flat at both ends where
 * the derivative says nothing useful — so a bisection finishes those.
 */
export function easeAt(u, points) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const { ax, bx, cx, ay, by, cy } = coefficients(points);
  const x = (t) => ((ax * t + bx) * t + cx) * t;
  const y = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;

  let t = u;
  for (let i = 0; i < 8; i++) {
    const err = x(t) - u;
    if (Math.abs(err) < 1e-6) return y(t);
    const slope = dx(t);
    if (Math.abs(slope) < 1e-6) break;
    t = clamp(t - err / slope, 0, 1);
  }
  let lo = 0;
  let hi = 1;
  t = u;
  for (let i = 0; i < 24; i++) {
    const at = x(t);
    if (Math.abs(at - u) < 1e-6) break;
    if (u > at) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return y(t);
}

/**
 * How far through its travel the wheel is, at this instant of the loop.
 *
 * Cycling, the phase runs once through the curve and the wheel arrives a whole
 * travel further on — which is where it started, since the list wraps. Ping-pong
 * eases out over the first half and back over the second, so both ends of the
 * loop are the same standing still and there is no seam to hide.
 */
export function loopAt(phase, curve, pong) {
  const u = ((phase % 1) + 1) % 1;
  if (!pong) return easeAt(u, curve);
  return u < 0.5 ? easeAt(u * 2, curve) : 1 - easeAt((u - 0.5) * 2, curve);
}
