import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { readSession, writeSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// PANIC. The single most important control in the whole system.
// Sets blackout + drops LIVE. publicView() forces stream_url to null, so the
// public page goes dark immediately — the buffered footage is never published.
// The broadcaster keeps working; only the public side is severed.
export async function POST(req: Request) {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const current = await readSession();
  const saved = await writeSession({
    ...current,
    live: false,
    blackout: true,
    started_at: null,
  });
  return NextResponse.json({ ok: true, state: saved });
}
