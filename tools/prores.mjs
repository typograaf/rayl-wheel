/**
 * A folder of frames into a ProRes 4444 with its alpha intact.
 *
 *   npm run prores -- ~/Desktop/renders
 *   npm run prores -- ~/Desktop/renders 24
 *
 * The tool writes the loop as numbered transparent PNGs and this turns them
 * into the movie. Which is a step, and it is a step because the browser cannot
 * do it: WebCodecs has no ProRes encoder — not under any of the fourccs it goes
 * by — and Chrome will not encode alpha at all, in any codec it does have. The
 * choice was this or thirty megabytes of ffmpeg compiled to wasm sitting in a
 * tool whose whole point is that it comes up in a tab. So the frames come out
 * of the browser, which is what a browser is good for, and the encoding happens
 * where an encoder already is.
 *
 * 4444 rather than 422, because 422 has no alpha channel to put anything in.
 * Sixteen bits of it, straight rather than premultiplied — which is what a
 * canvas hands over and what a compositor expects, so nothing has to be undone
 * at either end.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [folderArg, fpsArg] = process.argv.slice(2);

if (!folderArg) {
  console.error("which folder? — npm run prores -- <folder of frames> [fps]");
  process.exit(1);
}

const folder = path.resolve(folderArg.replace(/^~/, process.env.HOME));
if (!fs.existsSync(folder)) {
  console.error(`no folder at ${folder}`);
  process.exit(1);
}

const fps = Number(fpsArg) || 30;

if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).error) {
  console.error("no ffmpeg on the path — brew install ffmpeg");
  process.exit(1);
}

/*
 * Which sequences are in there, by name.
 *
 * A frame is a name and four digits, so the name is what groups them. A folder
 * with two exports in it gets two movies rather than one movie of whichever
 * export sorted first, which is the failure that would be found at the far end
 * of a long render.
 */
const frames = fs
  .readdirSync(folder)
  .filter((name) => /_\d{4}\.png$/.test(name))
  .sort();

if (!frames.length) {
  console.error(`no numbered frames in ${folder}`);
  process.exit(1);
}

const sequences = new Map();
for (const name of frames) {
  const stem = name.replace(/_\d{4}\.png$/, "");
  if (!sequences.has(stem)) sequences.set(stem, []);
  sequences.get(stem).push(name);
}

const run = (args) =>
  new Promise((resolve, reject) => {
    const job = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let said = "";
    job.stderr.on("data", (chunk) => (said += chunk));
    job.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(said.trim().split("\n").pop())),
    );
  });

for (const [stem, list] of sequences) {
  const out = path.join(folder, `${stem}.mov`);
  const first = Number(list[0].match(/_(\d{4})\.png$/)[1]);
  process.stdout.write(`${stem}: ${list.length} frames at ${fps}fps ... `);
  try {
    await run([
      "-y",
      "-framerate",
      String(fps),
      "-start_number",
      String(first),
      "-i",
      path.join(folder, `${stem}_%04d.png`),
      "-c:v",
      "prores_ks",
      "-profile:v",
      "4444",
      "-pix_fmt",
      "yuva444p10le",
      "-alpha_bits",
      "16",
      /* Straight, not premultiplied: a canvas hands over unmultiplied pixels
         and ffmpeg would otherwise assume the other thing about the file. */
      "-vendor",
      "apl0",
      "-qscale:v",
      "9",
      out,
    ]);
    const size = fs.statSync(out).size;
    console.log(`${(size / 1e6).toFixed(1)}MB → ${out}`);
  } catch (error) {
    console.log("failed");
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}
