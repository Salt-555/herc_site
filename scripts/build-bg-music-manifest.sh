#!/usr/bin/env bash
set -euo pipefail

# Scans Media/BG_Music/ for audio files and regenerates manifest.js
# Works from anywhere — resolves project root from script location.

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

SRC_DIR="Media/BG_Music"
MANIFEST="$SRC_DIR/manifest.js"

# Collect all audio files, sorted, null-delimited for safety with spaces
files=()
while IFS= read -r -d '' f; do
    files+=("$f")
done < <(find "$SRC_DIR" -maxdepth 1 -type f \
    \( -iname '*.mp3' -o -iname '*.ogg' -o -iname '*.webm' \
       -o -iname '*.wav' -o -iname '*.m4a' -o -iname '*.aac' \
       -o -iname '*.flac' -o -iname '*.opus' \) \
    -not -name 'manifest.js' -print0 | sort -z)

count=${#files[@]}

# Build manifest
{
    printf 'window.BG_MUSIC_TRACKS = [\n'
    for i in "${!files[@]}"; do
        if [ "$i" -eq $((count - 1)) ]; then
            printf "    '%s'\n" "${files[$i]}"
        else
            printf "    '%s',\n" "${files[$i]}"
        fi
    done
    printf '];\n'
} > "$MANIFEST"

printf '[OK] %s — %d track(s)\n' "$MANIFEST" "$count"
