# Gaylord's Shop

Static browser animation site. No framework, no server, no build step.

## Cloudflare Pages

Use these settings when connecting this GitHub repository to Cloudflare Pages:

- Framework preset: `None`
- Build command: leave blank
- Build output directory: `/` or `.`
- Environment variables: none required

The deployed site is served directly from the repository root. `index.html` loads all CSS, JavaScript, manifests, and media with relative paths.

## Deploy Checklist

Before pushing for deployment:

```bash
node --check script.js
node --check arcade.js
node --check smoke.js
bash -n scripts/process-bg-tv.sh
bash -n scripts/mask-gaylord-videos.sh
bash -n scripts/process-game-cabinet.sh
```

Required deploy assets include:

- `index.html`, `styles.css`, `script.js`, `arcade.js`, `smoke.js`
- `Media/Processed_Gaylords_Shop/` WebM/JPG files
- `Media/BG_TV/` WebM files and `manifest.js`
- `Media/Game_Cabinet/` WebM files and `manifest.js`
- `Media/BG_Music/` audio files and `manifest.js`

Source media in `Media/Videos_Gaylords_Shop/` is intentionally ignored and not required by Cloudflare Pages.
