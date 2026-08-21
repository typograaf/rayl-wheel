/**
 * The suite, against a server it starts itself.
 *
 *   npm test
 *
 * Headless, but not software-rendered: `--use-gl=angle` puts Chrome on the real
 * GPU through Metal, which matters because half of what is being checked here
 * is what a shader did. A software rasteriser would answer a different question
 * at a tenth of the speed.
 */
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));

function findChrome() {
  if (process.env.RAYL_CHROME) return process.env.RAYL_CHROME;
  const cache = path.join(os.homedir(), ".cache/puppeteer/chrome");
  if (fs.existsSync(cache)) {
    for (const build of fs.readdirSync(cache).sort().reverse()) {
      const found = path.join(
        cache,
        build,
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      );
      if (fs.existsSync(found)) return found;
    }
  }
  for (const known of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]) {
    if (fs.existsSync(known)) return known;
  }
  throw new Error("no Chrome found — set RAYL_CHROME to one");
}

const port = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.listen(0, () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
const url = `http://localhost:${port}/`;
const server = spawn(
  "npx",
  ["vite", "--port", String(port), "--strictPort", "--clearScreen", "false"],
  { cwd: path.join(here, ".."), stdio: "ignore" },
);
const stop = () => server.kill();
process.on("exit", stop);
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});

for (let tries = 0; tries < 60; tries++) {
  try {
    if ((await fetch(url)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: "new",
  args: ["--use-gl=angle"],
  defaultViewport: { width: 1280, height: 900 },
});
const page = await browser.newPage();
const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "rayl-wheel-"));
const client = await page.createCDPSession();
await client.send("Page.setDownloadBehavior", {
  behavior: "allow",
  downloadPath: downloads,
});
const thrown = [];
page.on("pageerror", (e) => thrown.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") thrown.push(m.text().slice(0, 200));
});
await page.goto(url, { waitUntil: "networkidle0" });
await page.waitForFunction("window.rayl && window.rayl.wheel", {
  timeout: 15000,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(1500);

/* Setting a control the way a person does: by id for a slider, by value for
   one of the segmented rows, which are buttons and have nothing to set. */
const set = (id, value) =>
  page.evaluate(
    (id, value) => {
      const input = document.getElementById(id);
      if (input) {
        input.value = String(value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
      const button = document.querySelector(
        `[data-select="${id}"] .btn[data-value="${value}"]`,
      );
      if (button) {
        button.click();
        return true;
      }
      return false;
    },
    id,
    value,
  );

/* The picture as it stands, read off the buffer rather than a data url, with a
   render forced in the same task so there is something in it to read. */
const picture = () =>
  page.evaluate(() => {
    const r = window.rayl.renderer;
    r.render(window.rayl.scene, window.rayl.camera);
    const gl = r.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let ink = 0;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      const grey = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (grey < 95) ink++;
      if (grey > 200) lit++;
    }
    return { w, h, ink, lit };
  });

/* The picture as it stands, reduced to a number. Two settings that come out
   the same number are the same picture, which is what a loop closing means. */
const frame = () =>
  page.evaluate(() => {
    window.rayl.draw(null);
    const gl = window.rayl.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      sum = (sum * 31 + px[i] + px[i + 1] * 7 + px[i + 2] * 13) >>> 0;
    }
    return sum;
  });

const waitFor = async (test, ms = 30000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await test()) return true;
    await wait(250);
  }
  return false;
};

const state = () =>
  page.evaluate(() => {
    const { params, wheel } = window.rayl;
    const radius = params.radius * (128 / 330);
    return {
      params: { ...params },
      cards: wheel.cards.map((c) => ({
        visible: c.visible,
        z: c.position.z,
        y: c.position.y,
        opacity: c.material.opacity,
      })),
      radius,
    };
  });

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(
    `${ok ? "  ok  " : " FAIL "} ${name}${detail ? "  — " + detail : ""}`,
  );
};

/* ---------------------------------------------------------------- checks --- */

const first = await picture();
check(
  "the picture has something in it",
  first.ink > 500 && first.lit > 500,
  `ink ${first.ink}, lit ${first.lit}`,
);

/* The print is the only dark thing in the frame: the backdrop is a mid grey
   ramp and the cards are lighter than it, so ink at all is ink on a card. */
check(
  "the design is printed on the cards",
  first.ink > 2000,
  `${first.ink} dark pixels`,
);

