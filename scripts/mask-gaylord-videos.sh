#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

# Alpha-mask pipeline for the scene-graph media layout.
#
# Input:  every *.mp4 under Media/Sources/<scene-path>/   (gitignored)
# Output: alpha-masked VP9 WebM at Media/Processed/<scene-path>/   (committed)
#
# Mask routing (nearest-ancestor inheritance):
#   Each scene dir may contain a mask.png. A clip's mask is the nearest
#   mask.png found by walking up from the clip's own directory toward
#   Media/Sources/. So idle/tv/base.mp4 checks Media/Sources/idle/tv/mask.png
#   first, then Media/Sources/idle/mask.png. Only nodes whose geometry
#   actually differs need their own mask.png.
#
# Source audio is preserved when present (libopus 64k @ volume 0.7).

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_DIR="$REPO_ROOT/Media/Sources"
OUTPUT_DIR="$REPO_ROOT/Media/Processed"
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

if [ ! -d "$SOURCE_DIR" ]; then
    printf '[FAIL] Source dir not found: %s\n' "$SOURCE_DIR" >&2
    printf '       Drop source MP4s + mask.png under Media/Sources/<scene-path>/\n' >&2
    exit 1
fi

# Resolve the nearest ancestor mask.png for a given scene directory.
# Returns empty string if no mask exists anywhere up the tree.
resolve_mask() {
    local dir="$1"
    local d="$dir"
    while :; do
        if [ -f "$d/mask.png" ]; then
            printf '%s/mask.png' "$d"
            return 0
        fi
        if [ "$d" = "$SOURCE_DIR" ]; then
            break
        fi
        d=$(dirname -- "$d")
    done
    return 0
}

# Collect source clips recursively (mp4 only).
mapfile -t videos < <(find "$SOURCE_DIR" -type f -name '*.mp4' | sort)
if [ "${#videos[@]}" -eq 0 ]; then
    printf '[WARN] No MP4 files found under %s\n' "$SOURCE_DIR"
    exit 0
fi

processed=0

for input in "${videos[@]}"; do
    # scene path relative to Sources, e.g. idle/tv/base.mp4 -> rel dir idle/tv
    rel=${input#"$SOURCE_DIR"/}
    scene_dir_rel=$(dirname -- "$rel")
    base=$(basename -- "$rel")
    base=${base%.mp4}
    scene_dir=$(dirname -- "$input")
    output="$OUTPUT_DIR/$scene_dir_rel/$base.webm"

    mask=$(resolve_mask "$scene_dir")
    if [ -z "$mask" ]; then
        printf '[SKIP] %s: no mask.png found up the scene tree (root has none)\n' "$rel" >&2
        continue
    fi

    if [ -f "$output" ] && [ "$FORCE" != "1" ]; then
        printf '[SKIP] %s already exists\n' "$rel -> $base.webm"
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
        printf '[WARN] Could not read metadata for %s\n' "$rel" >&2
        continue
    fi

    width=${dimensions%x*}
    height=${dimensions#*x}

    printf '[MASK] %s -> %s (%sx%s @ %s fps)  mask=%s\n' \
        "$rel" "$output" "$width" "$height" "$framerate" \
        "${mask#"$SOURCE_DIR"/}"

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
    mkdir -p "$(dirname -- "$output")"

    printf '  [1/2] Extracting masked RGBA frames...\n'
    ffmpeg -y \
        -i "$input" \
        -loop 1 -t "$duration" -i "$mask" \
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
