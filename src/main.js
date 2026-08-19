import * as THREE from "three";
import { loadCard } from "./card.js";
import { cardAtlas, PRINT_SCALE, CARD_COLUMNS, CARD_COUNT } from "./cardart.js";
import { Wheel, CARD_HEIGHT } from "./wheel.js";
import { backdrop, Lighting } from "./environment.js";
import { mountTrack } from "./track.js";
import { CURVES, loopAt } from "./ease.js";
import { serialize, deserialize } from "./settings.js";
import {
  exportName,
  savePNG,
  saveMP4,
  saveFrames,
  chooseFolder,
  mp4Supported,
  evenSize,
} from "./save.js";

/**
 * The wheel, in a browser tab.
 *
 * A list of cards on a drum, turned by scrolling, under either of the two
 * projections — because which one this wants is a question the design has not
 * answered yet, and the only honest way to answer it is to look at both with
 * the same cards on the same wheel.
 *
 * The picture is 330 by 472: the scroller's own box in the design, kept at that
 * shape whatever the window does. A tool for deciding how something looks in a
 * phone that shows it in a letterbox is a tool answering a different question.
 */

/* The frame, as the design has it: the scroller's box, 330 across and 472
   down. */
const FRAME = 330 / 472;

const DEFAULTS = {
  projection: "perspective",
  fov: 28,
  fill: 0.92,
  radius: 1.7,
  spacing: 0.1,
  arc: 82,
  fade: 28,
  count: 12,
  depth: 1,
  roughness: 0.55,
  colour: "#f0f0ea",
  rig: "Studio",
  light: 2.4,
  shadow: 0.45,
  snap: "snap",
  /* The loop: which way it runs, how many cards it covers, how long it takes,
     and the curve it does it on. */
  motion: "cycle",
  travel: 6,
  seconds: 6,
  curve: "In & Out",
  /* And what comes out of it. Width alone, because the frame has one shape and
     a height that disagreed with it would be a letterbox. */
  format: "png",
  width: 990,
  fps: 30,
  bitrate: 12,
  /* Opened part-way down the list rather than at the top of it: at nought the
     wheel is a card and an empty frame, which is the truth about the first item
     in a list and tells you nothing about the wheel. */
  scroll: 4,
};

const params = { ...DEFAULTS };

/*
 * And then the link does, if there is one.
 *
 * Read here rather than after the panel is up, so the tool comes up in the
 * state that was asked for instead of coming up in the default one and jumping.
 * The controls are already in the document — they are markup, not built — so
 * their own limits are available to check the string against.
 */
Object.assign(params, deserialize(window.location.hash, params));

const canvas = document.getElementById("stage");
const frame = document.querySelector(".frame");

/* Alpha, for the sake of one thing: a still that comes out on nothing. The
   backdrop is a scene background rather than a clear colour, so taking it off
   leaves the cards standing on transparency without touching anything else. */
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const sheet = backdrop();
scene.background = sheet;

const lighting = new Lighting(renderer, scene);

/* Both framings, so switching projection is a swap and not a rebuild. */
const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 40);
const lens = new THREE.PerspectiveCamera(28, FRAME, 0.1, 40);
let camera = lens;

let wheel = null;

/* Where the scroll is going, and where it has got to. The two are separate so
   a flick can overshoot the frame it was made in and still arrive. */
let target = params.scroll;
let at = params.scroll;
let settling = 0;

/* The loop, when it is running: where it started, how far into it we are, and
   whether it is running at all. */
let playing = false;
let clock = 0;
let began = 0;

/* An export owns the renderer while it runs — its own size, its own frames —
   so the live loop stands off until it is finished. */
let busy = false;
let cancel = false;

/* How much print the sheet on the cards has, in canvas pixels per design unit.
   It goes up for an export and comes back down after one. */
let printed = PRINT_SCALE;

/* How many cards were actually asked for, as against how many the run of
   designs rounded that up to. Kept apart so the rounding is done afresh from
   what was wanted every time — round the rounded number and a count climbs a
   little with every change of travel, and never comes back down. */
let asked = DEFAULTS.count;
let needs = true;
const mark = () => {
  needs = true;
};

/* ----------------------------------------------------------- the framing --- */

/**
 * The picture, at the one shape it has, as large as the frame will take it.
 *
 * Fitted rather than stretched: the window is whatever the window is, and the
 * card is 330 wide in a 330 box, so the only thing a wider window buys is a
 * bigger picture of exactly the same thing.
 */
