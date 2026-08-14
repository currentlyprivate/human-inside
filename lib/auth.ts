// The broadcaster's write actions (go live, update, panic) are gated by one
// shared secret. This is a single-person MVP — one secret is the whole auth model.
export function isAuthed(req: Request): boolean {
  const secret = process.env.BROADCAST_SECRET;
  if (!secret) return false; // fail closed: no secret set means no writes
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === secret;
}
