import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import {
  readSession,
  writeSession,
  publicView,
  foldElapsedIntoTotal,
  DEFAULT_STATE,
} from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Public: what viewers see. Never leaks control-plane internals.
export async function GET() {
  const s = await readSession();
  return NextResponse.json(publicView(s), {
    headers: { "cache-control": "no-store" },
  });
}

// Broadcaster: update session fields. go LIVE / stop / edit "working on".
export async function POST(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const current = await readSession();

  const next = { ...current };
  if (typeof body.name === "string") next.name = body.name;
  if (typeof body.working_on === "string") next.working_on = body.working_on;
  if (typeof body.stream_url === "string") next.stream_url = body.stream_url;
  if (typeof body.delay_seconds === "number") next.delay_seconds = body.delay_seconds;

  if (typeof body.live === "boolean") {
    if (body.live && !current.live) {
      // Fresh LIVE session: reset the clock and clear any prior blackout.
      next.started_at = Date.now();
      next.blackout = false;
    }
    if (!body.live) {
      // Stopping: bank the elapsed time before dropping the clock.
      next.total_seconds = foldElapsedIntoTotal(current);
      next.started_at = null;
    }
    next.live = body.live;
  }

  const saved = await writeSession(next);
  return NextResponse.json({ ok: true, state: saved });
}

// Broadcaster: hard reset back to nothing (clears name/working-on too).
// The cumulative total is never reset — it only grows — so bank any in-flight
// live time and carry the running total across the wipe.
export async function DELETE(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const current = await readSession();
  const saved = await writeSession({
    ...DEFAULT_STATE,
    total_seconds: foldElapsedIntoTotal(current),
  });
  return NextResponse.json({ ok: true, state: saved });
}