function resize() {
  /* The frame's own margin, which is 48 where there is room for 48 and less on
     a phone, where 48 a side is a third of the picture. */
  const pad = Math.min(48, Math.round(frame.clientWidth * 0.05));
  const room = {
    w: Math.max(frame.clientWidth - pad * 2, 80),
    h: Math.max(frame.clientHeight - pad * 2, 80),
  };
  let w = room.w;
  let h = w / FRAME;
  if (h > room.h) {
    h = room.h;
    w = h * FRAME;
  }
  renderer.setSize(Math.round(w), Math.round(h));
  place();
  mark();
}

/**
 * Both cameras, from the one number that matters: how much of the frame's width
 * a card at rest is allowed to take.
 *
 * Which is what makes the two projections comparable. The front card comes out
 * the same size under either — it is at the origin and both cameras are square
 * on to it — so everything that differs between them is what the *rest* of the
 * wheel does, which is the thing being decided.
 */
function place() {
  const width = 1 / params.fill;
  const height = width / FRAME;

  flat.left = -width / 2;
  flat.right = width / 2;
  flat.top = height / 2;
  flat.bottom = -height / 2;
  flat.position.set(0, 0, 8);
  flat.near = 0.1;
  flat.far = 40;
  flat.updateProjectionMatrix();

  const distance = height / 2 / Math.tan((params.fov * Math.PI) / 360);
  lens.fov = params.fov;
  lens.aspect = FRAME;
  lens.position.set(0, 0, distance);
  lens.near = Math.max(0.02, distance * 0.05);
  lens.far = distance + 8;
  lens.updateProjectionMatrix();

  camera = params.projection === "isometric" ? flat : lens;
  camera.lookAt(0, 0, 0);
}

/** Everything the wheel needs except where it is, which changes per frame. */
const shape = () => ({
  radius: params.radius,
  spacing: params.spacing,
  arc: params.arc,
  fade: params.fade,
  thickness: params.depth,
  cycle: cycling(),
});

/* A cycling wheel is endless: the list wraps, so it can be turned for as long
   as you like and a loop that travels a whole number of cards comes back to
   where it started. Ping-pong runs out and back along a list that ends. */
const cycling = () => params.motion === "cycle";

/** How far the scroll can be taken, which the wrap changes. */
const span = () =>
  wheel ? (cycling() ? wheel.cards.length : wheel.span()) : 0;

/*
 * The address bar, kept in step with the panel.
 *
 * Debounced, because a drag is one change made two hundred times: the string is
 * written once the hand has stopped rather than once a frame. Not while the
 * loop is running — a wheel turning on its own would rewrite the link twice a
 * second for as long as it was left playing, and where a loop happens to have
 * got to is not a setting.
 */
let pending = 0;
function record() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    if (playing || busy) return;
    history.replaceState(null, "", `#${serialize(params)}`);
  }, 400);
}

/** What the tool has to say, which is never much. */
function setStatus(text) {
  const box = document.getElementById("status");
  box.textContent = text || "";
  box.hidden = !text;
}

/** How tall a card is on screen, in css pixels — what a drag is measured in. */
function cardPixels() {
  const height = 1 / params.fill / FRAME;
  return (canvas.clientHeight * CARD_HEIGHT) / height;
}

/* ------------------------------------------------------------- the panel --- */

const sliders = new Map();

function bindSlider(id, key, decimals = 2, after) {
  const input = document.getElementById(id);
  const nub = document.getElementById(id + "Out");
  const show = () => {
    const value = parseFloat(input.value);
    nub.value = decimals ? +value.toFixed(decimals) : Math.round(value);
  };
  const update = mountTrack(input.parentElement, input, nub);
  const refresh = () => {
    show();
    update();
  };
  input.addEventListener("input", () => {
    params[key] = parseFloat(input.value);
    refresh();
    if (after) after();
    record();
    mark();
  });
  sliders.set(key, { input, refresh });
  refresh();
  return refresh;
}

function bindSelect(name, after) {
  const box = document.querySelector(`[data-select="${name}"]`);
  const buttons = [...box.querySelectorAll(".btn")];
  const show = () => {
    for (const button of buttons)
      button.dataset.on = String(button.dataset.value === params[name]);
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      params[name] = button.dataset.value;
      show();
      if (after) after();
      record();
      mark();
    });
  }
  sliders.set(name, { show, refresh: show });
  show();
}

