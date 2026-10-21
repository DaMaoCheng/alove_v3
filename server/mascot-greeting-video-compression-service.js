import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const VIDEO_COMPRESSION_TIMEOUT_MS = 120_000;
const MAX_ERROR_OUTPUT_LENGTH = 2_000;

export async function compressMascotGreetingVideo(buffer) {
  const workspace = await mkdtemp(join(tmpdir(), "alove-mascot-greeting-video-"));
  const inputPath = join(workspace, "input.mp4");
  const outputPath = join(workspace, "output.mp4");

  try {
    await writeFile(inputPath, buffer);
    await runFfmpeg([
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-vf", "scale='min(720,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'",
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return await readFile(outputPath);
  } catch (error) {
    const serviceError = new Error("问候视频压缩失败，请上传有效的 MP4 视频");
    serviceError.statusCode = 400;
    serviceError.cause = error;
    throw serviceError;
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegInstaller.path, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("FFmpeg video compression timed out"));
    }, VIDEO_COMPRESSION_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => {
      if (errorOutput.length >= MAX_ERROR_OUTPUT_LENGTH) return;
      errorOutput += String(chunk || "").slice(0, MAX_ERROR_OUTPUT_LENGTH - errorOutput.length);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorOutput.trim() || `FFmpeg exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`));
    });
  });
}
