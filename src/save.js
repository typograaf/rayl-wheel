import { recordMP4, mp4Supported, evenSize } from "./record.js";

/**
 * Getting a picture out of the tab.
 *
 * A still and a loop, and both of them drawn rather than captured: the frame is
 * rendered at whatever size was asked for and read immediately, so what comes
 * out is the picture at that size and not the preview scaled up. The video is
 * stepped at a fixed 1/fps for the same reason — see record.js, where the
 * argument against MediaRecorder is made properly.
 */

export { mp4Supported, evenSize };

/**
 * What a file coming out of here is called.
 *
 * Which way it was drawn, and when — `wheel_perspective_2026-08-19_14_20`. A
 * folder of these sorts into what it is and then into when, which is the order
 * anybody looking for one goes in.
 *
 * Local time, pulled apart by hand rather than sliced off an ISO string, which
 * is UTC and would put an evening's work under tomorrow's date.
 */
export function exportName(projection) {
  const now = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const when =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}_${pad(now.getMinutes())}`;
  return `wheel_${projection}_${when}`;
}

/** In a tab, a download is an anchor with a `download` on it. */
export function deliver(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * One frame, at size, as a PNG.
 *
 * `draw()` has to leave the finished picture on `canvas`: it is read in the
 * same turn, so nothing may be left pending on it.
 */
export async function savePNG({ canvas, draw, name }) {
  draw();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("the frame came back empty");
  deliver(`${name}.png`, blob);
  return blob.size;
}

/**
 * One turn of the loop, as an MP4.
 *
 * `draw(time)` is handed seconds into the loop and has to leave that instant on
 * the canvas — no spring, no wall clock, nothing that carries from the frame
 * before, or the file holds a transient where the loop closes.
 */
export async function saveMP4({
  canvas,
  width,
  height,
  fps,
  seconds,
  quality,
  draw,
  onProgress,
  shouldStop,
  name,
}) {
  const blob = await recordMP4({
    canvas,
    width,
    height,
    fps,
    seconds,
    quality,
    drawFrame: draw,
    onProgress,
    shouldStop,
  });
  if (!blob) return 0;
  deliver(`${name}.mp4`, blob);
  return blob.size;
}
