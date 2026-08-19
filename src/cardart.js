import * as THREE from "three";

/**
 * What is printed on a card, drawn into one atlas.
 *
 * Node 800:6538, in the design's own units and scaled once on the way to the
 * canvas — every measurement below can be read straight against the file. Drawn
 * rather than exported, for the reason a texture is usually exported: a card is
 * 330 across in the design and can be most of a retina frame here, and a flat
 * PNG of one would be soft long before that. This is redrawn at whatever size
 * it is asked for, in the same Azeret the panel is set in.
 *
 * It comes out on nothing. The card itself is not drawn, only the marks on it,
 * so the alpha of this texture is where the ink is and the card underneath goes
 * on being a material you can dial.
 */

/* The card, in the design's units. */
const W = 330;
const H = 128;
const PAD = 24;
const GAP = 24;

/* The design's own two. */
const INK = "#3f3f3b";
const TROUGH = "#cecec5";

/* Rules and bars are 2 through the middle of everything, rounded at 41 — which
   on something 2 across is simply round. */
const RULE = 2;

/*
 * Every icon at four fifths of the size it was cut at — node 800:8147, where
 * the six of them are shown on the same card at their own sizes, and every one
 * comes out at exactly 0.8 of its own artboard. They are not one size: the card
 * in the design grows and shrinks by a few points to fit whichever it carries.
 */
const ICON = 0.8;

/* How many canvas pixels one design unit gets. At three, the ten-point type is
   thirty pixels tall, which holds up to a card the full width of a retina
   frame. */
const SCALE = 3;

/* Three across and two down, which keeps the sheet nearer square than a strip
   and so further from any driver's limit on one side. */
export const CARD_COLUMNS = 3;

/*
 * The six, all the same shape as the design's one.
 *
 * Only the third is in the file — the others are the same layout carrying the
 * other five jobs, so a wheel scrolls through something rather than repeating
 * one card six times. `bar` is how far the progress line has run, which the
 * design draws at 100 of the block's width on the card it shows.
 */
const CARDS = [
  {
    icon: "icon-1.svg",
    title: ["Huwelijks", "Fotograaf"],
    at: "@Meetdistrict",
    hours: "09:00 — 17:00",
    shift: "1/1",
    people: "2",
    length: "8u00min",
    bar: 0.35,
  },
  {
    icon: "icon-2.svg",
    title: ["Horeca", "Medewerker"],
    at: "@Meetdistrict",
    hours: "11:30 — 19:00",
    shift: "2/3",
    people: "1",
    length: "7u30min",
    bar: 0.55,
  },
  {
    icon: "icon-3.svg",
    title: ["Schoonmaak", "Medewerker"],
    at: "@Meetdistrict",
    hours: "10:00 — 15:30",
    shift: "1/2",
    people: "1",
    length: "5u30min",
    bar: 0.7,
  },
  {
    icon: "icon-4.svg",
    title: ["Technisch", "Medewerker"],
    at: "@Meetdistrict",
    hours: "08:00 — 16:30",
    shift: "1/2",
    people: "3",
    length: "8u30min",
    bar: 0.2,
  },
  {
    icon: "icon-5.svg",
    title: ["Front-desk", "Receptionist"],
    at: "@Meetdistrict",
    hours: "09:30 — 18:00",
    shift: "3/4",
    people: "1",
    length: "8u30min",
    bar: 0.85,
  },
  {
    icon: "icon-6.svg",
    title: ["Facility", "Manager"],
    at: "@Meetdistrict",
    hours: "07:30 — 16:00",
    shift: "1/3",
    people: "2",
    length: "8u30min",
    bar: 0.45,
  },
];

export const CARD_COUNT = CARDS.length;
const ROWS = Math.ceil(CARD_COUNT / CARD_COLUMNS);

/**
 * An icon, recoloured to the ink and handed back with the size it was cut at.
 *
 * The artwork is the file rather than anything reconstructed here, but the
 * files carry the long card's lighter grey, so the fill is rewritten on the way
 * past. The size is read off the file's own width and height rather than the
 * loaded image's: an SVG that is 27.5 across comes back as an integer number of
 * pixels, and a rounded icon is a rounded icon at every size after it.
 */
const icons = new Map();