/* The scroll runs from the first card to the last, so its own track has to be
   recut whenever there are more or fewer of them. */
function relimit() {
  const end = span();
  const input = document.getElementById("scroll");
  input.max = String(end);
  target = Math.min(target, end);
  at = Math.min(at, end);
  params.scroll = at;
  input.value = String(at);
  sliders.get("scroll").refresh();
}

/**
 * The list, cut into whole runs of designs.
 *
 * Cycling, the run of designs is the travel — see the wheel, where why that is
 * the only arrangement a loop can close in is set out. The run then has to
 * divide the ring as well, or the pattern breaks where the ring closes and the
 * wheel goes through a seam once every turn. So the count is rounded up to a
 * whole number of runs.
 *
 * Rounded in the panel rather than behind it. A count that quietly meant
 * something other than the number on the slider is the kind of thing you find
 * out about a fortnight later, from a render.
 */
function fitList() {
  const run = cycling() ? Math.max(1, Math.round(params.travel)) : CARD_COUNT;
  const control = sliders.get("count");
  let count = Math.round(asked);

  if (cycling()) {
    const most = parseFloat(control.input.max);
    const up = Math.ceil(count / run) * run;
    count = up <= most ? up : Math.max(Math.floor(most / run) * run, run);
  }

  if (count !== Math.round(params.count)) {
    params.count = count;
    control.input.value = String(count);
    control.refresh();
  }
  if (!cycling()) asked = count;
  if (wheel.cards.length !== count) {
    wheel.setCount(count);
    pushSurface();
  }
  wheel.setDesigns(run);
  relimit();
  mark();
}

function pushSurface() {
  if (!wheel) return;
  wheel.setSurface({
    colour: params.colour,
    roughness: params.roughness,
    sheen: 0.5,
    coat: 0,
  });
}

function pushLighting() {
  lighting.set(params.rig, params.light);
  lighting.setShadow(params.shadow);
}

/** Every control told what the state says, which a link or a reset both need. */
function pushPanel() {
  for (const [key, control] of sliders) {
    if (control.input) control.input.value = String(params[key]);
    control.refresh();
  }
}

/* Frames a second and a bitrate are a video's, and a control that does nothing
   is worse than no control. */
function showFormat() {
  const moving = params.format !== "png";
  document.getElementById("fpsRow").hidden = !moving;
  document.getElementById("bitrateRow").hidden = params.format !== "mp4";
}

function mountPanel() {
  bindSelect("projection", () => {
    place();
    document.getElementById("lensRow").hidden =
      params.projection === "isometric";
  });
  bindSlider("fov", "fov", 0, place);
  bindSlider("fill", "fill", 2, place);

  bindSlider("radius", "radius", 2);
  bindSlider("spacing", "spacing", 2);
  bindSlider("arc", "arc", 0);
  bindSlider("fade", "fade", 0);

  bindSlider("count", "count", 0, () => {
    asked = params.count;
    fitList();
  });
  bindSlider("depth", "depth", 2);
  bindSlider("roughness", "roughness", 2, pushSurface);

  const colour = document.getElementById("colour");
  colour.addEventListener("input", () => {
    params.colour = colour.value;
    pushSurface();
    record();
    mark();
  });
  sliders.set("colour", {
    refresh: () => {
      colour.value = params.colour;
    },
  });

  bindSelect("rig", pushLighting);
  bindSlider("light", "light", 2, pushLighting);
  bindSlider("shadow", "shadow", 2, pushLighting);

  bindSelect("snap");
  bindSlider("scroll", "scroll", 2, () => {
    if (playing) stop();
    target = params.scroll;
    at = params.scroll;
    settling = 0;
  });

  /* Both of these decide how long a run of designs is and how many of them the
     ring holds, so both of them re-cut the list. */
  bindSelect("motion", fitList);
  bindSlider("travel", "travel", 0, fitList);
  bindSlider("seconds", "seconds", 1);
  bindSelect("curve");
  document.getElementById("play").addEventListener("click", () => {
    if (playing) stop();
    else play();
  });

  bindSelect("format", showFormat);
  bindSlider("width", "width", 0);
  bindSlider("fps", "fps", 0);
  bindSlider("bitrate", "bitrate", 0);
  document
    .getElementById("export")
    .addEventListener("click", () => beginExport());

  document.getElementById("lensRow").hidden = params.projection === "isometric";
  showFormat();

  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(params, DEFAULTS);
    asked = DEFAULTS.count;
    pushPanel();
    wheel.setCount(Math.round(params.count));
    if (playing) stop();
    target = at = params.scroll;
    document.getElementById("lensRow").hidden =
      params.projection === "isometric";
    showFormat();
    setStatus("");
    place();
    pushSurface();
    pushLighting();
    fitList();
    record();
    mark();
  });
}

