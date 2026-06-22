#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
    printf 'Usage: %s <input-video-or-url> <output-webm> [duration-seconds] [start-time]\n' "$0" >&2
    exit 1
fi

INPUT=$1
OUTPUT=$2
DURATION=${3:-30}
START=${4:-0}

# Canonical geometry: screens.json -> "tv"
# TV screen bounding box from the 1440x1440 WebM/base-video scene:
# top-left 221,508 | top-right 394,518 | bottom-left 217,660 | bottom-right 396,658
# Bounding rectangle: left=217 top=508 width=179 height=152
# Destination quad inside that rectangle:
# top-left 4,0 | top-right 177,10 | bottom-left 0,152 | bottom-right 179,150
ffmpeg -y \
    -ss "$START" \
    -i "$INPUT" \
    -an \
    -t "$DURATION" \
    -vf "scale=220:-2,crop=179:152,setsar=1,perspective=x0=4:y0=0:x1=177:y1=10:x2=0:y2=152:x3=179:y3=150:sense=destination:interpolation=cubic,fps=12" \
    -c:v libvpx-vp9 \
    -b:v 0 \
    -crf 36 \
    -row-mt 1 \
    "$OUTPUT"
