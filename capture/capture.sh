#!/usr/bin/env bash
# Human Inside — screen capture → local HLS.
# This is the LOCAL half. It never publishes anything itself; the delayed
# uploader (publish.mjs) decides what reaches the public. Capture cheaply and
# continuously; let the delay + uploader be the safety boundary.
#
# macOS: uses avfoundation. Find your screen device index with:
#   ffmpeg -f avfoundation -list_devices true -i ""
# then set SCREEN_INDEX below (Capture screen 0 is usually the number shown).
set -euo pipefail

OUT_DIR="${OUT_DIR:-./capture-out}"
SCREEN_INDEX="${SCREEN_INDEX:-1}"   # avfoundation video device index for the screen
FPS="${FPS:-10}"                    # slow tv — 10fps is plenty and keeps size tiny
SEG_SECONDS="${SEG_SECONDS:-2}"     # segment length; delay resolution
CRF="${CRF:-30}"                    # higher = smaller/softer; readable terminal text
SCALE="${SCALE:-1600:-2}"           # downscale width to 1600, keep aspect

mkdir -p "$OUT_DIR"
# Fresh session, fresh directory: stale segments from a previous run would be
# "aged" already and the publisher would broadcast 20-minute-old footage.
rm -f "$OUT_DIR"/seg_*.ts "$OUT_DIR"/local.m3u8

echo "Human Inside · capturing screen[$SCREEN_INDEX] @ ${FPS}fps → $OUT_DIR"
echo "  (segments every ${SEG_SECONDS}s — the delayed uploader publishes these)"

# -use_wallclock_as_timestamps: avfoundation screen devices deliver frames with
# a broken/jumping pts clock on recent macOS; wallclock stamping fixes the
# non-monotonic DTS storm that otherwise prevents segments from ever finishing.
exec ffmpeg -hide_banner -loglevel error \
  -f avfoundation -capture_cursor 1 -framerate "$FPS" \
  -use_wallclock_as_timestamps 1 -i "${SCREEN_INDEX}:none" \
  -vf "fps=${FPS},scale=${SCALE},format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency -crf "$CRF" \
  -g $((FPS * SEG_SECONDS)) -keyint_min $((FPS * SEG_SECONDS)) -sc_threshold 0 \
  -f hls \
  -hls_time "$SEG_SECONDS" \
  -hls_list_size 150 \
  -hls_flags delete_segments+omit_endlist+program_date_time \
  -hls_segment_filename "$OUT_DIR/seg_%06d.ts" \
  "$OUT_DIR/local.m3u8"