/* ------------------------------------------------------------ the scroll --- */

/**
 * Turning the wheel: a wheel event, a drag, or the panel's own slider.
 *
 * All three write the same one number and the picture follows it at its own
 * pace, so a flick of the trackpad and a drag of the slider arrive the same
 * way — which is what makes the motion a property of the wheel rather than of
 * whichever thing happened to be touched.
 */
function turn(by) {
  /* A hand on the wheel takes it off the loop. Anything else is two things
     driving one number, and the one you are holding loses. */
  if (playing) stop();
  target += by;
  if (cycling()) {
    /*
     * The picture at n and at n plus a listful are the same picture, so the
     * number can be brought back inside the list without anything moving — as
     * long as where it *is* comes back with where it is *going*, or the catch
     * up would run the whole way round.
     */
    const period = wheel.cards.length;
    while (target > period) {
      target -= period;
      at -= period;
    }
    while (target < 0) {
      target += period;
      at += period;
    }
  } else {
    target = Math.min(Math.max(target, 0), wheel.span());
  }
  settling = 0;
  record();
  mark();
}

/**
 * Where the wheel is, this far into the loop.
 *
 * No spring: a spring is a transient and a transient in a loop is a seam. The
 * phase goes through the curve and comes out as a distance travelled, which is
 * the same answer for the live picture and for the frame being encoded — they
 * are one animation saved two ways.
 */
function poseAt(time) {
  const curve = CURVES[params.curve] || CURVES.Linear;
  const gone =
    params.travel *
    loopAt(
      time / Math.max(params.seconds, 0.1),
      curve,
      params.motion === "pong",
    );
  const where = began + gone;
  return cycling() ? where : Math.min(Math.max(where, 0), wheel.span());
}

function play() {
  began = at;
  clock = 0;
  playing = true;
  document.getElementById("play").textContent = "Pause";
  mark();
}

function stop() {
  playing = false;
  target = at;
  settling = 0;
  record();
  document.getElementById("play").textContent = "Play";
  mark();
}

/* Space, because a transport is a transport. Not while a number is being typed
   into, where a space is a space. */
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || busy) return;
  if (e.target instanceof HTMLInputElement) return;
  e.preventDefault();
  if (playing) stop();
  else play();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    turn(e.deltaY * 0.004);
  },
  { passive: false },
);

let dragging = null;
canvas.addEventListener("pointerdown", (e) => {
  dragging = { y: e.clientY, id: e.pointerId };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const by = (dragging.y - e.clientY) / cardPixels();
  dragging.y = e.clientY;
  turn(by);
});
const release = (e) => {
  if (!dragging) return;
  canvas.releasePointerCapture(dragging.id);
  dragging = null;
  settling = 0;
  mark();
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);

/* ------------------------------------------------------------ the export --- */

/**
 * The picture, at the size it was asked for rather than the size it is being
 * previewed at.
 *
 * Width alone: the frame has one shape, and a height that disagreed with it
 * would be a letterbox around the thing being judged. Even numbers because
 * H.264 encodes in macroblocks over a half-resolution chroma plane, and a still
 * loses nothing by matching it.
 */
/**
 * How finely the print has to be drawn for a picture this wide.
 *
 * The card takes `fill` of the frame, so a frame six thousand pixels across
 * puts five and a half thousand pixels along a card that is 330 units in the
 * design — and the sheet needs one for each of them or the design is a blur
 * with the right colours in it. That is the whole reason the print is drawn
 * here rather than exported as a PNG, so it would be a shame not to use it.
 *
 * Capped at what the driver will hold: three cards across at this scale is the
 * wide side of the sheet, and asking for a texture past the limit fails at the
 * upload rather than at the ask.
 */