function loadIcon(name) {
  if (icons.has(name)) return icons.get(name);
  const ready = fetch(new URL(`cards/${name}`, document.baseURI).href)
    .then((r) => r.text())
    .then(
      (svg) =>
        new Promise((resolve) => {
          const inked = svg.replace(
            /fill="#[0-9a-fA-F]{3,8}"/g,
            `fill="${INK}"`,
          );
          const size = {
            width: parseFloat((svg.match(/width="([\d.]+)"/) || [])[1]) || 20,
            height: parseFloat((svg.match(/height="([\d.]+)"/) || [])[1]) || 20,
          };
          const image = new Image();
          image.onload = () => resolve({ image, ...size });
          // an icon that will not load is not worth failing a whole sheet over
          image.onerror = () => resolve(null);
          image.src =
            "data:image/svg+xml;charset=utf-8," + encodeURIComponent(inked);
        }),
    )
    .catch(() => null);
  icons.set(name, ready);
  return ready;
}

/* Type is measured off its capitals rather than its em box, the way every text
   node in the design is trimmed. */
function capHeight(ctx) {
  return ctx.measureText("H").actualBoundingBoxAscent;
}

function setFace(ctx, size, tracking = 0) {
  ctx.font = `500 ${size * SCALE}px Azeret, monospace`;
  ctx.letterSpacing = `${tracking * SCALE}px`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

const widthOf = (ctx, text) => ctx.measureText(text).width / SCALE;

/** A rounded bar, which every rule and every divider on this card is. */
function bar(ctx, x, y, w, h, colour) {
  const r = Math.min(w, h) / 2;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.roundRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE, r * SCALE);
  ctx.fill();
}

/**
 * One card, at the design's measurements.
 *
 * The frame is 24 all round with 24 between the two columns; the left one is as
 * wide as its longest line and the right one takes the rest. Down the left:
 * the icon, 12, the title, 12, the handle. Down the right: a rule, the hours,
 * the progress line, the shift, a rule — six apart, with the two rows sharing
 * whatever is left, which at the design's own height is 25 each.
 */
function drawCard(ctx, card, ox, oy, icon) {
  ctx.save();
  ctx.translate(ox * SCALE, oy * SCALE);

  /* ------------------------------------------------------------ the left --- */

  /*
   * Measured before anything is drawn, because where the block starts depends
   * on how tall it comes out.
   *
   * In the design the card is cut to its contents: an icon two points shorter
   * makes a card two points shorter. There is one model here and it is one
   * height, so what the design does by resizing the card this does by centring
   * the block in it — the same distances, the same order, and no card riding
   * high because its icon is a flat one.
   */
  const iconWidth = icon ? icon.width * ICON : 16;
  const iconHeight = icon ? icon.height * ICON : 14;

  setFace(ctx, 18);
  const titleCap = capHeight(ctx) / SCALE;
  const titleWidth = Math.max(...card.title.map((line) => widthOf(ctx, line)));

  setFace(ctx, 10, 0.1);
  const atCap = capHeight(ctx) / SCALE;
  const atWidth = widthOf(ctx, card.at);

  const height = iconHeight + 12 + (18 + titleCap) + 12 + atCap;
  const top = (H - height) / 2;
  let y = top;

  if (icon) {
    ctx.drawImage(
      icon.image,
      PAD * SCALE,
      y * SCALE,
      iconWidth * SCALE,
      iconHeight * SCALE,
    );
  }
  y += iconHeight + 12;

  setFace(ctx, 18);
  card.title.forEach((line, i) => {
    /* Leading none: the second line sits a full size below the first, and the
       block is trimmed to the caps of one and the baseline of the other. */
    ctx.fillText(line, PAD * SCALE, (y + titleCap + i * 18) * SCALE);
  });
  y += 18 + titleCap + 12;

  setFace(ctx, 10, 0.1);
  ctx.fillText(card.at, PAD * SCALE, (y + atCap) * SCALE);

  const leftWidth = Math.max(iconWidth, titleWidth, atWidth);

  /* ----------------------------------------------------------- the right --- */
  const x = PAD + leftWidth + GAP;
  const right = W - PAD - x;
  /* Stretched to the block beside it, the way the design has it — two rules, a
     trough and four gaps of six, and the two rows split what is left. */
  const row = (height - RULE * 3 - 6 * 4) / 2;

  bar(ctx, x, top, right, RULE, INK);
  const rowA = top + RULE + 6;
  const trough = rowA + row + 6;
  const rowB = trough + RULE + 6;
  bar(ctx, x, top + height - RULE, right, RULE, INK);

  bar(ctx, x, trough, right, RULE, TROUGH);
  bar(ctx, x, trough, Math.max(right * card.bar, RULE), RULE, INK);

  setFace(ctx, 10, 0.1);
  const cap = capHeight(ctx) / SCALE;
  const middle = (line) => line + (row + cap) / 2;

  /*
   * The hours, spread rather than packed.
   *
   * Three dividers and two cells, the cells padded six either side, and the
   * space that is left shared out evenly between the five — which is what
   * justify-between does with them in the file.
   */
  const hoursWidth = widthOf(ctx, card.hours) + 12;
  const shiftWidth = widthOf(ctx, card.shift) + 12;
  const spare = (right - RULE * 3 - hoursWidth - shiftWidth) / 4;
  let at = x;
  bar(ctx, at, rowA, RULE, row, INK);
  at += RULE + spare;
  ctx.fillText(card.hours, (at + 6) * SCALE, middle(rowA) * SCALE);
  at += hoursWidth + spare;
  bar(ctx, at, rowA, RULE, row, INK);
  at += RULE + spare;
  ctx.fillText(card.shift, (at + 6) * SCALE, middle(rowA) * SCALE);
  at += shiftWidth + spare;
  bar(ctx, at, rowA, RULE, row, INK);

  /*
   * The shift below it, packed rather than spread: twelve between everything,
   * the head count and its mark tight together, and the length taking whatever
   * room is left over.
   */
  const headWidth = widthOf(ctx, card.people) + 4 + 12;
  at = x;
  bar(ctx, at, rowB, RULE, row, INK);
  at += RULE + 12;
  ctx.fillText(card.people, at * SCALE, middle(rowB) * SCALE);
  drawHours(ctx, at + widthOf(ctx, card.people) + 4, rowB + (row - 12) / 2);
  at += headWidth + 12;
  bar(ctx, at, rowB, RULE, row, INK);
  at += RULE + 12;
  const rest = W - PAD - RULE - 12 - at;
  const length = widthOf(ctx, card.length);
  ctx.fillText(
    card.length,
    (at + (rest - length) / 2) * SCALE,
    middle(rowB) * SCALE,
  );
  bar(ctx, W - PAD - RULE, rowB, RULE, row, INK);

  ctx.restore();
}

