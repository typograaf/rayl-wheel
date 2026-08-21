import * as THREE from "three";

/**
 * The rig, placed by hand.
 *
 * Three lamps, each a point in space with a handle on screen. Drag a handle and
 * the lamp moves in the plane of the screen, which is the plane you can see and
 * judge. Turn the wheel with one selected and it moves along the view instead —
 * towards you scrolling down, away scrolling up — which is the axis you cannot
 * see and therefore the one that needs a gesture of its own rather than a guess.
 *
 * Translucency is the reason it matters. The term only fires when a lamp is
 * behind the thing it is passing through, so the whole question is where each
 * lamp is relative to the card, one at a time — which is a thing to arrange by
 * hand and not a number to nominate.
 *
 * Positions are in card widths about the middle of the frame, which is where
 * the card at rest is. So a rig stays where it was put when the wheel's radius,
 * spacing or count change: the thing being lit has not moved.
 */

export const LAMPS = [
  { at: "keyAt", label: "key", level: "keyLevel", tint: "keyTint" },
  { at: "fillAt", label: "fill", level: "fillLevel", tint: "fillTint" },
  { at: "edgeAt", label: "edge", level: "edgeLevel", tint: "edgeTint" },
];

/* Where they start — the long tool's own rig. The edge lamp is behind the card
   on purpose: it is the one that lights the far side of it, and so the only one
   the translucency term has anything to work with. */
export const DEFAULT_AT = {
  keyAt: "0.45,0.55,0.80",
  fillAt: "-0.85,0.10,0.45",
  edgeAt: "0.15,0.40,-0.90",
};

/* How close to the frame's edge a handle may sit. A lamp is often outside the
   picture, and a handle you cannot reach is a lamp you cannot move, so one that
   would fall outside is held at the edge instead. */
const EDGE = 16;

/* How far out a lamp may be pushed, in card widths. Past this it is neither
   visible nor recoverable, and the falloff has made it nothing anyway. */
const REACH = 4;

export function parseAt(text) {
  const parts = String(text || "")
    .split(",")
    .map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
}

const formatAt = (v) => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;

const world = new THREE.Vector3();
const projected = new THREE.Vector3();
const forward = new THREE.Vector3();
const offset = new THREE.Vector3();

/**
 * The handles, and the gestures that move them.
 *
 * `onChange` is called whenever a lamp has moved, with `true` when the gesture
 * is over — which is where the link is written, so a drag leaves one entry in
 * the address bar rather than one per frame.
 */
