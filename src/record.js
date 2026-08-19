import { Muxer, ArrayBufferTarget } from "mp4-muxer";

/**
 * MP4, written in the page.
 *
 * Not MediaRecorder. That records the canvas *as it is painted*, in real time,
 * so the file inherits every frame the machine was too slow to make — and a
 * render heavy enough to be worth recording is exactly the one that drops them.
 * It also gives WebM on most browsers, which is not what was asked for.
 *
 * WebCodecs instead: the scene is stepped by a fixed 1/fps and each frame is
 * handed to a hardware H.264 encoder, so the clock in the file is the clock the
 * animation was authored to and the wall clock is free to take as long as it
 * likes. mp4-muxer wraps the encoded chunks into the container.
 */

/** Even dimensions only — H.264 encodes in 16x16 macroblocks over a 4:2:0 plane. */
export function evenSize(width, height) {
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  };
}

export function mp4Supported() {
  return (
    typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined"
  );
}

/*
 * Level has to cover the frame size, and asking for one too low is a hard
 * configure failure rather than a downgrade — so the levels are tried in order
 * and the first the machine accepts is used. High profile first for quality,
 * then main, then baseline for anything old.
 */
const CODECS = ["avc1.640034", "avc1.640028", "avc1.4d0034", "avc1.42003c"];

async function pickCodec(width, height, framerate, bitrate) {
  for (const codec of CODECS) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        framerate,
        bitrate,
      });
      if (supported) return codec;
    } catch {
      // this one is not a string the browser knows: try the next
    }
  }
  return null;
}

/**
 * Render `seconds` of animation and return it as an MP4 blob.
 *
 * `drawFrame(time)` has to leave the finished frame on `canvas` — it is read
 * immediately after, synchronously, so nothing may be left pending on it.
 */
export async function recordMP4({
  canvas,
  width,
  height,
  fps = 30,
  seconds = 6,
  quality = 12,
  drawFrame,
  onProgress,
  shouldStop,
}) {
  if (!mp4Supported())
    throw new Error("this browser has no WebCodecs video encoder");

  const total = Math.max(1, Math.round(fps * seconds));
  // megabits per second, scaled by frame area: the same number should not mean
  // the same bitrate for a 720p frame and a 4K one
  const bitrate = Math.round(
    ((quality * 1e6) / (1920 * 1080)) * width * height,
  );

  const codec = await pickCodec(width, height, fps, bitrate);
  if (!codec) throw new Error(`no H.264 encoder for ${width}x${height}`);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory", // so the file plays without being fully downloaded
  });

  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error;
    },
  });
  encoder.configure({ codec, width, height, framerate: fps, bitrate });

  try {
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      if (shouldStop && shouldStop()) return null;

      drawFrame(i / fps);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps),
      });
      // a keyframe every two seconds, so scrubbing lands somewhere
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      if (onProgress) onProgress(i + 1, total);

      /* Let the encoder drain. Queueing every frame at once holds the whole
         uncompressed sequence in memory, and a long 4K record runs the tab out
         of it long before the encoder is behind. */
      if (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => {
          encoder.addEventListener("dequeue", resolve, { once: true });
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
