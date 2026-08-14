#!/usr/bin/env node
// Human Inside — delayed publisher.
// Watches the local HLS output and publishes to Vercel Blob ONLY segments that
// are older than DELAY_SECONDS. This is the safety buffer made concrete: nothing
// reaches the public playlist until it has aged past the delay window, giving the
// broadcaster time to hit panic before any given moment goes public.
//
// Env:
//   BLOB_READ_WRITE_TOKEN  — Vercel Blob token (vercel blob generate or dashboard)
//   DELAY_SECONDS          — how far behind real time (default 45)
//   OUT_DIR                — local capture dir (default ./capture-out)
//   PUBLIC_BASE            — public base path for segments (default derived)
//
// The public playlist is written LAST, referencing only already-uploaded (aged)
// segments — so a viewer never sees a segment url that points at fresh footage.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { put } from "@vercel/blob";

const DELAY = Number(process.env.DELAY_SECONDS ?? 45);
const OUT_DIR = process.env.OUT_DIR ?? "./capture-out";
const SEG_SECONDS = Number(process.env.SEG_SECONDS ?? 2);
const PREFIX = "stream";
const POLL_MS = 1000;

const uploaded = new Map(); // seg filename -> public url
let stopped = false;

async function uploadSegment(file) {
  if (uploaded.has(file)) return uploaded.get(file);
  const buf = await readFile(join(OUT_DIR, file));
  const { url } = await put(`${PREFIX}/${file}`, buf, {
    access: "public",
    contentType: "video/mp2t",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000, // segments are immutable once written
  });
  uploaded.set(file, url);
  return url;
}

async function publishPlaylist(segments) {
  // Build a fresh media playlist over the aged segments. Sliding window of the
  // last N so the file (and viewer buffer) stays bounded.
  const WINDOW = 90; // ~90 segments visible; older ones drop off
  const slice = segments.slice(-WINDOW);
  const mediaSeq = Math.max(0, segments.length - slice.length);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(SEG_SECONDS)}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSeq}`,
  ];
  for (const s of slice) {
    lines.push(`#EXTINF:${SEG_SECONDS.toFixed(3)},`);
    lines.push(uploaded.get(s));
  }
  const body = lines.join("\n") + "\n";
  const { url } = await put(`${PREFIX}/stream.m3u8`, body, {
    access: "public",
    contentType: "application/vnd.apple.mpegurl",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0, // playlist must always be fresh
  });
  return url;
}

async function tick() {
  let files;
  try {
    files = (await readdir(OUT_DIR)).filter((f) => /^seg_\d+\.ts$/.test(f)).sort();
  } catch {
    return; // capture hasn't started yet
  }
  const now = Date.now();
  const aged = [];
  for (const f of files) {
    try {
      const s = await stat(join(OUT_DIR, f));
      // Age from the segment's mtime — only publish once it's older than DELAY.
      if (now - s.mtimeMs >= DELAY * 1000) aged.push(f);
    } catch {
      /* file rotated away mid-scan */
    }
  }
  if (aged.length === 0) return;

  for (const f of aged) await uploadSegment(f);
  const url = await publishPlaylist(aged);
  process.stdout.write(
    `\rpublished ${aged.length} aged segs · delay ${DELAY}s · ${url.split("/").slice(-1)[0]}     `
  );
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Missing BLOB_READ_WRITE_TOKEN. Run: vercel env pull, or set it inline.");
    process.exit(1);
  }
  console.log(`Human Inside · delayed publisher · ${DELAY}s behind · dir=${OUT_DIR}`);
  console.log("Set the printed stream.m3u8 URL in /control, then Go Live.\n");
  while (!stopped) {
    await tick().catch((e) => console.error("\ntick error:", e.message));
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

process.on("SIGINT", () => {
  stopped = true;
  console.log("\nstopped publishing. (capture keeps running until you stop ffmpeg)");
  process.exit(0);
});

main();
