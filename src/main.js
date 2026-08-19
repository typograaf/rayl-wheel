import * as THREE from "three";
import { loadCard } from "./card.js";
import { cardAtlas } from "./cardart.js";
import { Wheel, CARD_HEIGHT } from "./wheel.js";
import { backdrop, Lighting } from "./environment.js";
import { mountTrack } from "./track.js";

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
  /* Opened part-way down the list rather than at the top of it: at nought the
     wheel is a card and an empty frame, which is the truth about the first item
     in a list and tells you nothing about the wheel. */
  scroll: 4,
};

const params = { ...DEFAULTS };

const canvas = document.getElementById("stage");
const frame = document.querySelector(".frame");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = backdrop();

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
  const pad = 48;
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
      mark();
    });
  }
  sliders.set(name, { show, refresh: show });
  show();
}

/* The scroll runs from the first card to the last, so its own track has to be
   recut whenever there are more or fewer of them. */
function relimit() {
  const span = wheel ? wheel.span() : 0;
  const input = document.getElementById("scroll");
  input.max = String(span);
  target = Math.min(target, span);
  at = Math.min(at, span);
  params.scroll = at;
  input.value = String(at);
  sliders.get("scroll").refresh();
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
    wheel.setCount(Math.round(params.count));
    pushSurface();
    relimit();
  });
  bindSlider("depth", "depth", 2);
  bindSlider("roughness", "roughness", 2, pushSurface);

  const colour = document.getElementById("colour");
  colour.addEventListener("input", () => {
    params.colour = colour.value;
    pushSurface();
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
    target = params.scroll;
    at = params.scroll;
    settling = 0;
  });

  document.getElementById("lensRow").hidden = params.projection === "isometric";

  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(params, DEFAULTS);
    for (const [key, control] of sliders) {
      if (control.input) control.input.value = String(params[key]);
      control.refresh();
    }
    wheel.setCount(Math.round(params.count));
    target = at = params.scroll;
    document.getElementById("lensRow").hidden =
      params.projection === "isometric";
    place();
    pushSurface();
    pushLighting();
    relimit();
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
  const span = wheel ? wheel.span() : 0;
  target = Math.min(Math.max(target + by, 0), span);
  settling = 0;
  mark();
}

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

/* ------------------------------------------------------------- the frame --- */

let last = performance.now();

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!wheel) return;

  /*
   * Catching up, at a rate that does not depend on the frame rate.
   *
   * A plain lerp per frame is a different spring on a 60hz screen and a 120hz
   * one; this is the same one on both — a fixed share of the remaining
   * distance per second, however many frames that second was cut into.
   */
  const gap = target - at;
  if (Math.abs(gap) > 1e-4) {
    at += gap * (1 - Math.pow(0.0015, dt));
    mark();
  } else if (at !== target) {
    at = target;
    mark();
  }

  /* Snapping is what happens when nothing else is: a card the scroll has been
     left near becomes the card it is on, once the hand is off it. */
  if (params.snap === "snap" && !dragging) {
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
    control.input.value = String(at);
    control.refresh();
  }

  if (!needs) return;
  needs = false;

  wheel.update({
    radius: params.radius,
    spacing: params.spacing,
    arc: params.arc,
    fade: params.fade,
    scroll: at,
    thickness: params.depth,
  });
  renderer.render(scene, camera);
}

/* --------------------------------------------------------------- arrival --- */

async function start() {
  const [geometry, atlas] = await Promise.all([
    loadCard(new URL("card.glb", document.baseURI).href),
    cardAtlas(),
  ]);

  wheel = new Wheel(scene, geometry, atlas);
  wheel.setCount(Math.round(params.count));

  mountPanel();
  pushSurface();
  pushLighting();
  relimit();
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
};
