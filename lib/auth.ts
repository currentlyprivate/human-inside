import { createHash, timingSafeEqual } from "node:crypto";

// The broadcaster's write actions (go live, update, panic) are gated by one
// shared secret. This is a single-person MVP — one secret is the whole auth model.
// Comparison is constant-time over fixed-length digests, so neither the
// secret's content nor its length leaks through response timing.
export function isAuthed(req: Request): boolean {
  const secret = process.env.BROADCAST_SECRET;
  if (!secret) return false; // fail closed: no secret set means no writes
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