export function mountLamps({ canvas, params, getCamera, onChange }) {
  const layer = document.createElement("div");
  layer.className = "light-layer";
  canvas.parentElement.appendChild(layer);

  const handles = LAMPS.map((lamp) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "light-handle";
    el.dataset.lamp = lamp.at;
    el.innerHTML = `<i></i><span>${lamp.label}</span>`;
    layer.appendChild(el);
    return { lamp, el };
  });

  let selected = null;
  let dragging = null;
  /* The depth the handle was grabbed at. A drag has to stay on the plane the
     lamp is already on, or a sideways move would walk it towards the camera as
     well and the gesture would mean two things at once. */
  let grabbedAt = 0;

  const dark = (lamp) => params[lamp.level] <= 0.001;

  /** Where a lamp is, from what the panel holds. */
  function positionOf(key, target) {
    const at = parseAt(params[key]) || parseAt(DEFAULT_AT[key]);
    return target.set(at[0], at[1], at[2]);
  }

  /** And the other way, once a handle has been dragged somewhere. */
  function storeAt(key, position) {
    world.copy(position);
    if (world.length() > REACH) world.setLength(REACH);
    params[key] = formatAt(world);
  }

  /**
   * How far behind the card a lamp is, in card widths — negative in front.
   *
   * Measured along the view against the plane through the card at rest, because
   * that is the plane it stands on and the one a lamp passes through when it
   * starts lighting it from behind.
   */
  function behindBy(key) {
    getCamera().getWorldDirection(forward);
    return positionOf(key, world).dot(forward);
  }

  function update() {
    const camera = getCamera();
    const rect = canvas.getBoundingClientRect();
    const frame = canvas.parentElement.getBoundingClientRect();
    const left = rect.left - frame.left;
    const top = rect.top - frame.top;

    for (const handle of handles) {
      positionOf(handle.lamp.at, world);
      projected.copy(world).project(camera);
      /* Behind the camera the projection folds through the origin, so the sign
         has to be put back by hand or the handle appears on the wrong side. */
      const behind = projected.z > 1;
      const flip = behind ? -1 : 1;
      const rawX = left + ((projected.x * flip + 1) / 2) * rect.width;
      const rawY = top + ((1 - projected.y * flip) / 2) * rect.height;
      const x = THREE.MathUtils.clamp(
        rawX,
        left + EDGE,
        left + rect.width - EDGE,
      );
      const y = THREE.MathUtils.clamp(
        rawY,
        top + EDGE,
        top + rect.height - EDGE,
      );

      handle.el.style.transform = `translate(${x}px, ${y}px)`;
      handle.el.dataset.edge = String(x !== rawX || y !== rawY || behind);
      handle.el.dataset.off = String(dark(handle.lamp));
      handle.el.dataset.selected = String(selected === handle.lamp.at);
      /*
       * And how far behind, eased, so that crossing the card is a change you can
       * see and going further back after that is a change you can keep seeing.
       * The dot empties out as it goes: which side of the card a lamp is on is
       * the question the whole gesture is asking.
       */
      const depth = behindBy(handle.lamp.at);
      handle.el.style.setProperty(
        "--behind",
        (1 - 1 / (1 + Math.max(depth, 0) * 2.2)).toFixed(3),
      );
    }
  }

  const pick = (event) => {
    const found = event.target.closest(".light-handle");
    return found ? handles.find((h) => h.el === found) : null;
  };

  layer.addEventListener("pointerdown", (event) => {
    const handle = pick(event);
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    selected = handle.lamp.at;
    dragging = handle;
    positionOf(handle.lamp.at, world);
    grabbedAt = THREE.MathUtils.clamp(
      projected.copy(world).project(getCamera()).z,
      -0.999,
      0.999,
    );
    layer.setPointerCapture(event.pointerId);
    update();
  });

  layer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    /* Unprojected at the depth it was grabbed at, which puts the lamp exactly
       under the pointer whichever projection is up. */
    projected.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      grabbedAt,
    );
    projected.unproject(getCamera());
    storeAt(dragging.lamp.at, projected);
    update();
    onChange();
  });

  const release = (event) => {
    if (!dragging) return;
    dragging = null;
    if (layer.hasPointerCapture(event.pointerId))
      layer.releasePointerCapture(event.pointerId);
    onChange(true);
  };
  layer.addEventListener("pointerup", release);
  layer.addEventListener("pointercancel", release);

  /* Anywhere that is not a handle puts the rig down again, so the wheel goes
     back to being the scroll. */
  canvas.addEventListener("pointerdown", () => {
    if (selected === null) return;
    selected = null;
    update();
  });

  return {
    update,
    positionOf,

    /** True if the wheel belonged to a selected lamp rather than to the list. */
    wheel(step) {
      if (selected === null) return false;
      const lamp = LAMPS.find((l) => l.at === selected);
      if (!lamp || dark(lamp)) return false;
      const camera = getCamera();
      positionOf(selected, world);

      /*
       * Along the ray the handle sits on, rather than along the view.
       *
       * They are the same line only for a lamp dead centre. Anywhere else,
       * travelling parallel to the view walks the lamp towards the vanishing
       * point as it recedes — keep scrolling and every handle drifts into the
       * middle of the picture, taking the rig you placed with it. On its own
       * ray it keeps its place in the frame and only its depth changes, which
       * is the one thing the wheel is being asked for. Flat, there is no
       * vanishing point and the ray is the view, so it is the same gesture in
       * both projections.
       */
      camera.getWorldDirection(forward);
      if (camera.isPerspectiveCamera) {
        forward.copy(world).sub(camera.position).normalize();
      }

      /* Where the bound falls on this ray, so a lamp at the end of its travel
         stops there rather than being pulled back towards the middle — which
         would move it across the frame. */
      offset.copy(world);
      const along = offset.dot(forward);
      const disc = along * along - (offset.lengthSq() - REACH * REACH);
      const edge = disc > 0 ? Math.sqrt(disc) : 0;

      // scrolling down brings it towards you, away from the camera scrolling up
      const travel = -step * 0.0016;
      world.addScaledVector(
        forward,
        THREE.MathUtils.clamp(travel, -along - edge, -along + edge),
      );
      storeAt(selected, world);
      update();
      onChange(true);
      return true;
    },

    /** Handles are markup, not scene, so they never reach an export — but they
        are still in the way of looking at the picture. */
    setVisible(visible) {
      layer.dataset.hidden = String(!visible);
    },
  };
}
