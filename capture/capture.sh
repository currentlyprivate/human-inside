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

echo "Human Inside · capturing screen[$SCREEN_INDEX] @ ${FPS}fps → $OUT_DIR"
echo "  (segments every ${SEG_SECONDS}s — the delayed uploader publishes these)"

exec ffmpeg -hide_banner -loglevel warning \
  -f avfoundation -capture_cursor 1 -framerate "$FPS" -i "${SCREEN_INDEX}:none" \
  -vf "scale=${SCALE},format=yuv420p" \
  -c:v libx264 -preset veryfast -tune zerolatency -crf "$CRF" \
  -g $((FPS * SEG_SECONDS)) -keyint_min $((FPS * SEG_SECONDS)) -sc_threshold 0 \
  -f hls \
  -hls_time "$SEG_SECONDS" \
  -hls_list_size 0 \
  -hls_flags append_list+omit_endlist+program_date_time \
  -hls_segment_filename "$OUT_DIR/seg_%06d.ts" \
  "$OUT_DIR/local.m3u8"
