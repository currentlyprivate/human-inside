import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// The public playlist, served fresh through the app. Blob clamps cache-control
// to a 60s minimum, which is fatal for a live HLS playlist (players re-fetch it
// every ~2s) — so viewers get it here with no-store, and only the fat immutable
// segments come straight off the Blob CDN. This also makes panic instant at the
// playlist level: blackout wins before we even look at Blob.
const TOMBSTONE =
  ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-ENDLIST"].join("\n") +
  "\n";

const HEADERS = {
  "content-type": "application/vnd.apple.mpegurl",
  "cache-control": "no-store",
};

export async function GET() {
  const s = await readSession();
  if (!s.live || s.blackout || !s.stream_url) {
    return new NextResponse(TOMBSTONE, { headers: HEADERS });
  }
  try {
    // Unique query per request punches through Blob's CDN cache.
    const res = await fetch(`${s.stream_url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return new NextResponse(TOMBSTONE, { headers: HEADERS });
    return new NextResponse(await res.text(), { headers: HEADERS });
  } catch {
    return new NextResponse(TOMBSTONE, { headers: HEADERS }); // fail closed: dark
  }
}