/* Nothing on the far side of the drum, at any setting. The drum's centre is one
   radius behind the front card, so a card past it is a card seen from behind —
   which is the one thing this wheel is not allowed to show. */
for (const [radius, arc] of [
  [1.2, 90],
  [1.7, 82],
  [4, 60],
]) {
  await set("radius", radius);
  await set("arc", arc);
  await set("scroll", 5);
  await wait(400);
  const now = await state();
  const behind = now.cards.filter((c) => c.visible && c.z < -now.radius + 1e-3);
  check(
    `nothing behind the drum at radius ${radius}, arc ${arc}`,
    behind.length === 0,
    `${behind.length} card(s) round the back`,
  );
}

/*
 * And whether there is anything off the ends of the list is the loop's mode to
 * say. Ping-ponging, the list ends: at nought there is nothing above the first
 * card. Cycling, it is a ring, and the last card is exactly what is above the
 * first — which is the whole of how a loop closes.
 */
await set("radius", 1.7);
await set("arc", 82);
await set("motion", "pong");
await set("scroll", 0);
await wait(400);
const ends = await state();
check(
  "ping-ponging, the list ends",
  ends.cards[ends.cards.length - 1].visible === false,
  "the last card shows above the first",
);

await set("motion", "cycle");
await set("scroll", 0);
await wait(400);
const ring = await state();
check(
  "cycling, it is a ring",
  ring.cards[ring.cards.length - 1].visible === true,
  "nothing came round above the first",
);

