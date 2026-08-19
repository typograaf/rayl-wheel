/**
 * The slider track, as one shape.
 *
 * The design draws it as a single path: a rounded nub carrying the value, and a
 * 2px rail running out of it — not butted against it, *out* of it, through a
 * concave fillet on each side. That fillet is the whole character of the
 * control and it is the one thing a rail-plus-a-box in CSS cannot do, because
 * the join is a curve that belongs to neither piece.
 *
 * So the path is generated. Which turns out to be necessary anyway: the nub has
 * to grow with the number inside it, and it has to sit wherever the value is
 * rather than always at the head, and both change the shape rather than just
 * moving it.
 *
 *   nub      12 tall, radius 3, as wide as its number plus even padding
 *   rail     2 tall through the middle, radius 1 at each end
 *   fillet   radius 2, from the nub's corner out to the rail
 *
 * Numbers straight off node 469:1764's Union path.
 */

const W = 170;
const H = 12;
const NUB_R = 3;
const RAIL_TOP = 5;
const RAIL_BOTTOM = 7;
const FILLET = 2;
/* The cubic the design uses for each fillet, as offsets from the nub's corner.
   It is a quarter of a circle of radius 2, and hand-fitted rather than derived,
   so it is copied rather than recomputed. */
const BEND = [1.10457, 0.8954];

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * The whole track as one closed path, with the nub at `x` and `w` wide.
 *
 * Walked clockwise from the nub's top-left: across its top, out along the top of
 * the rail to the right, back along the bottom, round the nub's underside, out
 * to the left and back. Each rail only exists if there is room for it, so a nub
 * at either end closes on its own corner rather than growing a stub.
 */
function trackPath(x, w) {
  const right = x + w;
  const hasLeft = x > FILLET;
  const hasRight = right < W - FILLET;
  const d = [];

  d.push(`M${round(x + NUB_R)} 0`);
  d.push(`H${round(right - NUB_R)}`);
  d.push(`A${NUB_R} ${NUB_R} 0 0 1 ${round(right)} ${NUB_R}`);

  if (hasRight) {
    // out of the nub's shoulder and along the rail
    d.push(
      `C${round(right)} ${RAIL_TOP - BEND[0] + FILLET - 1},` +
        `${round(right + BEND[1])} ${RAIL_TOP},` +
        `${round(right + FILLET)} ${RAIL_TOP}`,
    );
    d.push(`H${W - 1}`);
    d.push(`A1 1 0 0 1 ${W - 1} ${RAIL_BOTTOM}`);
    d.push(`H${round(right + FILLET)}`);
    d.push(
      `C${round(right + BEND[1])} ${RAIL_BOTTOM},` +
        `${round(right)} ${RAIL_BOTTOM + BEND[0] - FILLET + 1},` +
        `${round(right)} ${H - NUB_R}`,
    );
  } else {
    d.push(`V${H - NUB_R}`);
  }

  d.push(`A${NUB_R} ${NUB_R} 0 0 1 ${round(right - NUB_R)} ${H}`);
  d.push(`H${round(x + NUB_R)}`);
  d.push(`A${NUB_R} ${NUB_R} 0 0 1 ${round(x)} ${H - NUB_R}`);

  if (hasLeft) {
    d.push(
      `C${round(x)} ${RAIL_BOTTOM + BEND[0] - FILLET + 1},` +
        `${round(x - BEND[1])} ${RAIL_BOTTOM},` +
        `${round(x - FILLET)} ${RAIL_BOTTOM}`,
    );
    d.push(`H1`);
    d.push(`A1 1 0 0 1 1 ${RAIL_TOP}`);
    d.push(`H${round(x - FILLET)}`);
    d.push(
      `C${round(x - BEND[1])} ${RAIL_TOP},` +
        `${round(x)} ${RAIL_TOP - BEND[0] + FILLET - 1},` +
        `${round(x)} ${NUB_R}`,
    );
  } else {
    d.push(`V${NUB_R}`);
  }

  d.push(`A${NUB_R} ${NUB_R} 0 0 1 ${round(x + NUB_R)} 0`);
  d.push("Z");
  return d.join("");
}

/**
 * Keep one track's shape in step with its input.
 *
 * The nub's width is measured off the value rather than assumed, so a number
 * that grows pushes the shape out around it and the padding either side of it
 * stays what it was.
 */
export function mountTrack(track, input, output) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.appendChild(path);
  track.insertBefore(svg, track.firstChild);

  return function update() {
    const lo = parseFloat(input.min);
    const hi = parseFloat(input.max);
    const t = hi > lo ? (parseFloat(input.value) - lo) / (hi - lo) : 0;

    /*
     * Measured, not guessed: the nub is as wide as the number it carries plus
     * the same padding on both sides, so 8 and 2400 are both centred in it.
     *
     * The box has to be told how many characters it is holding first. An input
     * with `width: auto` does not grow to its text the way a span would — it
     * takes the width its `size` says — so a four-character value like 0.04 was
     * measured against a box cut for two and came out with its padding eaten.
     */
    output.size = Math.max(1, String(output.value).length);
    const width = Math.max(Math.ceil(output.getBoundingClientRect().width), 24);
    const x = t * (W - width);

    path.setAttribute("d", trackPath(x, width));
    track.style.setProperty("--nub-x", `${x}px`);
  };
}
