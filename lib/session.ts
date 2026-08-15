import { put, del, list } from "@vercel/blob";

// The single source of truth for the broadcast, stored as one small JSON blob.
// Serverless-friendly: no long-lived process, globally readable, instantly writable.
export type SessionState = {
  name: string; // who is working
  working_on: string; // one line: what they're doing today
  live: boolean; // is the broadcast public right now
  blackout: boolean; // panic engaged — viewers see darkness even if segments exist
  started_at: number | null; // epoch ms the current LIVE session began (for elapsed)
  stream_url: string | null; // current broadcast's segment prefix, e.g. "stream/ab12cd34"
  delay_seconds: number; // how far behind real time the public stream runs
  total_seconds: number; // cumulative live time across all sessions ever — the number that only grows
  updated_at: number;
};

// State is written as a NEW immutable blob every time and readers take the
// newest by pathname. Never overwrite a blob: overwrites are eventually
// consistent (up to tens of seconds, variably) while creations show up in
// list() within a couple of seconds — and panic latency rides on this.
const STATE_PREFIX = "session/state-";
const KEEP_STATES = 5;

export const DEFAULT_STATE: SessionState = {
  name: "",
  working_on: "",
  live: false,
  blackout: false,
  started_at: null,
  stream_url: null,
  delay_seconds: 45,
  total_seconds: 0,
  updated_at: 0,
};

export async function readSession(): Promise<SessionState> {
  try {
    const { blobs } = await list({ prefix: STATE_PREFIX, limit: 1000 });
    if (blobs.length === 0) return DEFAULT_STATE;
    const latest = blobs.reduce((a, b) => (a.pathname > b.pathname ? a : b));
    // The blob is immutable, so any copy of it is correct — no cache-busting needed.
    const res = await fetch(latest.url, { cache: "no-store" });
    if (!res.ok) return DEFAULT_STATE;
    const data = (await res.json()) as Partial<SessionState>;
    return { ...DEFAULT_STATE, ...data };
  } catch {
    return DEFAULT_STATE;
  }
}

export async function writeSession(next: SessionState): Promise<SessionState> {
  const withStamp = { ...next, updated_at: Date.now() };
  // Zero-padded epoch ms so pathnames sort chronologically.
  const path = `${STATE_PREFIX}${String(withStamp.updated_at).padStart(15, "0")}.json`;
  await put(path, JSON.stringify(withStamp), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 0,
  });
  // Prune old state blobs; best-effort, never blocks the write.
  try {
    const { blobs } = await list({ prefix: STATE_PREFIX, limit: 1000 });
    const stale = blobs
      .map((b) => b)
      .sort((a, b) => (a.pathname > b.pathname ? -1 : 1))
      .slice(KEEP_STATES);
    if (stale.length) await del(stale.map((b) => b.url));
  } catch {
    /* pruning is hygiene, not correctness */
  }
  return withStamp;
}

// Fold a live session's elapsed time into the cumulative total, exactly once,
// at the moment it stops being live. Every exit path — stop, reset, panic —
// runs through here so no worked minute is ever dropped (panic still counts:
// the number is time LOGGED, not time published). Idempotent: if the session
// isn't currently live, or has no start, it returns the total unchanged.
export function foldElapsedIntoTotal(current: SessionState): number {
  if (!current.live || current.started_at == null) return current.total_seconds;
  const elapsed = Math.max(0, Math.floor((Date.now() - current.started_at) / 1000));
  return current.total_seconds + elapsed;
}

// A viewer never sees the raw state — blackout must win no matter what.
// blackout is exposed so the publisher can tell panic apart from a plain stop
// (panic makes it erase recent public segments, not just halt).
export function publicView(s: SessionState) {
  return {
    name: s.name,
    working_on: s.working_on,
    live: s.live && !s.blackout,
    blackout: s.blackout,
    started_at: s.live && !s.blackout ? s.started_at : null,
    // Kept when merely stopped, so viewers get the end-of-day replay;
    // blackout still severs it entirely.
    stream_url: s.blackout ? null : s.stream_url,
    delay_seconds: s.delay_seconds,
    // The cumulative number. While live, the client adds the current elapsed
    // on top of this so it ticks up without a write every second.
    total_seconds: s.total_seconds,
  };
}
