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
import { spawn } from "node:child_process";
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

/* And nothing off the ends of the list: a wheel is a loop and a list is not. */
await set("scroll", 0);
await wait(400);
const top = await state();
check(
  "the list does not wrap at its start",
  top.cards.filter((c) => c.visible).length <= top.cards.length &&
    top.cards[top.cards.length - 1].visible === false,
  "the last card shows above the first",
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

check("nothing was thrown", thrown.length === 0, thrown.join(" | "));

await browser.close();
stop();
console.log(failed ? `\n${failed} failed` : "\nall good");
process.exit(failed ? 1 : 0);
