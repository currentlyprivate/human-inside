import { put, list } from "@vercel/blob";

// The single source of truth for the broadcast, stored as one small JSON blob.
// Serverless-friendly: no long-lived process, globally readable, instantly writable.
export type SessionState = {
  name: string; // who is working
  working_on: string; // one line: what they're doing today
  live: boolean; // is the broadcast public right now
  blackout: boolean; // panic engaged — viewers see darkness even if segments exist
  started_at: number | null; // epoch ms the current LIVE session began (for elapsed)
  stream_url: string | null; // HLS playlist the public <video> should play
  delay_seconds: number; // how far behind real time the public stream runs
  updated_at: number;
};

const BLOB_PATH = "session/state.json";

export const DEFAULT_STATE: SessionState = {
  name: "",
  working_on: "",
  live: false,
  blackout: false,
  started_at: null,
  stream_url: null,
  delay_seconds: 45,
  updated_at: 0,
};

export async function readSession(): Promise<SessionState> {
  try {
    const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
    const hit = blobs.find((b) => b.pathname === BLOB_PATH);
    if (!hit) return DEFAULT_STATE;
    // Cache-bust: the blob CDN caches aggressively; we need the freshest state.
    const res = await fetch(`${hit.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return DEFAULT_STATE;
    const data = (await res.json()) as Partial<SessionState>;
    return { ...DEFAULT_STATE, ...data };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function writeSession(next: SessionState): Promise<SessionState> {
  const withStamp = { ...next, updated_at: Date.now() };
  await put(BLOB_PATH, JSON.stringify(withStamp), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
  });
  return withStamp;
}

// A viewer never sees the raw state — blackout must win no matter what.
export function publicView(s: SessionState) {
  const blacked = s.blackout || !s.live;
  return {
    name: s.name,
    working_on: s.working_on,
    live: s.live && !s.blackout,
    started_at: s.live && !s.blackout ? s.started_at : null,
    stream_url: blacked ? null : s.stream_url,
    delay_seconds: s.delay_seconds,
  };
}
