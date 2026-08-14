#!/usr/bin/env node
// Human Inside — delayed publisher.
// Watches the local HLS output and publishes to Vercel Blob ONLY segments that
// are older than DELAY_SECONDS. This is the safety buffer made concrete: nothing
// reaches the public playlist until it has aged past the delay window, giving the
// broadcaster time to hit panic before any given moment goes public.
//
// The publisher is a subscriber of the control plane: it polls /api/session and
// only publishes while the session is LIVE. Panic (blackout) makes it stop,
// tombstone the public playlist, and DELETE the segments it already published —
// severing the pipe itself, not just the front-end pointer to it. If the session
// endpoint can't be reached, it fails closed and publishes nothing.
//
// Env:
//   BLOB_READ_WRITE_TOKEN  — Vercel Blob token (vercel env pull, or dashboard)
//   SESSION_URL            — the app's /api/session endpoint (required)
//   DELAY_SECONDS          — how far behind real time (default 45)
//   OUT_DIR                — local capture dir (default ./capture-out)
//
// The public playlist is written LAST, referencing only already-uploaded (aged)
// segments — so a viewer never sees a segment url that points at fresh footage.
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { put, del } from "@vercel/blob";

const DELAY = Number(process.env.DELAY_SECONDS ?? 45);
const OUT_DIR = process.env.OUT_DIR ?? "./capture-out";
const SEG_SECONDS = Number(process.env.SEG_SECONDS ?? 2);
const SESSION_URL = process.env.SESSION_URL;
const PREFIX = "stream";
const POLL_MS = 1000;

const uploaded = new Map(); // seg filename -> public url
let playlistUrl = null;
let tombstoned = false; // public playlist currently shows ENDLIST-and-nothing
let panicAtMs = null; // segments recorded before this moment NEVER publish
let stopped = false;

async function fetchSession() {
  try {
    const res = await fetch(SESSION_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // unreachable → caller fails closed
  }
}

async function uploadSegment(file) {
  if (uploaded.has(file)) return uploaded.get(file);
  const buf = await readFile(join(OUT_DIR, file));
  const { url } = await put(`${PREFIX}/${file}`, buf, {
    access: "public",
    contentType: "video/mp2t",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 31536000, // immutable while published; deleted on panic
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

// Overwrite the public playlist with an ended, empty one. Already-connected
// players stop; the fixed .m3u8 url goes dead even for someone who saved it.
async function tombstonePlaylist() {
  const body = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${Math.ceil(SEG_SECONDS)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-ENDLIST",
  ].join("\n") + "\n";
  const { url } = await put(`${PREFIX}/stream.m3u8`, body, {
    access: "public",
    contentType: "application/vnd.apple.mpegurl",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  tombstoned = true;
  return url;
}

// Panic: the recent past is what most needs to disappear. Delete every segment
// this run has published (the map is this run's full public footprint).
async function eraseUploaded() {
  const urls = [...uploaded.values()];
  if (urls.length) await del(urls);
  uploaded.clear();
}

let lastPublishedCount = 0;

async function tick() {
  const session = await fetchSession();
  if (!session) {
    process.stdout.write("\rsession endpoint unreachable — publishing nothing     ");
    return; // fail closed: never publish blind
  }

  if (session.blackout) {
    if (!tombstoned || uploaded.size) {
      panicAtMs = Date.now(); // everything recorded up to now stays private forever
      await tombstonePlaylist();
      await eraseUploaded();
      lastPublishedCount = 0;
      console.log("\nPANIC observed — playlist tombstoned, published segments deleted.");
      console.log("Footage recorded before this moment will not publish, even after a new Go Live.");
    }
    process.stdout.write("\rblackout — holding dark                              ");
    return;
  }

  if (!session.live) {
    if (!tombstoned) {
      await tombstonePlaylist();
      lastPublishedCount = 0;
      console.log("\nsession not live — playlist tombstoned; waiting for Go Live.");
    }
    process.stdout.write("\roffline — waiting for Go Live                        ");
    return;
  }

  // LIVE: publish segments that have aged past the delay window.
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
      // Anything recorded before a panic stays private, even across re-Go-Live.
      if (panicAtMs !== null && s.mtimeMs <= panicAtMs) continue;
      if (now - s.mtimeMs >= DELAY * 1000) aged.push(f);
    } catch {
      /* file rotated away mid-scan */
    }
  }
  if (aged.length === 0) return;

  for (const f of aged) await uploadSegment(f);
  if (aged.length !== lastPublishedCount || tombstoned) {
    playlistUrl = await publishPlaylist(aged);
    tombstoned = false;
    lastPublishedCount = aged.length;
  }
  process.stdout.write(
    `\rpublished ${aged.length} aged segs · delay ${DELAY}s · ${playlistUrl.split("/").slice(-1)[0]}     `
  );
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Missing BLOB_READ_WRITE_TOKEN. Run: vercel env pull, or set it inline.");
    process.exit(1);
  }
  if (!SESSION_URL) {
    console.error(
      "Missing SESSION_URL (the app's /api/session endpoint, e.g. https://humaninside.dev/api/session).\n" +
        "The publisher refuses to run without the control plane — panic must be able to reach it."
    );
    process.exit(1);
  }
  console.log(`Human Inside · delayed publisher · ${DELAY}s behind · dir=${OUT_DIR}`);
  console.log(`  control plane: ${SESSION_URL}`);

  // Publish the tombstone up front: it claims the fixed playlist url so we can
  // print it for /control before anything is live (players see an ended stream).
  const session = await fetchSession();
  if (!session) {
    console.error("Cannot reach SESSION_URL — check the deploy, then rerun.");
    process.exit(1);
  }
  if (!session.live) {
    playlistUrl = await tombstonePlaylist();
  }
  console.log(`  stream url:    ${playlistUrl ?? "(live session in progress — publishing resumes)"}`);
  console.log("Set the stream url in /control, then Go Live.\n");

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
