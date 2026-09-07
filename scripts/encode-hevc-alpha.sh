#!/usr/bin/env bash
# Encode every committed character WebM (VP9+alpha) to HEVC-with-alpha MP4.
# Chain: webm -> raw YUVA420p -> x265 --alpha (ENABLE_ALPHA build) -> mp4 (hvc1)
set -euo pipefail
X265=/tmp/x265-alpha-build/build/linux/x265
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
OUT_VER="1"
CRF=${HEVC_CRF:-26}
declare -a CLIPS=(
  "idle/base"
  "idle/AMess" "idle/BarelyDoCrime" "idle/BestStuffInTown" "idle/BraveSip"
  "idle/FilmsFrom80s" "idle/GladYouDidntGetMugged" "idle/GoingToJustStandThere"
  "idle/MostOfTheStuff" "idle/ReallyGoodMovie" "idle/SoBrave" "idle/Sponsorship"
  "idle/TheSmellOfPlastic" "idle/WantToWatchMyMovie" "idle/WhatsTheHoldup"
  "idle/tv/base" "idle/cabinet/base"
)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
for clip in "${CLIPS[@]}"; do
  src="$ROOT/Media/Processed/${clip}.webm"
  dst="$ROOT/Media/Processed/${clip}.mp4"
  raw="$TMP/$(echo "$clip" | tr '/' '_').yuva"
  h265="$TMP/$(echo "$clip" | tr '/' '_').h265"
  if [ -f "$dst" ]; then echo "[SKIP] $clip.mp4 exists"; continue; fi
  meta=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,nb_frames -of csv=p=0 "$src")
  w=$(echo "$meta" | cut -d, -f1); h=$(echo "$meta" | cut -d, -f2)
  fps=$(echo "$meta" | cut -d, -f3); frames=$(echo "$meta" | cut -d, -f4)
  echo "[HEVC] $clip (${w}x${h}, $frames frames)"
  ffmpeg -y -v error -i "$src" -pix_fmt yuva420p -f rawvideo -strict -1 "$raw"
  "$X265" --input "$raw" --input-res "${w}x${h}" --fps "$fps" --input-csp i420 \
    --alpha --crf "$CRF" -o "$h265" 2>/dev/null
  # audio: re-encode opus->aac if present, else silent
  ffmpeg -y -v error -fflags +genpts -r "$fps" -i "$h265" -i "$src" \
    -map 0:v -map 1:a? -c:v copy -tag:v hvc1 -c:a aac -b:a 96k -af "volume=0.7" \
    -shortest -movflags +faststart "$dst"
  outmeta=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_tag_string,nb_frames -of csv=p=0 "$dst")
  echo "   -> $(basename "$dst") $outmeta ($(du -h "$dst" | cut -f1))"
done
echo "[DONE] HEVC set encoded"
