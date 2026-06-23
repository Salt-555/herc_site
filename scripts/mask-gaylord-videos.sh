#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_DIR="$REPO_ROOT/Media/Videos_Gaylords_Shop"
OUTPUT_DIR="$REPO_ROOT/Media/Processed_Gaylords_Shop"
MASK="$SOURCE_DIR/TVMask.png"
CRF=${CRF:-28}
FORCE=${FORCE:-0}
LIMIT=${LIMIT:-0}
DRY_RUN=0
TEMP_DIR=$(mktemp -d)

trap 'rm -rf "$TEMP_DIR"' EXIT

if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    printf '[FAIL] ffmpeg not found in PATH\n' >&2
    exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
    printf '[FAIL] ffprobe not found in PATH\n' >&2
    exit 1
fi

if [ ! -f "$MASK" ]; then
    printf '[FAIL] Mask not found: %s\n' "$MASK" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

videos=("$SOURCE_DIR"/*.mp4)
if [ "${#videos[@]}" -eq 0 ]; then
    printf '[WARN] No MP4 files found in %s\n' "$SOURCE_DIR"
    exit 0
fi

processed=0

for input in "${videos[@]}"; do
    filename=$(basename -- "$input")
    base=${filename%.*}
    output="$OUTPUT_DIR/$base.webm"

    if [ -f "$output" ] && [ "$FORCE" != "1" ]; then
        printf '[SKIP] %s already exists\n' "$base.webm"
        continue
    fi

    dimensions=$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=width,height \
        -of csv=s=x:p=0 "$input")
    framerate=$(ffprobe -v error -select_streams v:0 \
        -show_entries stream=r_frame_rate \
        -of default=noprint_wrappers=1:nokey=1 "$input")
    duration=$(ffprobe -v error -show_entries format=duration \
        -of default=noprint_wrappers=1:nokey=1 "$input")

    if [ -z "$dimensions" ] || [ -z "$framerate" ] || [ -z "$duration" ]; then
        printf '[WARN] Could not read metadata for %s\n' "$input" >&2
        continue
    fi

    width=${dimensions%x*}
    height=${dimensions#*x}

    printf '[MASK] %s -> %s (%sx%s @ %s fps)\n' "$filename" "$base.webm" "$width" "$height" "$framerate"

    if [ "$DRY_RUN" = "1" ]; then
        processed=$((processed + 1))
        if [ "$LIMIT" -gt 0 ] && [ "$processed" -ge "$LIMIT" ]; then
            printf '[OK] LIMIT=%s reached\n' "$LIMIT"
            break
        fi
        continue
    fi

    # Check if source has audio
    has_audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_name -of csv=p=0 "$input" 2>/dev/null)

    # Step 1: Extract RGBA PNG frames with mask alpha applied
    frame_dir="$TEMP_DIR/$base"
    mkdir -p "$frame_dir"

    printf '  [1/2] Extracting masked RGBA frames...\n'
    ffmpeg -y \
        -i "$input" \
        -loop 1 -t "$duration" -i "$MASK" \
        -filter_complex \
            "[1:v]scale=${width}:${height}:flags=lanczos,format=rgba[mask];[0:v]format=rgba[vid];[vid][mask]blend=all_mode=and:all_opacity=1:all_expr='A*B/255',format=rgba[out]" \
        -map "[out]" \
        -t "$duration" \
        "$frame_dir/frame_%05d.png"

    # Step 2: Encode RGBA PNGs to VP9 alpha WebM, with audio if available
    printf '  [2/2] Encoding VP9 alpha WebM...\n'
    if [ -n "$has_audio" ]; then
        ffmpeg -y \
            -framerate "$framerate" \
            -i "$frame_dir/frame_%05d.png" \
            -i "$input" \
            -map 0:v -map 1:a \
            -c:v libvpx-vp9 \
            -pix_fmt yuva420p \
            -auto-alt-ref 0 \
            -crf "$CRF" \
            -b:v 0 \
            -af "volume=0.7" \
            -c:a libopus -b:a 64k \
            -t "$duration" \
            "$output"
    else
        ffmpeg -y \
            -framerate "$framerate" \
            -i "$frame_dir/frame_%05d.png" \
            -c:v libvpx-vp9 \
            -pix_fmt yuva420p \
            -auto-alt-ref 0 \
            -crf "$CRF" \
            -b:v 0 \
            -an \
            "$output"
    fi

    # Clean up frames for this video
    rm -rf "$frame_dir"

    processed=$((processed + 1))
    printf '[DONE] %s\n' "$base.webm"

    if [ "$LIMIT" -gt 0 ] && [ "$processed" -ge "$LIMIT" ]; then
        printf '[OK] LIMIT=%s reached\n' "$LIMIT"
        break
    fi
done

printf '[OK] Processed %s videos. Output: %s\n' "$processed" "$OUTPUT_DIR"
