#!/usr/bin/env bash
# Human Inside — ONE WINDOW capture → local HLS.
# Captures a single app window (default: Ghostty) via macOS window capture, so
# the broadcast follows the window itself: other windows overlapping it, other
# Spaces, notifications — none of it can enter the frame. This is the intended
# framing of Human Inside; capture.sh (whole screen) is the blunt fallback.
#
# Slow TV pacing: 2 fps stills piped into ffmpeg. The pacing loop is strictly
# clocked so segment durations stay honest over a whole work session.
set -euo pipefail

OUT_DIR="${OUT_DIR:-./capture-out}"
APP_NAME="${APP_NAME:-Ghostty}"
FPS="${FPS:-2}"                  # stills per second; 2 is plenty for a terminal
SEG_SECONDS="${SEG_SECONDS:-2}"
CRF="${CRF:-28}"
SCALE="${SCALE:-1600:-2}"

cd "$(dirname "$0")"
mkdir -p "$OUT_DIR"
# Fresh session, fresh directory: stale segments from a previous run would be
# "aged" already and the publisher would broadcast 20-minute-old footage.
rm -f "$OUT_DIR"/seg_*.ts "$OUT_DIR"/local.m3u8

# The window you launch this from is frontmost by definition — give the
# broadcaster time to focus the window they actually want on air.
echo "Focus the $APP_NAME window you want ON AIR. Locking on in 5 seconds…"
for i in 5 4 3 2 1; do printf '  %d…\n' "$i"; sleep 1; done
WINDOW_INFO=$(xcrun swift get-window-id.swift "$APP_NAME")
WINDOW_ID=$(echo "$WINDOW_INFO" | head -1)
WINDOW_TITLE=$(echo "$WINDOW_INFO" | sed -n 2p)
echo "Human Inside · capturing ONLY: “${WINDOW_TITLE:-$APP_NAME}” (window $WINDOW_ID) @ ${FPS}fps → $OUT_DIR"
echo "  (keep that window un-minimized; segments every ${SEG_SECONDS}s)"

# Strictly paced capture loop: emits one JPEG per 1/FPS seconds to stdout.
# python3 keeps the cadence exact so timestamps don't drift over hours.
python3 - "$WINDOW_ID" "$FPS" <<'PY' |
import subprocess, sys, time, os, tempfile
window_id, fps = sys.argv[1], float(sys.argv[2])
interval = 1.0 / fps
out = sys.stdout.buffer
tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False).name
next_t = time.monotonic()
fails = 0
try:
    while True:
        r = subprocess.run(["screencapture", "-x", "-o", "-l", window_id, "-t", "jpg", tmp])
        if r.returncode == 0 and os.path.getsize(tmp) > 0:
            if fails:
                print("\n>>> window capturable again — feed resumed", file=sys.stderr)
            fails = 0
            with open(tmp, "rb") as f:
                out.write(f.read())
            out.flush()
        else:
            fails += 1
            if fails % 10 == 1:  # loud, repeated — the public feed is FROZEN
                print(f"\n>>> WINDOW NOT CAPTURABLE ({fails} tries) — minimized or closed? THE FEED IS FROZEN", file=sys.stderr)
        next_t += interval
        time.sleep(max(0.0, next_t - time.monotonic()))
finally:
    os.unlink(tmp)
PY
exec ffmpeg -hide_banner -loglevel error \
  -f image2pipe -framerate "$FPS" -i - \
  -vf "scale=${SCALE},format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency -crf "$CRF" \
  -g $(printf '%.0f' "$(echo "$FPS * $SEG_SECONDS" | bc)") -keyint_min 1 -sc_threshold 0 \
  -f hls \
  -hls_time "$SEG_SECONDS" \
  -hls_list_size 150 \
  -hls_flags delete_segments+omit_endlist+program_date_time \
  -hls_segment_filename "$OUT_DIR/seg_%06d.ts" \
  "$OUT_DIR/local.m3u8"
