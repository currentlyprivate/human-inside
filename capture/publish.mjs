#!/usr/bin/env node
// Human Inside — delayed publisher.
// Watches the local HLS output and uploads to Vercel Blob ONLY segments that
// are older than DELAY_SECONDS. This is the safety buffer made concrete: nothing
// reaches the public until it has aged past the delay window, giving the
// broadcaster time to hit panic before any given moment goes public.
//
// The publisher never writes a playlist — the app builds one on demand by
// listing the segments (mutable blob overwrites are eventually consistent and
// far too slow for live HLS). Segments live under a per-run random prefix, so
// a past session's urls die with the session.
//
// The publisher is a subscriber of the control plane: it polls /api/session and
// only uploads while the session is LIVE. Panic (blackout) makes it stop,
// DELETE everything it published, and refuse to ever publish footage recorded
// before the panic moment. If the session endpoint can't be reached, it fails
// closed and uploads nothing.
//
// Env:
//   BLOB_READ_WRITE_TOKEN  — Vercel Blob token (vercel env pull, or dashboard)
//   SESSION_URL            — the app's /api/session endpoint (required)
//   DELAY_SECONDS          — how far behind real time (default 45)
//   OUT_DIR                — local capture dir (default ./capture-out)
import { randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { put, del, list } from "@vercel/blob";

const DELAY = Number(process.env.DELAY_SECONDS ?? 45);
const OUT_DIR = process.env.OUT_DIR ?? "./capture-out";
const SESSION_URL = process.env.SESSION_URL;
const RUN_ID = randomBytes(4).toString("hex");
const PREFIX = `stream/${RUN_ID}`;
const POLL_MS = 1000;
const RETAIN = 300; // ~10 min of public footage; older segments are deleted

const uploaded = new Map(); // seg filename -> public url (insertion-ordered)
const startedAtMs = Date.now(); // footage recorded before the publisher started never publishes
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
  if (uploaded.has(file)) return;
  const buf = await readFile(join(OUT_DIR, file));
  const { url } = await put(`${PREFIX}/${file}`, buf, {
    access: "public",
    contentType: "video/mp2t",
    addRandomSuffix: false,
    cacheControlMaxAge: 31536000, // immutable while published; deleted on panic
  });
  uploaded.set(file, url);
}

// Keep the public footprint bounded: only the newest RETAIN segments stay up.
// This is both hygiene and safety — no permanent public archive accumulates.
async function pruneOld() {
  const excess = uploaded.size - RETAIN;
  if (excess <= 0) return;
  const oldest = [...uploaded.entries()].slice(0, excess);
  await del(oldest.map(([, url]) => url));
  for (const [file] of oldest) uploaded.delete(file);
}

// Panic: the recent past is what most needs to disappear. Delete every segment
// this run has published (the map is this run's full public footprint).
async function eraseUploaded() {
  const urls = [...uploaded.values()];
  if (urls.length) await del(urls);
  uploaded.clear();
}

async function tick() {
  const session = await fetchSession();
  if (!session) {
    process.stdout.write("\rsession endpoint unreachable — publishing nothing     ");
    return; // fail closed: never publish blind
  }

  if (session.blackout) {
    if (uploaded.size) {
      panicAtMs = Date.now(); // everything recorded up to now stays private forever
      await eraseUploaded();
      console.log("\nPANIC observed — all published segments deleted.");
      console.log("Footage recorded before this moment will not publish, even after a new Go Live.");
    }
    process.stdout.write("\rblackout — holding dark                              ");
    return;
  }

  if (!session.live) {
    process.stdout.write("\roffline — waiting for Go Live                        ");
    return;
  }

  // LIVE: upload segments that have aged past the delay window.
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
      // Anything recorded before a panic stays private, even across re-Go-Live,
      // and anything recorded before THIS publisher started is not ours to
      // vouch for (stale files from an earlier session) — never publish it.
      if (s.mtimeMs <= startedAtMs) continue;
      if (panicAtMs !== null && s.mtimeMs <= panicAtMs) continue;
      if (now - s.mtimeMs >= DELAY * 1000) aged.push(f);
    } catch {
      /* file rotated away mid-scan */
    }
  }
  for (const f of aged) await uploadSegment(f);
  await pruneOld();
  process.stdout.write(
    `\rpublic: ${uploaded.size} aged segs · delay ${DELAY}s · prefix ${PREFIX}     `
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
  console.log(`  stream:        ${PREFIX}`);
  console.log(`Paste that stream value into /control, then Go Live.\n`);
  const session = await fetchSession();
  if (!session) {
    console.error("Cannot reach SESSION_URL — check the deploy, then rerun.");
    process.exit(1);
  }
  // Sweep previous sessions' segments (they served as the end-of-day replay
  // until now) so exactly one session's tail ever exists in storage.
  try {
    const { blobs } = await list({ prefix: "stream/" });
    const stale = blobs.filter((b) => !b.pathname.startsWith(`${PREFIX}/`));
    if (stale.length) {
      await del(stale.map((b) => b.url));
      console.log(`  swept ${stale.length} segments from previous sessions\n`);
    }
  } catch {
    /* sweep is hygiene; a failed sweep never blocks broadcasting */
  }
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