/* A drag turns the wheel. */
await set("radius", 1.7);
await set("arc", 82);
await set("snap", "free");
await set("scroll", 4);
await wait(400);
const before = (await state()).params.scroll;
const box = await page.evaluate(() => {
  const r = document.getElementById("stage").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(box.x, box.y - i * 12);
await page.mouse.up();
await wait(900);
const after = (await state()).params.scroll;
check(
  "dragging turns the wheel",
  after > before + 0.3,
  `${before.toFixed(2)} -> ${after.toFixed(2)}`,
);

/* And with snap on it comes to rest on a card rather than between two. */
await set("snap", "snap");
await wait(1600);
const rest = (await state()).params.scroll;
check(
  "snapping settles on a card",
  Math.abs(rest - Math.round(rest)) < 0.02,
  `rests at ${rest.toFixed(3)}`,
);

/* Both projections frame the card at rest the same, which is what makes them
   comparable — everything that differs between them is the rest of the wheel. */
await set("scroll", 4);
await wait(500);
const lens = await picture();
await set("projection", "isometric");
await wait(500);
const flat = await picture();
check(
  "the two projections are both drawn",
  lens.ink > 2000 && flat.ink > 2000,
  `lens ${lens.ink}, flat ${flat.ink}`,
);
check(
  "the projections differ",
  Math.abs(lens.lit - flat.lit) > 200,
  `lens ${lens.lit}, flat ${flat.lit}`,
);

/* ------------------------------------------------------------ the loop --- */

await set("projection", "perspective");
await set("scroll", 4);
await set("snap", "free");
await wait(400);

/* Playing turns the wheel on its own, and stopping leaves it where it is. */
await page.click("#play");
await wait(1200);
const running = (await state()).params.scroll;
await page.click("#play");
await wait(600);
const stopped = (await state()).params.scroll;
check(
  "playing turns the wheel",
  running > 4.05,
  `reached ${running.toFixed(2)}`,
);
check(
  "pausing leaves it where it is",
  Math.abs(stopped - running) < 0.9,
  `${running.toFixed(2)} -> ${stopped.toFixed(2)}`,
);
check(
  "the button says what it will do",
  (await page.evaluate(() =>
    document.getElementById("play").textContent.trim(),
  )) === "Play",
);

/* The curve is doing something: halfway through the loop an ease is not where
   a straight line is. */
await set("motion", "cycle");
await set("travel", 6);
await set("seconds", 6);
await page.click("#play");
await page.click("#play");
await set("curve", "Linear");
const straight = await page.evaluate(() => window.rayl.pose(1.5));
await set("curve", "In & Out");
const eased = await page.evaluate(() => window.rayl.pose(1.5));
check(
  "the curves shape the turn",
  Math.abs(straight - eased) > 0.2,
  `linear ${straight.toFixed(2)} vs eased ${eased.toFixed(2)}`,
);

/*
 * And the loop closes, whatever it travels.
 *
 * Turning the wheel a whole number of cards always puts every card where
 * another one was — the places match by construction — so what decides whether
 * the last frame is the first one is what is printed on them. Which is why the
 * run of designs is made to be the travel: two along, two designs; three along,
 * three. Any other arrangement and the loop cuts, and it cuts to a picture that
 * is right in every other way, which is the worst kind.
 */
for (const travel of [1, 2, 3, 4, 5, 6, 7, 8, 12]) {
  await set("travel", travel);
  await wait(250);
  const held = (await state()).params.count;
  await set("scroll", 0);
  const before = await frame();
  await set("scroll", travel);
  const after = await frame();
  check(
    `a cycle of ${travel} closes exactly`,
    before === after,
    `${held} cards · ${before} vs ${after}`,
  );
  check(
    `and the list is a whole number of runs`,
    held % travel === 0,
    `${held} cards in runs of ${travel}`,
  );
}

/*
 * And a card at the edge of the arc is genuinely see-through.
 *
 * Which is not a given: `transparent` is baked into three's shader program, so
 * a card that flips to it without asking for a recompile goes on being drawn
 * solid at whatever opacity it claims. That looked right in every still and
 * only turned up as a loop that would not close.
 */
await set("scroll", 3);
const faded = await page.evaluate(() => {
  window.rayl.draw(null);
  return window.rayl.wheel.cards
    .filter((c) => c.visible && c.material.opacity < 0.99)
    .map((c) => ({
      opacity: c.material.opacity,
      solid: !c.material.transparent,
    }));
});
check(
  "the cards at the ends really fade",
  faded.length > 0 && faded.every((c) => !c.solid),
  `${faded.length} fading, ${faded.filter((c) => c.solid).length} still solid`,
);

/* Ping-pong closes whatever it travels, because it ends where it turned round
   from: the phase runs out and back over the one curve. */
await set("motion", "pong");
await set("travel", 3);
await set("seconds", 6);
await page.click("#play");
await page.click("#play");
const [there, midway, back] = await page.evaluate(() => [
  window.rayl.pose(0),
  window.rayl.pose(3),
  window.rayl.pose(5.999),
]);
check(
  "ping-pong comes back to where it started",
  Math.abs(there - back) < 0.01 && Math.abs(midway - there) > 1,
  `${there.toFixed(2)} -> ${midway.toFixed(2)} -> ${back.toFixed(2)}`,
);

/* --------------------------------------------------------- the surface --- */

await set("motion", "cycle");
await set("travel", 6);
await set("scroll", 4);
await set("surface", "colour");
const oneColour = await frame();
await set("surface", "gradient");
const twoColours = await frame();
check(
  "the gradient is not the flat colour",
  oneColour !== twoColours,
  `${oneColour} vs ${twoColours}`,
);

await set("inside", "#ff0000");
const loud = await frame();
check(
  "and the two colours drive it",
  twoColours !== loud,
  `${twoColours} vs ${loud} with the inside colour moved`,
);
await set("inside", "#cecec5");

/*
 * And every edge falls off at the same rate.
 *
 * Measured where it shows: two points the same distance in from the outline,
 * one from a short edge and one from a long one. A sweep measured out from the
 * middle in uv is an ellipse on a card two and a half times as wide as it is
 * tall, and those two points come out nothing like each other — the ends lit
 * and the sides not. Black inside and white out, so what is being compared is
 * the falloff and not the lighting.
 */
await set("inside", "#000000");
await set("edges", "#ffffff");
await set("scroll", 4);
/* And the lamps off for the reading. They are three points in space, put where
   they are to light a card from particular directions, so with them on the two
   samples differ by the rig as well as by the falloff — which is the rig doing
   its job and this test measuring the wrong thing. The room is even; that is
   what is wanted underneath. */
for (const lamp of ["keyLevel", "fillLevel", "edgeLevel"]) await set(lamp, 0);
await set("through", 0);
await wait(200);
const evenness = await page.evaluate(() => {
  window.rayl.draw(null);
  const gl = window.rayl.renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const read = (x, y) => {
    const px = new Uint8Array(4);
    gl.readPixels(
      Math.round(x),
      Math.round(h - y),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    return (px[0] + px[1] + px[2]) / 3;
  };
  /* The card at rest is in the middle of the frame, square on, and takes this
     much of its width — so where its edges are is arithmetic. */
  const wide = w * window.rayl.params.fill;
  const tall = wide / (330 / 128);
  const inset = (30 / 330) * wide;
  return {
    fromLong: read(w / 2, h / 2 - tall / 2 + inset),
    fromShort: read(w / 2 - wide / 2 + inset, h / 2),
  };
});
const gap = Math.abs(evenness.fromLong - evenness.fromShort);
check(
  "every edge falls off at the same rate",
  gap < 12,
  `${Math.round(evenness.fromLong)} in from the top, ${Math.round(evenness.fromShort)} in from the side`,
);
await set("inside", "#cecec5");
await set("edges", "#e7e7e0");
await set("keyLevel", 0.5);
await set("fillLevel", 0.12);
await set("edgeLevel", 1);
await set("through", 0.55);

check(
  "one colour or two, never both sets of controls",
  await page.evaluate(() => {
    const shown = (id) => !document.getElementById(id).hidden;
    const graded =
      shown("insideRow") && shown("edgesRow") && !shown("colourRow");
    document
      .querySelector('[data-select="surface"] .btn[data-value="colour"]')
      .click();
    const flat =
      shown("colourRow") && !shown("insideRow") && !shown("edgesRow");
    document
      .querySelector('[data-select="surface"] .btn[data-value="gradient"]')
      .click();
    return graded && flat;
  }),
  "the rows follow the switch",
);

/* The swatches open the tool's own picker rather than the system's panel, and
   what is typed into it lands on the value the way a drag on it would. */
const picked = await page.evaluate(async () => {
  const swatch = document.getElementById("edges");
  /* Into view first: a picker will not open on a swatch that has scrolled out
     of the panel — it has nothing to anchor to, and it closes rather than
     clamping itself over the corner of the window. */
  swatch.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 60));
  swatch.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  const popover = document.querySelector(".picker");
  const open = popover && !popover.hidden;
  const field = popover.querySelector(".picker-hex");
  const shown = field.value;
  field.value = "#445566";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  return { open, shown, wrote: window.rayl.params.edges, swatch: swatch.value };
});
check(
  "a swatch opens the tool's own picker",
  picked.open,
  picked.open ? "square, hue and hex" : "nothing opened",
);
check("showing the colour it holds", picked.shown === "#e7e7e0", picked.shown);
check(
  "and typing a hex into it writes through",
  picked.wrote === "#445566" && picked.swatch === "#445566",
  `${picked.wrote} on the input, ${picked.swatch} on the swatch`,
);
await set("edges", "#e7e7e0");

/* ----------------------------------------------------------- the lamps --- */

/*
 * The rig is arranged by hand, so what is checked is the hand.
 *
 * Where a lamp sits is the whole question translucency asks — the term only
 * fires from behind — and there is no slider for it, on purpose. There is a
 * handle on the picture instead.
 */
await set("surface", "colour");
await set("scroll", 4);
await wait(300);

const dotAt = (lamp) =>
  page.evaluate((lamp) => {
    const dot = document
      .querySelector(`.light-handle[data-lamp="${lamp}"] > i`)
      .getBoundingClientRect();
    return { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
  }, lamp);
const lampAt = (lamp) => page.evaluate((l) => window.rayl.params[l], lamp);
const lampLight = (index) =>
  page.evaluate(
    (i) =>
      window.rayl.scene.children
        .filter((o) => o.isPointLight)
        [i].position.toArray()
        .map((v) => +v.toFixed(2)),
    index,
  );

const restingAt = await lampAt("fillAt");
const grab = await dotAt("fillAt");
await page.mouse.move(grab.x, grab.y);
await page.mouse.down();
for (let i = 1; i <= 8; i++)
  await page.mouse.move(grab.x + i * 9, grab.y - i * 5);
await page.mouse.up();
await wait(300);
const draggedTo = await lampAt("fillAt");
check(
  "a lamp goes where its handle is dragged",
  draggedTo !== restingAt,
  `${restingAt} -> ${draggedTo}`,
);
check(
  "and the light goes with it",
  (await lampLight(1)).join(",") === draggedTo.split(",").map(Number).join(","),
  `the lamp says ${draggedTo}, the light is at ${(await lampLight(1)).join(",")}`,
);

/* The wheel, with one selected, is the only way to move it in depth — and it
   must not scroll the list at the same time. */
const beforeWheel = await lampAt("fillAt");
const scrollBefore = (await state()).params.scroll;
const on = await dotAt("fillAt");
await page.mouse.move(on.x, on.y);
await page.mouse.wheel({ deltaY: 300 });
await wait(400);
const afterWheel = await lampAt("fillAt");
check(
  "the wheel moves a selected lamp in depth",
  afterWheel.split(",")[2] !== beforeWheel.split(",")[2],
  `${beforeWheel} -> ${afterWheel}`,
);
check(
  "and leaves the list where it was",
  Math.abs((await state()).params.scroll - scrollBefore) < 0.01,
  "the list scrolled as well",
);

/* A press on the picture puts the rig down, so the wheel goes back to being the
   scroll. Without it a lamp would keep the wheel for the rest of the session. */
const middle = await page.evaluate(() => {
  const r = document.getElementById("stage").getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height * 0.75 };
});
await page.mouse.move(middle.x, middle.y);
await page.mouse.down();
await page.mouse.up();
const parked = await lampAt("fillAt");
await page.mouse.wheel({ deltaY: 300 });
await wait(700);
check(
  "a press on the picture puts the rig down",
  (await lampAt("fillAt")) === parked &&
    Math.abs((await state()).params.scroll - scrollBefore) > 0.2,
  `the lamp is at ${await lampAt("fillAt")}, the list at ${(await state()).params.scroll.toFixed(2)}`,
);

/* And the light that comes through the card rather than off it. */
await set("through", 0);
await wait(200);
const opaque = await frame();
await set("through", 0.55);
await wait(200);
const waxy = await frame();
check(
  "translucency is a different picture",
  opaque !== waxy,
  `${opaque} vs ${waxy}`,
);

/* ---------------------------------------------------------- the export --- */

await set("motion", "cycle");
await set("travel", 6);
await set("format", "png");
await set("width", 660);
await page.click("#export");
const png = await waitFor(() =>
  fs.readdirSync(downloads).some((name) => name.endsWith(".png")),
);
const stillName = fs.readdirSync(downloads).find((n) => n.endsWith(".png"));
check("a still comes out", png, stillName || "nothing landed");
if (png) {
  const bytes = fs.readFileSync(path.join(downloads, stillName));
  /* The IHDR carries the size, sixteen bytes in, big-endian. */
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  check(
    "at the size that was asked for",
    width === 660 && height === 944,
    `${width}x${height}`,
  );
}

if (await page.evaluate(() => typeof VideoEncoder !== "undefined")) {
  await set("format", "mp4");
  await set("width", 330);
  await set("seconds", 1);
  await set("fps", 12);
  await page.click("#export");
  const mp4 = await waitFor(() =>
    fs.readdirSync(downloads).some((name) => name.endsWith(".mp4")),
  );
  const clipName = fs.readdirSync(downloads).find((n) => n.endsWith(".mp4"));
  check("a loop comes out", mp4, clipName || "nothing landed");
  if (mp4) {
    const bytes = fs.readFileSync(path.join(downloads, clipName));
    check(
      "and it is an mp4",
      bytes.slice(4, 8).toString() === "ftyp",
      `${bytes.length} bytes`,
    );
  }
} else {
  console.log("  --   no video encoder in this browser, skipping the loop");
}

/*
 * The print is drawn for the size being written, not for the preview.
 *
 * A card takes most of the frame, so a six-thousand pixel export puts thousands
 * of pixels along something the design draws at 330 units. The sheet has to be
 * redrawn with a pixel for each of them — which is the whole reason the design
 * is drawn here rather than exported as a picture.
 */
await set("format", "png");
await set("width", 2640);
const scales = [];
const watching = setInterval(async () => {
  try {
    scales.push(await page.evaluate(() => window.rayl.printScale()));
  } catch {
    // the page is busy; the next tick will do
  }
}, 40);
await page.click("#export");
await waitFor(() =>
  page.evaluate(() =>
    /png/.test(document.getElementById("status").textContent),
  ),
);
clearInterval(watching);
await wait(300);
const peak = Math.max(...scales, 0);
check("the print is redrawn for a big export", peak >= 7, `reached ${peak}x`);
check(
  "and comes back down after it",
  (await page.evaluate(() => window.rayl.printScale())) === 3,
  "the big sheet is still on the cards",
);

/*
 * A sequence, into a folder.
 *
 * The whole export path, with the picker replaced by somewhere to put the
 * bytes — which is the only part of it a test cannot click. The frames come
 * back out of the page and are written here, so what follows can be run against
 * real files.
 */
await set("format", "frames");
await set("seconds", 1);
await set("fps", 12);
await set("width", 660);
const sequence = await page.evaluate(async () => {
  const written = [];
  const folder = {
    name: "frames",
    getFileHandle: async (name) => ({
      createWritable: async () => ({
        write: async (blob) => {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let text = "";
          for (let i = 0; i < bytes.length; i++)
            text += String.fromCharCode(bytes[i]);
          written.push({ name, size: blob.size, data: btoa(text) });
        },
        close: async () => {},
      }),
    }),
  };
  await window.rayl.write(folder);
  return { written, status: document.getElementById("status").textContent };
});
const wrote = sequence.written;
check(
  "a sequence comes out a frame at a time",
  wrote.length === 12,
  `${wrote.length} frames`,
);
check(
  "numbered in order",
  /_0001\.png$/.test(wrote[0]?.name) && /_0012\.png$/.test(wrote[11]?.name),
  `${wrote[0]?.name} ... ${wrote[11]?.name}`,
);
const shape = (f) => {
  const head = Buffer.from(f.data, "base64");
  return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`;
};
check(
  "at the size the panel asked for",
  wrote.every((f) => shape(f) === "660x944"),
  [...new Set(wrote.map(shape))].join(", "),
);
check(
  "and it says what to do with them",
  /npm run prores -- frames/.test(sequence.status),
  sequence.status,
);

/*
 * And those frames make a ProRes 4444 with its alpha intact.
 *
 * The one thing here that happens outside the browser, because there is no
 * ProRes encoder in one — so this runs the step a person would run, over the
 * files the tool actually wrote.
 */
const seqDir = fs.mkdtempSync(path.join(os.tmpdir(), "rayl-frames-"));
for (const file of wrote)
  fs.writeFileSync(
    path.join(seqDir, file.name),
    Buffer.from(file.data, "base64"),
  );

if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
  console.log("  --   no ffmpeg on the path, skipping the movie");
} else {
  const made = spawnSync(
    "node",
    [path.join(here, "../tools/prores.mjs"), seqDir, "12"],
    { encoding: "utf8" },
  );
  const movie = fs.readdirSync(seqDir).find((name) => name.endsWith(".mov"));
  check(
    "a ProRes comes out of them",
    Boolean(movie),
    (made.stderr || made.stdout || "").trim().split("\n").pop(),
  );
  if (movie) {
    const shown = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,profile,pix_fmt",
        "-of",
        "csv=p=0",
        path.join(seqDir, movie),
      ],
      { encoding: "utf8" },
    ).stdout.trim();
    check(
      "4444, with an alpha channel in it",
      /prores/.test(shown) && /4444/.test(shown) && /yuva/.test(shown),
      shown,
    );
  }
}
fs.rmSync(seqDir, { recursive: true, force: true });

/* ------------------------------------------------------------- the link --- */

await set("motion", "cycle");
await set("radius", 3.15);
await set("rig", "Sharp");
await wait(900);
const link = await page.evaluate(() => window.location.hash);
check(
  "the link carries the state",
  /radius=3.15/.test(link) && /rig=Sharp/.test(link),
  link.slice(0, 80),
);

await page.goto(url + link, { waitUntil: "networkidle0" });
await page.waitForFunction("window.rayl && window.rayl.wheel", {
  timeout: 15000,
});
await wait(1500);
const reopened = await state();
check(
  "and a reload comes back to it",
  Math.abs(reopened.params.radius - 3.15) < 1e-6 &&
    reopened.params.rig === "Sharp",
  `radius ${reopened.params.radius}, rig ${reopened.params.rig}`,
);
check(
  "with the panel showing it",
  (await page.evaluate(() => document.getElementById("radius").value)) ===
    "3.15" &&
    (await page.evaluate(
      () =>
        document.querySelector('[data-select="rig"] .btn[data-value="Sharp"]')
          .dataset.on,
    )) === "true",
  "the controls opened on the defaults",
);

/* And a still comes out on nothing, which is what taking the sheet off does. */
const clear = await page.evaluate(() => {
  const m = window.rayl;
  const sheet = m.scene.background;
  m.scene.background = null;
  m.draw(null);
  const gl = m.renderer.getContext();
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(4);
  gl.readPixels(2, h - 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  m.scene.background = sheet;
  m.draw(null);
  const on = new Uint8Array(4);
  gl.readPixels(2, h - 3, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, on);
  return { off: [...px], on: [...on] };
});
check(
  "a still is drawn on nothing",
  clear.off[3] === 0 && clear.on[3] === 255,
  `corner alpha ${clear.off[3]} without the sheet, ${clear.on[3]} with it`,
);

check("nothing was thrown", thrown.length === 0, thrown.join(" | "));

await browser.close();
stop();
console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
