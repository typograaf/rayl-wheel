/**
 * The colour picker.
 *
 * The swatches were native colour inputs, which hand the whole interaction to
 * the system's colour panel: a window from another application, in another
 * language, that takes the keyboard with it and cannot be pasted into without
 * hunting for the right tab. This is the same thing built out of the panel it
 * lives in — a square for saturation and value, a bar for hue, and a field
 * showing the hex, which is the one people actually reach for.
 *
 * The input itself stays, hidden behind the swatch, and goes on being where the
 * value lives. Everything downstream — the settings string, the undo history,
 * pasting onto a swatch — reads it exactly as it did.
 */

const SQUARE = 170;
const SQUARE_TALL = 120;

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ];
}

const hex2 = (v) =>
  Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, "0");

const rgbToHex = ([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function rgbToHsv([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  let h = 0;
  if (span > 0) {
    if (max === r) h = ((g - b) / span + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / span + 2) / 6;
    else h = ((r - g) / span + 4) / 6;
  }
  return [h, max === 0 ? 0 : span / max, max];
}

function hsvToRgb([h, s, v]) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  return table[i % 6];
}

/**
 * One picker, lent to whichever swatch asks for it.
 *
 * Anchored to the swatch and fixed to the window rather than placed in the
 * panel, because the panel scrolls and clips and a picker that goes under its
 * own edge is worse than no picker.
 */
export function mountColourPicker() {
  const popover = document.createElement("div");
  popover.className = "picker";
  popover.hidden = true;
  popover.innerHTML = `
    <div class="picker-square"><i></i></div>
    <div class="picker-hue"><i></i></div>
    <input class="picker-hex" spellcheck="false" />
  `;
  document.body.appendChild(popover);

  const square = popover.querySelector(".picker-square");
  const squareDot = square.querySelector("i");
  const hue = popover.querySelector(".picker-hue");
  const hueDot = hue.querySelector("i");
  const field = popover.querySelector(".picker-hex");

  let target = null;
  /* Hue is kept here rather than read back from the colour: at the black and
     white edges of the square every hue gives the same answer, so a colour
     cannot say which one you were on, and dragging into a corner would lose the
     hue you had picked. */
  let hsv = [0, 0, 0];

  function show() {
    const [h, s, v] = hsv;
    square.style.background =
      `linear-gradient(to top, #000, rgba(0,0,0,0)),` +
      `linear-gradient(to right, #fff, ${rgbToHex(hsvToRgb([h, 1, 1]))})`;
    squareDot.style.left = `${s * SQUARE}px`;
    squareDot.style.top = `${(1 - v) * SQUARE_TALL}px`;
    hueDot.style.left = `${h * SQUARE}px`;
    const hex = rgbToHex(hsvToRgb(hsv));
    if (document.activeElement !== field) field.value = hex;
    return hex;
  }

  function commit() {
    const hex = show();
    if (!target) return;
    target.value = hex;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /* One gesture handler for both: press, drag anywhere, release anywhere — a
     pointer that leaves the square mid-drag should go on picking, the way every
     other handle in this tool does. */
  function drags(element, onMove) {
    element.addEventListener("pointerdown", (event) => {
      element.setPointerCapture(event.pointerId);
      const move = (e) => {
        const box = element.getBoundingClientRect();
        onMove(
          Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
          Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
        );
        commit();
      };
      move(event);
      const stop = () => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", stop);
        element.removeEventListener("pointercancel", stop);
      };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", stop);
      element.addEventListener("pointercancel", stop);
    });
  }

  drags(square, (x, y) => {
    hsv = [hsv[0], x, 1 - y];
  });
  drags(hue, (x) => {
    hsv = [x, hsv[1], hsv[2]];
  });

  /* The field takes anything a colour could reasonably be written as, and says
     nothing about what it cannot read until it is left alone. */
  const readField = () => {
    const found = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(field.value.trim());
    if (!found) return false;
    hsv = rgbToHsv(hexToRgb(found[1]));
    commit();
    return true;
  };
  field.addEventListener("input", readField);
  field.addEventListener("blur", () => {
    if (!readField()) show();
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") field.blur();
    if (event.key === "Escape") close();
    event.stopPropagation();
  });

  function place(swatch) {
    const box = swatch.getBoundingClientRect();

    /*
     * A swatch that has scrolled out of the panel has nothing to anchor to, and
     * clamping to the corner is not a fallback — it puts the picker over the
     * window's own buttons, still holding a colour you can no longer see the
     * swatch of. It closes instead.
     */
    if (
      box.width === 0 ||
      box.bottom < 8 ||
      box.top > window.innerHeight - 8 ||
      box.right < 8 ||
      box.left > window.innerWidth - 8
    ) {
      close();
      return;
    }

    popover.hidden = false;
    const size = popover.getBoundingClientRect();
    /* Below it if there is room, above it if not — and never off either edge. */
    const below = box.bottom + 8;
    const top =
      below + size.height <= window.innerHeight - 12
        ? below
        : Math.max(12, box.top - size.height - 8);
    const left = Math.min(
      Math.max(12, box.right - size.width),
      window.innerWidth - size.width - 12,
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  function close() {
    popover.hidden = true;
    target = null;
  }

  function open(swatch) {
    target = swatch;
    hsv = rgbToHsv(hexToRgb(swatch.value));
    place(swatch);
    show();
  }

  /*
   * Anywhere else closes it, and so does Escape.
   *
   * Pointerdown rather than click, so it is gone by the time whatever was
   * pressed responds — and in the capture phase, because half the things worth
   * clicking on stop the event before it reaches the document. A light handle
   * swallows its own pointerdown; so would anything else added later. Listening
   * on the way down means it never matters what a target does with it.
   */
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (popover.hidden) return;
      if (popover.contains(event.target) || event.target === target) return;
      close();
    },
    true,
  );

  /* A scrolling panel moves the swatch out from under it, so it follows rather
     than closing. Closing was worse than it sounds: reaching a swatch far down
     the panel scrolls to it, and that scroll shut the picker the click had just
     opened. */
  document.addEventListener(
    "scroll",
    () => {
      if (target) place(target);
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) close();
  });
  window.addEventListener("resize", () => {
    if (target) place(target);
  });

  return {
    open,
    close,
    get isOpen() {
      return !popover.hidden;
    },
  };
}
