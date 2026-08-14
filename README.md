# Human Inside

**Slow TV for the age of AI.** A human, working, with AI — broadcast almost-live,
safely behind real time. One person flips a switch in the morning and
[humaninside.dev](https://humaninside.dev) quietly shows their Ghostty window
while they work. No chat, no likes, no followers. Sometimes nothing happens.
That's the point.

## The safety model

The stream runs **30–60 seconds behind** the real screen. That delay is the
safety mechanism — not the redaction. Nothing reaches the public until it has
aged past the delay window, so the broadcaster always has time to hit **panic**
before any given moment goes public.

> Never assume redaction is perfect. The delay is the safety net.
> Panic is the emergency brake.

## Architecture

```
Ghostty ─ ffmpeg (capture.sh) ─► local HLS segments
                                        │
                        publish.mjs (holds each segment
                        back until it is DELAY seconds old)
                                        │
                                        ▼
                                 Vercel Blob  ◄── session state JSON
                                        │            (name, working-on,
                                        ▼             LIVE, blackout)
                        humaninside.dev  ◄── /api/session  ◄── /control
                        (public <video>)     /api/panic        (broadcaster)
```

- **App** (Next.js on Vercel): the public window, the control cockpit, and the
  control API. High-bandwidth video never routes through app functions — it
  goes viewer ⇄ Blob directly.
- **Capture** (your Mac): `capture.sh` runs ffmpeg; `publish.mjs` uploads only
  aged segments and writes the public playlist.

## Run it

### 1. App (deploy)

```bash
npm install
vercel link            # link to the humaninside project
# Add Blob storage to the project (Vercel dashboard → Storage → Blob).
# Set env vars on the project:
#   BROADCAST_SECRET       = a long random string
#   BLOB_READ_WRITE_TOKEN  = (added automatically with Blob storage)
vercel --prod
```

Point `humaninside.dev` at this project in Vercel → Domains.

### 2. Capture (your machine, each session)

```bash
cd capture
npm install
export BLOB_READ_WRITE_TOKEN=...     # same token as the app
export SESSION_URL=https://humaninside.dev/api/session   # the control plane
export DELAY_SECONDS=45

# find your screen device index:
ffmpeg -f avfoundation -list_devices true -i ""
# start capture (set SCREEN_INDEX to your screen's index):
SCREEN_INDEX=1 OUT_DIR=./capture-out ../capture/capture.sh &
# start the delayed publisher:
OUT_DIR=./capture-out node publish.mjs
```

The publisher is a subscriber of the control plane: it uploads only while the
session is LIVE, and on **panic** it deletes every segment it published —
nothing recorded before the panic can publish again, even after a new Go Live.
If it can't reach `SESSION_URL`, it publishes nothing (fail closed).

There is no playlist blob: the app builds `/api/stream.m3u8` on demand by
listing the immutable segments (blob overwrites are too slow for live HLS).
Segments live under a per-run random prefix and only the newest ~10 minutes
stay public — no permanent archive accumulates.

Copy the printed `stream/<id>` value.

### 3. Go live

Open `https://humaninside.dev/control`, enter your `BROADCAST_SECRET`, paste the
stream value, set name + what you're working on, hit **Go Live**.

Open `https://humaninside.dev` in another browser — you'll see yourself, ~45s
behind. Hit **panic** in `/control` to black it out instantly.

## The milestone this proves

> Can one person safely leave Human Inside running for a whole work session while
> another person watches it almost live?

Everything here exists to answer that. Auto-redaction (OCR + secret regex on aged
frames) is the next layer — the delay already makes it safe to iterate on.