/*
 * The one mark that is not a file: a rounded square with a bar in it and a
 * handle above, at twelve across. It is nine paths in the design and four
 * rectangles here, which is the same picture at the size it is ever drawn.
 */
function drawHours(ctx, x, y) {
  ctx.save();
  ctx.translate(x * SCALE, y * SCALE);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(0, 0, 12 * SCALE, 12 * SCALE, 3 * SCALE);
  ctx.roundRect(1.5 * SCALE, 1.5 * SCALE, 9 * SCALE, 9 * SCALE, 1.5 * SCALE);
  ctx.fill("evenodd");
  ctx.beginPath();
  ctx.roundRect(4.5 * SCALE, 3 * SCALE, 3 * SCALE, 1.5 * SCALE, 0.75 * SCALE);
  ctx.roundRect(3 * SCALE, 6 * SCALE, 6 * SCALE, 3 * SCALE, [
    1.5 * SCALE,
    1.5 * SCALE,
    0.75 * SCALE,
    0.75 * SCALE,
  ]);
  ctx.fill();
  ctx.restore();
}

/**
 * The whole sheet, once the type has arrived.
 *
 * The font has to be in before a single measurement is taken: everything on
 * this card is laid out around the width of its own type, so a sheet drawn in
 * the fallback face is not the same picture at a different weight — it is the
 * wrong picture.
 */
export async function cardAtlas() {
  await document.fonts.load(`500 ${18 * SCALE}px Azeret`);
  await document.fonts.load(`500 ${10 * SCALE}px Azeret`);
  const art = await Promise.all(CARDS.map((card) => loadIcon(card.icon)));

  const canvas = document.createElement("canvas");
  canvas.width = W * CARD_COLUMNS * SCALE;
  canvas.height = H * ROWS * SCALE;
  const ctx = canvas.getContext("2d");

  CARDS.forEach((card, i) => {
    const column = i % CARD_COLUMNS;
    const row = Math.floor(i / CARD_COLUMNS);
    drawCard(ctx, card, column * W, row * H, art[i]);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/** Where card `i` sits on the sheet, as a scale and an offset in uv. */
export function cardTile(i) {
  const index = ((i % CARD_COUNT) + CARD_COUNT) % CARD_COUNT;
  const column = index % CARD_COLUMNS;
  const row = Math.floor(index / CARD_COLUMNS);
  return [
    1 / CARD_COLUMNS,
    1 / ROWS,
    column / CARD_COLUMNS,
    /* v runs down the canvas and up the texture, so the first row of cells is
       the last row of uv. */
    (ROWS - 1 - row) / ROWS,
  ];
}
