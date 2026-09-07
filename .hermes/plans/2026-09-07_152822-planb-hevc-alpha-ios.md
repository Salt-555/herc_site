# Plan B: HEVC-with-alpha media path for iOS Safari (herc_site)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> TDD (test-driven-development skill) for every code task. Subagent short-generation protocol
> applies to every dispatch: plan-only first response, one cycle per response, lazy reads.

**Goal:** Make the site's video compositing work natively on iOS Safari by serving
HEVC-with-alpha MP4s to Safari and keeping the existing WebM+alpha path for everyone
else — deleting the CSS-mask simulation and its failure modes.

**Architecture:** The site is a layered video collage. Desktop browsers composite
VP9 WebM alpha in hardware. Safari discards VP9 alpha, so today we simulate it with
CSS masks (ios-masks.js) — fragile. Plan B gives Safari the codec it actually
supports: HEVC with an auxiliary alpha layer (Apple's "HEVC Video with Alpha
Interoperability Profile"), hardware-decoded on iOS 13+. The JS engine, state
machine, layers, and positioning are untouched; only the media resolver and the
mask module change.

**Tech stack:** ffmpeg 9.0.1 + libx265 with alpha support (VERIFIED on this machine:
`ffmpeg -h encoder=libx265` lists `yuva420p`), MP4 `hvc1` tag, existing headless
test harness (tests/run-tests.js, puppeteer-core + system chromium).

**Critical constraint:** Safari cannot be tested on this Linux box. Every Safari-side
claim must be verified by Salt on the real iPhone at the checkpoints marked 📱.
Local gates prove structure (files exist, correct codec strings, resolver wiring);
only the phone proves rendering.

---

## Current state (verified 2026-09-07)

- HEAD `68680ed`, tree clean. Tests: 10/10 green (tests/run-tests.js), smoke green.
- `ios-masks.js` applies CSS masks from `Media/Masks/*.png` on Safari-like UAs;
  self-healing geometry (metadata/resize recompute). Works but is Plan-A cruft.
- `script.js` has Safari-gated decode throttling (preloader off, base pause/resume).
- Media layout: `Media/Processed/<scene>/<role>.webm` (VP9 yuva420p, alpha_mode=1),
  committed. Mask PNGs committed under `Media/Masks/` (idle.png 1024²,
  idle-cabinet.png 1440²). **No TV-zoom mask PNG exists anywhere.**
- `MEDIA(scene, role)` in script.js (line 4) resolves all runtime media.
- Screens (BG_TV, Game_Cabinet) are tiny WebMs (130–178px) — they play fine on iOS.
- ffmpeg on this box: libx265 supports yuva420p (alpha-capable build). No macOS
  toolchain, no VideoToolbox. HEVC-alpha must be encoded via libx265 `--alpha`
  (auxiliary-layer mode) or the two-layer x265 approach, then muxed to MP4 with
  hvc1 tag. Muxing is the known-hard part (Apple forums: ffmpeg/mp4box mux the
  alpha layer incorrectly). MUST be probed empirically in Task 1 before committing
  to the full rollout. Fallback if muxing fails: build a patched muxer, or encode
  via GStreamer if available, or last resort Plan C (static base on iOS).

## Success criteria

1. iPhone Safari: character idle loops, idle clips, both screens visible through
   cutouts, TV/cabinet zooms fire and hold their terminal pose — no CSS masks.
2. Chrome/Firefox behavior byte-identical to today (still VP9 WebM path).
3. Test suite green; media resolver picks HEVC only when Safari AND the HEVC-alpha
   asset exists (per-scene fallback to WebM otherwise).
4. iOS decode concurrency budget respected: Safari still runs at most ONE large
   video decoder at a time (base OR animation player — keep the throttle).

---

### Task 1: Encode/mux probe — can this machine produce a Safari-playable HEVC-alpha MP4?

**Objective:** Empirically answer the plan's biggest unknown before writing any
shipping code. Produce one test MP4 from the idle base source and characterize it.

**Files:**
- Create: `.tmp/` scratch only (probe artifacts are throwaway, never committed)
- No repo changes in this task except a findings note

**Step 1: Encode alpha HEVC via libx265**

```bash
# input: the 1024x1024 idle base source frames (re-encode test only, NOT for shipping)
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate \
  -of csv=p=0 Media/Sources/idle/base.mp4
# RGBA PNG sequence -> HEVC alpha elementary stream
mkdir -p .tmp/probe && ffmpeg -y -v error -i Media/Sources/idle/base.mp4 \
  -pix_fmt yuva420p -c:v libx265 -x265-params "alpha=1:crf=26:log-level=error" \
  -an .tmp/probe/base_alpha.h265
```

Expected: encoder runs without "alpha not compiled in" errors. If x265 rejects
`alpha=1` (feature exists in ffmpeg's pix_fmt list but the CLI param path differs
when driven through libavcodec), try `-x265-params alpha=1` variants and, failing
that, the standalone `x265` CLI built from AUR (x265 with ENABLE_ALPHA is not the
Arch default — check `pacman -Qi x265` / AUR `x265-alpha`).

**Step 2: Mux to MP4 with hvc1 tag**

```bash
ffmpeg -y -v error -fflags +genpts -r 24 -i .tmp/probe/base_alpha.h265 \
  -c:v copy -tag:v hvc1 .tmp/probe/base_alpha.mp4
ffprobe -v error -show_entries stream=codec_name,codec_tag_string,pix_fmt \
  -of default=nw=1 .tmp/probe/base_alpha.mp4
```

Record: does the elementary stream actually carry the auxiliary alpha layer
(look for alpha SEI / two nal units per frame / `Zond`-style checks are unavailable
— instead decode-side check: does ffmpeg's HEVC decoder expose yuva420p frames from
this file? If ffmpeg decodes it as yuv420p with alpha discarded, that is EXPECTED —
it matches Safari discarding VP9 alpha; the question is whether the ALPHA LAYER
bytes exist). Alternative muxers if ffmpeg mangles it: MP4Box (gpac) from AUR,
or `mkvmerge` -> mp4 remux. Characterize what works.

**Step 3: Empirical validation of the alpha layer (no Safari available)**

- Bitstream-level: `grep`/parse NAL types, or use `ffmpeg -debug:v` on decode to
  confirm the aux picture SEI (payloadType=165, alpha_channel_info) survives muxing.
- Structural: file plays in a browser we CAN test (chromium via the test harness)
  — expect chromium to play HEVC-alpha only if hardware HEVC decode + alpha support
  exists (it generally does NOT on Linux chromium — do not treat failure as
  disqualifying; treat PLAYING-with-visible-alpha in any local browser as a bonus).
- 📱 CHECKPOINT: AirDrop/send `base_alpha.mp4` to Salt's iPhone, open in Safari or
  Files preview over a dark background. Alpha visible = GO. Not visible/never
  plays = STOP, report findings, escalate to fallback options (macOS encode via
  a friend/CI, GStreamer, or Plan C).

**Step 4: Write findings to `.hermes/plans/planB-probe-findings.md`** (exact
commands that worked, file sizes, latency of encode for 8s@1024², muxer used).

### Task 2: Mask-pipeline script gains an HEVC-alpha output mode

**Objective:** Extend `scripts/mask-gaylord-videos.sh` (LAST_FRAME mode exists) with
`FORMAT=hevc` producing `Media/Processed/<scene>/<role>.mp4` alongside the WebM.

**Files:**
- Modify: `scripts/mask-gaylord-videos.sh`
- Test: encode probe asserts output exists, hvc1 tag, frame count == source frame count

**Step 1: Failing test** — bash test script (or node script under tests/) that runs
the pipeline with `FORMAT=hevc LAST_FRAME=1` in a sandbox tree and asserts the
output MP4 has codec_tag_string hvc1 and the right frame count.

**Step 2: Implement**: same frame-extraction stage (mask blend, last-frame-only for
zoom scenes), then encode via the Task-1-verified command chain. Parameterize the
x265 crf (env `HEVC_CRF`, default 26). Audio: HEVC-alpha MP4 keeps AAC (iOS native),
copy volume=0.7 treatment as WebM path.

**Step 3: Verify test passes; commit.**

### Task 3: Author the missing TV-zoom mask PNG

**Objective:** `Media/Masks/idle-tv.png` does not exist; zoom terminals need it on
Safari until Plan-B HEVC zoom clips exist (and as WebM-path fallback).

**Files:**
- Create: `Media/Masks/idle-tv.png` (1440x1440, alpha cutout matching idle/tv base's
  final frame TV-screen region — derive from the LAST frame of
  `Media/Sources/idle/tv/base.mp4` the same way the cabinet mask was authored:
  luminance/edge difference vs the known terminal pose, or Salt hand-authors it)

**Step 1:** Extract last frame PNG of the TV zoom. **Step 2:** Derive cutout region
for the VHS screen (the TV_VHS_SCREEN rect in script.js: left 302, top 284, 898x664
in 1440-space gives the expected box; match actual pixels). **Step 3:** Render mask
PNG (transparent hole = screen region, opaque elsewhere, small feather). **Step 4:**
Salt visually approves via preview pane. Commit.

### Task 4: Media resolver — dual-format selection

**Objective:** One function decides WebM vs HEVC per element. Safari + asset-exists
=> HEVC MP4; else WebM. No CSS masks when HEVC is used.

**Files:**
- Modify: `script.js` (MEDIA resolver + call sites: CONFIG, pathways, SCREENS)
- Modify: `ios-masks.js` (skip masking entirely when the element is playing HEVC)
- Test: `tests/run-tests.js` new cases

**Step 1: Failing tests**
- Safari UA + HEVC asset present in a served manifest -> video src ends `.mp4`
- Safari UA + HEVC asset ABSENT (manifest edited in test) -> falls back `.webm`
- Chrome UA -> always `.webm`
- Safari + HEVC -> `ios-masks` applied-content-mask count stays 0

**Step 2: Implement** — extend the existing `IOSMasking.isSafariLike()` gate into a
shared `IOSMedia` helper (ios-masks.js or new tiny module): probes a head request
(or a committed manifest JSON listing HEVC assets — prefer manifest: zero network
round-trips) and rewrites MEDIA() results. `MEDIA_VER` bump to 3. Keep the decode
throttle (pause/resume base) — HEVC decodes in hardware but budget discipline is
still correct. Masks: the cleanest end state is ios-masks.js no-ops once every
scene has an HEVC asset; intermediate state (mixed) must mask WebM elements only.

**Step 3: Green + full suite + smoke; bump cache-busts; commit.**

### Task 5: Encode the full HEVC-alpha media set

**Objective:** Every committed runtime WebM gets an HEVC-alpha sibling in
`Media/Processed/<scene>/<role>.mp4`, committed to the repo.

**Files:**
- Create: `Media/Processed/idle/*.mp4` (15 clips: base + 14 idle), `idle/tv/base.mp4`,
  `idle/cabinet/base.mp4` (last-frame alpha! — the baked-alpha zooms only cut out at
  the terminal frame, same LAST_FRAME=1 semantics)
- Note: screens (`BG_TV/`, `Game_Cabinet/`) and the JPG stay as-is — tiny WebMs
  already work on iOS; do not convert (YAGNI, size win is negative).

**Step 1:** Run the Task-2 pipeline in FORMAT=hevc over all scenes. **Step 2:**
Automated structural gate: every HEVC file has hvc1 tag, frame count == webm frame
count, duration within 50ms. **Step 3:** Repo-size sanity check: `du -sh
Media/Processed` before/after; if HEVC set adds > ~60% of the WebM set's size,
tune crf before committing. **Step 4:** Commit (this is the big commit; do it in
two: idle root, then zooms).

### Task 6: Delete the Plan-A scaffolding on the HEVC path

**Objective:** Once Safari gets native alpha, the mask/throttle hacks must not
double-fire. Shrink ios-masks.js to: HEVC-capable Safari => no masks, no preloader
gate needed (hardware decode), keep base-pause ONLY if testing shows it still
matters — decide by phone test, default keep (harmless).

**Files:**
- Modify: `ios-masks.js`, `script.js`, `tests/run-tests.js`

**Step 1: Failing tests** — Safari UA with full HEVC manifest: no mask attributes on
any video; preloader active again (hardware decode => preload benefit returns).
**Step 2:** Implement gates. **Step 3:** Green suite twice, smoke, cache-bust
script.js?v=33, commit.

### Task 7: 📱 Full phone verification + ship

**Step 1:** Push to origin/main, wait for Cloudflare deploy. **Step 2:** Salt
phone-tests the full checklist: idle base motion, screens visible in cutouts,
idle clips with screens visible behind, TV zoom -> VHS menu over correct cutout,
cabinet zoom -> arcade, Go Back, sound sync. **Step 3:** Any failure = capture
which scene/element, fix forward (per-scene fallback to WebM+mask is the built-in
degradation path). **Step 4:** Only after phone sign-off: update
`agentguide.md` media-pipeline section + herc-site skill (dual-format resolver,
HEVC branch, probe findings), memory note if a durable lesson emerges.

---

## Risks / tradeoffs / open questions

- **Muxing alpha into MP4 on Linux is the load-bearing unknown.** Task 1 exists to
  fail fast on it. Documented attempts (Apple dev forums, NVIDIA forums) report
  ffmpeg/mp4box mishandling the aux layer; x265's alpha work is recent (2024) and
  the interop profile is Apple-specific. If Task 1 fails: options are (a) AUR
  x265-alpha + hand-mux, (b) GStreamer `vtenc_h265a` is macOS-only (dead end here),
  (c) friend/CI with macOS Finder encode, (d) fall back to Plan C (static base on
  iOS) which is a ~20-line diff.
- **File size**: HEVC-alpha at crf26 should be comparable-or-smaller than VP9
  alpha WebM at crf28, but verify (Task 5 gate).
- **iPad-as-Mac UA**: isSafariLike already covers it; resolver inherits the gate.
- **Old iOS (<13)**: no HEVC-alpha; resolver must detect via
  `canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')`-style check (empty string =>
  WebM+mask fallback). Add to Task 4 tests (stub canPlayType).
- **Repo weight**: doubling committed media. Acceptable for a static site on
  Cloudflare (no build step to regenerate), but note in agentguide that future
  scenes must run BOTH pipeline modes.
- **Deferred**: idle-deck no-repeat feature (agreed earlier) — unchanged by Plan B,
  slot it after Task 7; it lives in script.js draw logic and is media-format-blind.
