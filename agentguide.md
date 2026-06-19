# Agent Guide

Static browser animation site for Gaylord's Shop. Keep this project simple: no build step, no framework, no server-side file scanning.

## Core Files

- `index.html`: Scene layers, hotspots, back button, smoke canvas, eyelid overlay.
- `styles.css`: Fullscreen layout, layer stack, hotspots, back button, eyelid animations.
- `script.js`: Idle state machine, pathways, TV channel playback, hotspot positioning.
- `smoke.js`: Independent canvas smoke effect.
- `Media/Videos_Gaylords_Shop/`: Main character assets.
- `Media/Videos_Gaylords_Shop/BG_TV/manifest.js`: Explicit list of TV background clips.
- `scripts/process-bg-tv.sh`: Converts source videos into small TV-screen WebMs.

## Layer Stack

```text
z1    tv-player          clipped TV background video
z2    idle-image         JPG fallback
z3    idle-base-player   looping base WebM with TV-hole alpha
z4    animation-player   foreground idle/pathway clips
z100  smoke-canvas       smoke overlay
z150  hotspots           invisible click zones
z200  back-button        pathway-only Go Back button
z9999 eye-overlay        opening/closing eyelids
```

The TV video sits behind the base/foreground WebMs. Foreground/base WebMs need alpha where the TV should show through.

## Animation Model

Idle clips must start and end on the same base pose. They are randomly played over the looping base WebM every 5-15 seconds, then return to idle.

Pathway clips are non-idle transitions triggered by hotspots. They play once and pause on the final frame. The `Go Back` button closes the eyelids, reloads the page, then the normal opening animation plays again.

Main states in `script.js`:

```text
IDLE
LOADING_IDLE_CLIP
PLAYING_IDLE_CLIP
PATHWAY
```

## Coordinates

Hotspot coordinates are based on the 1024 x 1024 JPG layout:

```js
{ element: tvHotspot, left: 142, top: 352, width: 173, height: 128 }
{ element: gameHotspot, left: 726, top: 410, width: 203, height: 290 }
```

TV screen coordinates are based on the 1440 x 1440 WebM/base-video layout:

```text
top-left:     221,508
top-right:    394,518
bottom-left:  217,660
bottom-right: 396,658
```

Do not mix those coordinate systems.

## Adding Idle Clips

Use WebM with alpha if the TV must remain visible. Add clips to `CONFIG.idleClips` in `script.js`:

```js
{ id: 'new-idle', src: `${MEDIA_PATH}new_idle.webm` }
```

Do not add opaque MP4s to `idleClips` unless covering the TV/background is intentional.

## Adding Pathways

Add the clip path under `CONFIG.pathways`, add/reuse a hotspot, include it in `hideHotspots()` and `showHotspots()`, then call:

```js
playPathwayClip(selectedClip);
```

If adding a new hotspot, also add its scaled rectangle in `updateHotspotPositions()`.

## TV Background Clips

Static sites cannot enumerate folders. Every TV clip must be listed in:

```text
Media/Videos_Gaylords_Shop/BG_TV/manifest.js
```

Example:

```js
window.BG_TV_CHANNELS = [
    'Media/Videos_Gaylords_Shop/BG_TV/notld_tv_01.webm'
];
```

If one TV clip exists, it loops. If multiple exist, the next clip is chosen randomly when the current one ends.

Process source footage into small TV clips with:

```bash
scripts/process-bg-tv.sh input.mp4 Media/Videos_Gaylords_Shop/BG_TV/output.webm 20 00:12:30
```

The helper removes audio, crops/resizes, applies TV perspective, lowers FPS, and exports VP9 WebM.

## Alpha Export/Verification

Kdenlive export path:

```text
File > Render > Video with Alpha > Alpha VP9
```

Avoid normal WebM/MP4 presets for alpha foregrounds.

Check alpha metadata:

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,pix_fmt:stream_tags=alpha_mode -show_entries format=duration -of default=noprint_wrappers=1 file.webm
```

Expected:

```text
TAG:alpha_mode=1
```

Stronger alpha-plane test:

```bash
ffmpeg -v error -c:v libvpx-vp9 -i file.webm -vf "alphaextract,signalstats,metadata=print:file=-" -frames:v 1 -f null -
```

Look for `YMIN=0` and `YMAX=255` when the frame should contain transparent and opaque pixels.

## Verify Edits

Run after JS changes:

```bash
node --check script.js
node --check smoke.js
bash -n scripts/process-bg-tv.sh
```

When changing cached assets in `index.html`, bump the query string like `script.js?v=11` or `styles.css?v=7`.
