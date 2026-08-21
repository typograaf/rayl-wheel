/**
 * The whole state of the tool, in the address bar.
 *
 * Every control writes here, so a reload comes back to the picture that was on
 * screen and a link is a look somebody else can open. Written with
 * `replaceState` rather than by setting the hash, so a slider does not leave
 * two hundred entries in the back button behind it.
 *
 * Everything goes in, including whatever happens to be at its default. A string
 * that only carries what was changed reads better and means less: the day a
 * default moves, every link written before it quietly becomes a different
 * picture. This way what was saved is what comes back.
 *
 * Read forgivingly, though. Each value is checked on its own and a bad one is
 * dropped rather than taking the rest of the string down with it, because the
 * alternative — refusing the lot — turns one stale key into a tool that opens
 * on defaults and says nothing about why.
 */

/* Three numbers with commas between them: where a lamp is. */
const isPlace = (text) => {
  const parts = String(text).split(",");
  return (
    parts.length === 3 && parts.every((n) => Number.isFinite(parseFloat(n)))
  );
};

const number = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/* Rounded on the way out: a scroll carries fifteen decimals of spring and none
   of them are a setting. */
const tidy = (v) => String(+v.toFixed(4));

export function serialize(params) {
  return Object.keys(params)
    .map((key) => {
      const value = params[key];
      const text = typeof value === "number" ? tidy(value) : String(value);
      return `${key}=${encodeURIComponent(text)}`;
    })
    .join("&");
}

/**
 * What a string says, checked against what the panel can actually take.
 *
 * The controls are the schema: a slider's own min and max decide what a number
 * is allowed to be, and a row of buttons decides what a word is allowed to be.
 * So a link cannot ask for a count of nine thousand or a rig nobody built, and
 * nothing here has to keep a second copy of those limits in step.
 */
export function deserialize(text, params) {
  const found = {};
  for (const pair of String(text).replace(/^#/, "").split("&")) {
    if (!pair) continue;
    const cut = pair.indexOf("=");
    if (cut < 0) continue;
    const key = decodeURIComponent(pair.slice(0, cut));
    const raw = decodeURIComponent(pair.slice(cut + 1));
    if (!(key in params)) continue;

    if (typeof params[key] === "number") {
      const value = number(raw);
      if (value === null) continue;
      const input = document.getElementById(key);
      const low = input ? parseFloat(input.min) : -Infinity;
      const high = input ? parseFloat(input.max) : Infinity;
      found[key] = Math.min(Math.max(value, low), high);
    } else {
      const row = document.querySelector(`[data-select="${key}"]`);
      if (row) {
        if (!row.querySelector(`.btn[data-value="${CSS.escape(raw)}"]`))
          continue;
      } else if (!/^#[0-9a-fA-F]{6}$/.test(raw) && !isPlace(raw)) {
        /* Which leaves the strings with no row of buttons behind them: a
           colour, or a lamp's position. Anything else is not one of ours. */
        continue;
      }
      found[key] = raw;
    }
  }
  return found;
}