function printFor(width) {
  const wanted = Math.ceil((width * params.fill) / 330);
  const limit = Math.floor(
    renderer.capabilities.maxTextureSize / (330 * CARD_COLUMNS),
  );
  return Math.min(Math.max(wanted, PRINT_SCALE), limit);
}

/** Redraw the sheet at a new scale, or keep the one that is up. */
async function reprint(scale) {
  if (scale === printed) return null;
  const was = wheel.atlas;
  const atlas = await cardAtlas(scale);
  wheel.setPrint(atlas);
  printed = scale;
  return was;
}

function exportSize() {
  const width = Math.round(params.width);
  return evenSize(width, Math.round(width / FRAME));
}

/**
 * One frame of whatever is being written, at whatever instant it is for.
 *
 * A still is the pose on screen; a loop is the pose the clock asks for. Either
 * way the wheel is put there outright and drawn in the same turn, because the
 * encoder reads this canvas immediately afterwards and nothing may be left
 * pending on it.
 */
function drawExport(time) {
  const where = time == null ? at : poseAt(time);
  wheel.update({ ...shape(), scroll: where });
  renderer.render(scene, camera);
}

/**
 * Write whatever the panel is asking for.
 *
 * `given` is a folder that has already been chosen — which the suite hands in,
 * since a native picker is the one thing in here nobody can click from a test.
 * Pressed by a person, it asks for one.
 */
async function beginExport(given) {
  /* A second press is a cancel: the button says so, and a recording is the one
     thing here long enough to want out of. */
  if (busy) {
    cancel = true;
    setStatus("stopping");
    return;
  }

  const button = document.getElementById("export");
  const video = params.format === "mp4";
  const sequence = params.format === "frames";
  if (video && !mp4Supported()) {
    setStatus("this browser has no video encoder");
    return;
  }

  /*
   * The folder first, before anything is drawn.
   *
   * A picker needs the click that opened it, and everything below this — a
   * sheet redrawn at export size, a renderer resized — takes long enough to
   * spend that click. Asked for last, the browser refuses to open it at all.
   */
  let folder = given || null;
  if (sequence && !folder) {
    folder = await chooseFolder();
    if (folder === undefined) {
      setStatus("this browser cannot pick a folder — try PNG or MP4");
      return;
    }
    if (folder === null) return;
  }

  const resume = playing;
  if (playing) stop();

  const size = exportSize();
  const ratio = renderer.getPixelRatio();
  const name = exportName(params.projection);
  busy = true;
  cancel = false;
  button.textContent = "Cancel";
  /* Pixel ratio of one and the style left alone: the number in the panel is
     the number of pixels in the file, whatever screen it was framed on. */
  renderer.setPixelRatio(1);
  renderer.setSize(size.width, size.height, false);

  /* And the design drawn to match, so what comes out is the card at that size
     rather than the preview's card stretched to it. */
  setStatus(`drawing the print for ${size.width}x${size.height}`);
  const preview = await reprint(printFor(size.width));

  try {
    if (video) {
      began = at;
      setStatus(`recording ${size.width}x${size.height}`);
      const bytes = await saveMP4({
        canvas,
        width: size.width,
        height: size.height,
        fps: Math.round(params.fps),
        seconds: params.seconds,
        quality: Math.round(params.bitrate),
        draw: drawExport,
        onProgress: (done, total) =>
          setStatus(
            `recording ${size.width}x${size.height} · ${done}/${total} frames`,
          ),
        shouldStop: () => cancel,
        name,
      });
      setStatus(
        bytes
          ? `${name}.mp4 · ${Math.round(bytes / 1e5) / 10}MB`
          : "recording cancelled",
      );
    } else if (sequence) {
      /* Every frame the way the still comes out: on nothing, since a sequence
         is for putting over something else. */
      scene.background = null;
      try {
        const written = await saveFrames({
          folder,
          canvas,
          draw: drawExport,
          fps: Math.round(params.fps),
          seconds: params.seconds,
          name,
          onProgress: (done, total) =>
            setStatus(
              `writing ${size.width}x${size.height} · ${done}/${total} frames`,
            ),
          shouldStop: () => cancel,
        });
        /* And what to do with them. ProRes is not something a browser can
           write — see tools/prores.mjs, where that is argued properly — so the
           last thing this says is the one command that finishes the job. */
        const where = folder.name || "the folder";
        setStatus(
          cancel
            ? `stopped after ${written} frames`
            : `${written} transparent frames · npm run prores -- ${where}`,
        );
      } finally {
        scene.background = sheet;
      }
    } else {
      /*
       * A still comes out on nothing.
       *
       * Which is the point of exporting one: it goes into a layout, over a
       * colour somebody else chooses. The sheet is in the picture on screen
       * because that is what the cards are photographed against, and out of the
       * file because a background baked into a PNG is a background you cannot
       * take off. A video keeps it — H.264 has no alpha to carry, so a frame
       * has to arrive already sitting on something.
       */
      scene.background = null;
      try {
        await savePNG({ canvas, draw: () => drawExport(null), name });
      } finally {
        scene.background = sheet;
      }
      setStatus(`${name}.png · ${size.width}x${size.height} · transparent`);
    }
  } catch (error) {
    console.error("Rayl Wheel: could not export", error);
    setStatus(`export failed: ${error.message}`);
  } finally {
    busy = false;
    cancel = false;
    button.textContent = "Export";
    /* The big sheet goes back where it came from: it is tens of megabytes of
       texture and the preview has no use for it. */
    if (preview) {
      const big = wheel.atlas;
      wheel.setPrint(preview);
      printed = PRINT_SCALE;
      big.dispose();
    }
    renderer.setPixelRatio(ratio);
    resize();
    if (resume) play();
  }
}

