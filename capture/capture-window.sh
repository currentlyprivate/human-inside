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

# Ghostty uses macOS NATIVE tabs — each tab is its own window at the system
# level. A static window lock therefore pins the broadcast to one tab. Instead
# we FOLLOW the frontmost Ghostty tab: switch tabs and the feed switches with
# you; focus another app and the feed stays on your last tab. The helper is
# compiled once so re-resolving every second is cheap.
BIN=".get-window-id"
if [ ! -x "$BIN" ] || [ get-window-id.swift -nt "$BIN" ]; then
  xcrun swiftc -O get-window-id.swift -o "$BIN"
fi
echo "Human Inside · following the frontmost $APP_NAME tab @ ${FPS}fps → $OUT_DIR"
echo "  (whatever $APP_NAME tab you focus is ON AIR; segments every ${SEG_SECONDS}s)"

# Strictly paced capture loop: emits one JPEG per 1/FPS seconds to stdout.
# python3 keeps the cadence exact so timestamps don't drift over hours.
python3 - "$BIN" "$APP_NAME" "$FPS" <<'PY' |
import subprocess, sys, time, os, tempfile
bin_path, app_name, fps = sys.argv[1], sys.argv[2], float(sys.argv[3])
interval = 1.0 / fps
out = sys.stdout.buffer
tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False).name
next_t = time.monotonic()
fails = 0
window_id, title, last_resolve = None, None, 0.0
try:
    while True:
        now = time.monotonic()
        if now - last_resolve >= 1.0:  # follow the frontmost tab, cheaply
            last_resolve = now
            r = subprocess.run(["./" + bin_path, app_name], capture_output=True, text=True)
            if r.returncode == 0:
                lines = r.stdout.splitlines()
                new_id = lines[0] if lines else None
                new_title = lines[1] if len(lines) > 1 else ""
                if new_id and new_id != window_id:
                    window_id, title = new_id, new_title
                    print(f"\n>>> now on air: “{title or app_name}” (window {window_id})", file=sys.stderr)
        if window_id:
            r = subprocess.run(["screencapture", "-x", "-o", "-l", window_id, "-t", "jpg", tmp])
            if r.returncode == 0 and os.path.getsize(tmp) > 0:
                if fails:
                    print("\n>>> capturable again — feed resumed", file=sys.stderr)
                fails = 0
                with open(tmp, "rb") as f:
                    out.write(f.read())
                out.flush()
            else:
                fails += 1
                if fails % 10 == 1:  # loud, repeated — the public feed is FROZEN
                    print(f"\n>>> WINDOW NOT CAPTURABLE ({fails} tries) — THE FEED IS FROZEN", file=sys.stderr)
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
