import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// The public playlist, built by the app on every request. There is no playlist
// blob at all: fixed-path blob overwrites are eventually consistent on the
// order of tens of seconds — fatal for live HLS, where players re-fetch the
// playlist every ~2s. Segments are immutable (never overwritten), so listing
// them is always coherent, and blackout wins before we even look at Blob:
// panic is instant here no matter what the publisher is doing.
const SEG_SECONDS = 2; // must match capture.sh's SEG_SECONDS
const WINDOW = 90; // segments visible to players; older ones slide off

const TOMBSTONE =
  ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEG_SECONDS}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-ENDLIST"].join(
    "\n"
  ) + "\n";

const HEADERS = {
  "content-type": "application/vnd.apple.mpegurl",
  "cache-control": "no-store",
};

export async function GET() {
  const s = await readSession();
  // stream_url holds the current broadcast's segment prefix, e.g. "stream/ab12cd34"
  // (per-session and random, so a past session's urls die with the session).
  // A plain stop keeps the last ~10 minutes up as a finished replay — the
  // window stays lit a little after the human leaves. Panic erases everything.
  if (s.blackout || !s.stream_url || !s.stream_url.startsWith("stream/")) {
    return new NextResponse(TOMBSTONE, { headers: HEADERS });
  }
  try {
    const { blobs } = await list({ prefix: `${s.stream_url}/seg_`, limit: 1000 });
    const segs = blobs
      .filter((b) => /seg_\d+\.ts$/.test(b.pathname))
      .sort((a, b) => (a.pathname < b.pathname ? -1 : 1))
      .slice(-WINDOW);
    if (segs.length === 0) {
      // Warm-up: LIVE, but no footage has aged past the delay window yet.
      return new NextResponse(TOMBSTONE, { headers: HEADERS });
    }
    const firstSeq = Number(segs[0].pathname.match(/seg_(\d+)\.ts$/)?.[1] ?? 0);
    const lines = [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      `#EXT-X-TARGETDURATION:${SEG_SECONDS}`,
      `#EXT-X-MEDIA-SEQUENCE:${firstSeq}`,
    ];
    for (const b of segs) {
      lines.push(`#EXTINF:${SEG_SECONDS.toFixed(3)},`);
      lines.push(b.url);
    }
    if (!s.live) lines.push("#EXT-X-ENDLIST"); // stopped: a finished replay, not a live edge
    return new NextResponse(lines.join("\n") + "\n", { headers: HEADERS });
  } catch {
    return new NextResponse(TOMBSTONE, { headers: HEADERS }); // fail closed: dark
  }
}
