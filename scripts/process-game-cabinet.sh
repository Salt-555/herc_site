#!/usr/bin/env bash
set -euo pipefail

# Canonical geometry: screens.json -> "game-cabinet"
# Game Cabinet screen bounding box (1024x1024 coords):
# top-left 759,490 | top-right 881,491 | bottom-left 764,608 | bottom-right 889,600
# Bounding rectangle: left=759 top=490 width=130 height=118
# Destination quad inside that rectangle:
# top-left (0,0) | top-right (122,1) | bottom-left (5,118) | bottom-right (130,110)

SRC_DIR="Media/Game_Cabinet"
COUNT=0

for mp4 in "$SRC_DIR"/*.mp4; do
    [ -f "$mp4" ] || continue

    base="$(basename "${mp4%.mp4}")"
    out="$SRC_DIR/${base}.webm"

    if [ -f "$out" ]; then
        printf '[SKIP] %s already exists\n' "$out"
        continue
    fi

    printf '[PROC] %s -> %s\n' "$(basename "$mp4")" "$(basename "$out")"

    # Check if source has audio
    has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$mp4" 2>/dev/null)

    if [ -n "$has_audio" ]; then
        ffmpeg -y \
            -i "$mp4" \
            -vf "scale=160:-2,crop=130:118,setsar=1,perspective=x0=0:y0=0:x1=122:y1=1:x2=5:y2=118:x3=130:y3=110:sense=destination:interpolation=cubic,fps=12" \
            -af "volume=0.15" \
            -c:v libvpx-vp9 \
            -b:v 0 \
            -crf 36 \
            -row-mt 1 \
            -c:a libopus -b:a 32k \
            "$out"
    else
        ffmpeg -y \
            -i "$mp4" \
            -an \
            -vf "scale=160:-2,crop=130:118,setsar=1,perspective=x0=0:y0=0:x1=122:y1=1:x2=5:y2=118:x3=130:y3=110:sense=destination:interpolation=cubic,fps=12" \
            -c:v libvpx-vp9 \
            -b:v 0 \
            -crf 36 \
            -row-mt 1 \
            "$out"
    fi

    printf '[DONE] %s\n' "$(basename "$out")"
    COUNT=$((COUNT + 1))
done

printf '[OK] Processed %d videos into %s\n' "$COUNT" "$SRC_DIR"