/* ------------------------------------------------------------- the frame --- */

let last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!wheel || busy) return;

  /* Running, the loop says where the wheel is and nothing else gets a say. */
  if (playing) {
    clock += dt;
    at = poseAt(clock);
    target = at;
    mark();
  }

  /*
   * Catching up, at a rate that does not depend on the frame rate.
   *
   * A plain lerp per frame is a different spring on a 60hz screen and a 120hz
   * one; this is the same one on both — a fixed share of the remaining
   * distance per second, however many frames that second was cut into.
   */
  const gap = playing ? 0 : target - at;
  if (Math.abs(gap) > 1e-4) {
    at += gap * (1 - Math.pow(0.0015, dt));
    mark();
  } else if (at !== target) {
    at = target;
    mark();
  }

  /* Snapping is what happens when nothing else is: a card the scroll has been
     left near becomes the card it is on, once the hand is off it. */
  if (params.snap === "snap" && !dragging && !playing) {
    settling += dt;
    const rest = Math.round(target);
    if (settling > 0.12 && rest !== target) {
      target = Math.min(Math.max(rest, 0), wheel.span());
      mark();
    }
  }

  if (Math.abs(params.scroll - at) > 0.005) {
    params.scroll = at;
    const control = sliders.get("scroll");
    control.input.value = String(Math.min(Math.max(at, 0), span()));
    control.refresh();
  }

  if (!needs) return;
  needs = false;

  wheel.update({ ...shape(), scroll: at });
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------- arrival --- */

async function start() {
  const [geometry, atlas] = await Promise.all([
    loadCard(new URL("card.glb", document.baseURI).href),
    cardAtlas(),
  ]);

  wheel = new Wheel(scene, geometry, atlas);
  asked = Math.round(params.count);
  wheel.setCount(Math.round(params.count));

  mountPanel();
  /* The panel is markup, so it opens showing the defaults; whatever the link
     asked for is put into it here, once there is something to bind it to. */
  pushPanel();
  showFormat();
  document.getElementById("lensRow").hidden = params.projection === "isometric";
  pushSurface();
  pushLighting();
  fitList();
  resize();

  window.addEventListener("resize", resize);
  requestAnimationFrame(tick);

  await document.fonts.ready;
  document.body.classList.remove("starting");
}

start();

/* A way in from the outside, for a test or a console: the state, the scene and
   the two cameras, live rather than copied. */
window.rayl = {
  params,
  scene,
  renderer,
  get wheel() {
    return wheel;
  },
  get camera() {
    return camera;
  },
  /* The two the suite needs: where the loop is at a given instant, and that
     instant drawn — which is how a seam is looked for without an encoder. */
  pose: (time) => poseAt(time),
  draw: (time) => drawExport(time),
  /* The whole export, against a folder that has already been chosen — the
     picker itself is the one line of it a test cannot click. */
  write: (folder) => beginExport(folder),
  printScale: () => printed,
};
