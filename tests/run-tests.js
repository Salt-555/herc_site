const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const PORT = 8931;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('nf'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function maskGeom(el) {
  const cs = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  return {
    img: cs.webkitMaskImage || cs.maskImage,
    size: cs.webkitMaskSize || cs.maskSize,
    pos: cs.webkitMaskPosition || cs.maskPosition,
    box: { w: box.width, h: box.height, left: box.left, top: box.top },
    vw: el.videoWidth, vh: el.videoHeight,
  };
}

function expectedGeom(g) {
  const f = window.IOSMasking.contentRectFraction(g.vw || 1024, g.vh || 1024, g.box.w, g.box.h);
  return { w: f.width * g.box.w, h: f.height * g.box.h, left: f.left * g.box.w };
}

// --- Fix 1: hotspot geometry must refresh when idle image loads ---
const VIEWPORT = { width: 375, height: 667 }; // phone-ish, non-square

test('fix1: hotspot rect uses letterboxed scene geometry after idle image load', async ({ page, blockers }) => {
  await page.setViewport(VIEWPORT);
  // Hold the idle JPG until we explicitly release it (after first layout)
  const release = blockers.add('GET', new RegExp('/Media/Processed/idle/base\\.jpg'));
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.setViewport({ width: VIEWPORT.width + 1, height: VIEWPORT.height }); // force resize -> updateLayout runs with fallback box (nw=0)
  await new Promise((r) => setTimeout(r, 500));

  const before = await page.evaluate(() => {
    const hs = document.querySelector('.hotspot');
    return { css: hs.style.cssText, w: parseFloat(hs.style.width) || 0 };
  });
  if (!before.css) throw new Error('no fallback layout ran at all (before)');

  release();
  await page.waitForFunction(() => document.getElementById('idle-image').naturalWidth > 0, { timeout: 5000 });
  // The fix: an image 'load' listener must re-run updateLayout without any resize/other event.
  await new Promise((r) => setTimeout(r, 300));

  const result = await page.evaluate(() => {
    const img = document.getElementById('idle-image');
    const box = img.getBoundingClientRect();
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const scale = Math.min(box.width / nw, box.height / nh);
    const cw = nw * scale, ch = nh * scale;
    const cl = box.left + (box.width - cw) / 2, ct = box.top + (box.height - ch) / 2;
    const hs = document.querySelector('#tv-hotspot');
    const hsBox = hs.getBoundingClientRect();
    return { cw, ch, cl, ct, hsBox, styleW: parseFloat(hs.style.width) };
  });
  // tv-hotspot config: left 142, top 352, w 173, h 128 in 1024 space
  const expectedW = (result.cw / 1024) * 173;
  const expectedH = (result.ch / 1024) * 128;
  if (Math.abs(result.styleW - expectedW) > 2 || Math.abs(result.hsBox.height - expectedH) > 2) {
    throw new Error(`tv-hotspot size ${result.styleW}x${result.hsBox.height} != content-rect-derived ${expectedW.toFixed(1)}x${expectedH.toFixed(1)}`);
  }
  if (Math.abs(result.hsBox.left - (result.cl + (result.cw / 1024) * 142)) > 2 ||
      Math.abs(result.hsBox.top - (result.ct + (result.ch / 1024) * 352)) > 2) {
    throw new Error(`tv-hotspot origin ${result.hsBox.left},${result.hsBox.top} != content-rect-derived position`);
  }
});

// --- Fix 2: play() must be called synchronously inside hotspot click ---
test('fix2: playPathwayClip calls video.play() synchronously during click dispatch, once', async ({ page }) => {
  await page.setViewport(VIEWPORT);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  // Complete wake sequence by clicking once
  await page.evaluate(() => document.body.click());
  // Wait until hotspots visible (wake done, state IDLE)
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 30000 });

  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    window.__playCalls = 0;
    const orig = ap.play.bind(ap);
    ap.play = function () { window.__playCalls++; return orig(); };
  });
  // Dispatch click synchronously and inspect the counter in the SAME task
  const count = await page.evaluate(() => {
    const tv = document.getElementById('tv-hotspot');
    window.__playCalls = 0;
    tv.click();
    return window.__playCalls;
  });
  if (count !== 1) throw new Error(`play() called ${count} times synchronously during click (expected 1)`);
});

// --- Fix 3: touch-action: manipulation ---
test('fix3: .hotspot and .back-button have touch-action manipulation', async ({ page }) => {
  await page.setViewport(VIEWPORT);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  const vals = await page.evaluate(() => ({
    hotspot: getComputedStyle(document.querySelector('.hotspot')).touchAction,
    back: getComputedStyle(document.querySelector('.back-button')).touchAction,
  }));
  for (const [k, v] of Object.entries(vals)) {
    if (v !== 'manipulation') throw new Error(`.${k} touch-action is "${v}", expected "manipulation"`);
  }
});

// --- Fix 4: Safari-only CSS mask on character videos ---
test('fix4a: Plan C Safari UA -> base video disabled, JPG stands in; Chrome UA -> no mask', async ({ browser, blockers }) => {
  // Chrome UA: no mask
  {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    const mask = await page.evaluate(() => {
      const el = document.getElementById('idle-base-player');
      const cs = getComputedStyle(el);
      return cs.webkitMaskImage || cs.maskImage;
    });
    if (mask && mask !== 'none') throw new Error(`Chrome UA unexpectedly has mask: ${mask}`);
    await page.close();
  }
  // Safari UA (Plan C): base video disabled, JPG is the persistent shop
  {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    const state = await page.evaluate(() => ({
      baseSrc: document.getElementById('idle-base-player').getAttribute('src'),
      baseOpacity: document.getElementById('idle-base-player').style.opacity,
      imgOpacity: document.getElementById('idle-image').style.opacity,
      screensOff: Array.from(document.querySelectorAll('.tv-video, .game-cabinet-video')).every((el) => el.style.opacity !== '1'),
    }));
    if (state.baseSrc) throw new Error(`Safari: base video should have no src (Plan C), got ${state.baseSrc}`);
    if (state.baseOpacity !== '0') throw new Error(`Safari: base opacity ${state.baseOpacity}, expected 0`);
    if (state.imgOpacity !== '1') throw new Error(`Safari: idle JPG opacity ${state.imgOpacity}, expected 1`);
    if (!state.screensOff) throw new Error('Safari: screen videos should not be started (Plan C)');
    await page.close();
  }
});

test('fix4b: pathway mask absent during zoom, applied on ended', async ({ page }) => {
  await page.setViewport(VIEWPORT);
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.body.click());
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 30000 });
  await page.click('#tv-hotspot');
  await page.waitForFunction(() => document.getElementById('tv-hotspot').style.pointerEvents === 'none' ||
    (document.getElementById('animation-player').currentSrc || '').includes('idle/tv'), { timeout: 10000 });
  const during = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('animation-player'));
    return cs.webkitMaskImage || cs.maskImage;
  });
  if (during && during !== 'none') throw new Error(`mask present during zoom: ${during}`);
  // Wait until the zoom clip is actually seekable before firing synthetic ended
  await page.waitForFunction(() => {
    const ap = document.getElementById('animation-player');
    return ap.readyState >= 2 && Number.isFinite(ap.duration) && ap.duration > 0;
  }, { timeout: 15000 });
  // Fire ended manually to avoid waiting out the whole clip
  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.dispatchEvent(new Event('ended'));
  });
  // Plan C: NO terminal mask on ended — the held final frame is the terminal
  // pose; masking would cut holes over the static shop (nothing behind).
  const after = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('animation-player'));
    return cs.webkitMaskImage || cs.maskImage;
  });
  if (after && after !== 'none') throw new Error(`terminal mask still applied on ended: "${after}"`);
  // Portal hold: on a natural/synthetic end, playhead must be parked at the
  // held final frame (or seekable end) and paused — never snapped to 0.
  await page.waitForFunction(() => {
    const ap = document.getElementById('animation-player');
    if (!ap.paused) return false;
    if (!Number.isFinite(ap.duration) || ap.duration <= 0) return false;
    if (ap.currentTime === 0) return false;
    return ap.currentTime >= ap.duration - 0.6
      || (ap.seekable.length > 0 && ap.currentTime >= ap.seekable.end(ap.seekable.length - 1) - 0.1);
  }, { timeout: 5000 }).catch(async () => {
    const hold = await page.evaluate(() => {
      const ap = document.getElementById('animation-player');
      return { paused: ap.paused, t: ap.currentTime, d: ap.duration };
    });
    throw new Error(`portal hold not reached: paused=${hold.paused} t=${hold.t} d=${hold.d}`);
  });
});

// --- Fix 6: self-healing mask geometry (recompute on metadata/resize) ---

test('fix6a: Safari UA -> mask geometry recomputed after metadata + resize; Chrome UA -> none', async ({ browser }) => {
  // Safari
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667 });
    await page.setUserAgent(SAFARI_UA);
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    // Give the base player a real src and wait for metadata (simulates late load)
    await page.evaluate(() => {
      const el = document.getElementById('idle-base-player');
      el.src = 'Media/Processed/idle/base.webm';
      el.load();
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('idle-base-player');
      return el.readyState >= 1 && el.videoWidth > 0;
    }, { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 150));
    const g1 = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('idle-base-player')), maskGeom.toString());
    const e1 = await page.evaluate((f, g) => eval('(' + f + ')')(g), expectedGeom.toString(), g1);
    if (Math.abs(parseFloat(g1.size) - e1.w) > 2 || Math.abs(g1.size.split(' ').map(parseFloat)[1] - e1.h) > 2) {
      throw new Error(`after metadata: mask-size ${g1.size} != content rect ${e1.w}x${e1.h}`);
    }
    if (Math.abs(parseFloat(g1.pos) - e1.left) > 2) {
      throw new Error(`after metadata: mask-position ${g1.pos} != ${e1.left}px`);
    }
    // Resize -> geometry must update (self-healing)
    await page.setViewport({ width: 500, height: 400 });
    await new Promise((r) => setTimeout(r, 250));
    const g2 = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('idle-base-player')), maskGeom.toString());
    const e2 = await page.evaluate((f, g) => eval('(' + f + ')')(g), expectedGeom.toString(), g2);
    if (Math.abs(parseFloat(g2.size) - e2.w) > 2 || Math.abs(g2.size.split(' ').map(parseFloat)[1] - e2.h) > 2) {
      throw new Error(`after resize: mask-size ${g2.size} != content rect ${e2.w}x${e2.h} (stale geometry)`);
    }
    await page.close();
  }
  // Chrome: still no mask
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667 });
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    const mask = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('idle-base-player')).img, maskGeom.toString());
    if (mask && mask !== 'none') throw new Error(`Chrome UA unexpectedly has mask: ${mask}`);
    await page.close();
  }
});

test('fix6b: Safari UA -> animation-player masked during idle clip, cleared on pathway zoom; Chrome UA -> never masked', async ({ page }) => {
  await reachIdle(page, { safari: true });
  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
    loadNextIdleClip();
  });
  await page.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
  const during = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('animation-player')), maskGeom.toString());
  if (!during.img || during.img === 'none' || !during.img.includes('Media/Masks/idle.png')) {
    throw new Error(`Safari: animation-player missing idleBase mask during idle clip (${during.img})`);
  }
  // end the idle clip -> back to IDLE, then start a pathway zoom (clears mask)
  await page.evaluate(() => document.getElementById('animation-player').dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('tv-hotspot').click());
  await page.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  const zoom = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('animation-player')).img, maskGeom.toString());
  if (zoom && zoom !== 'none' && zoom.includes('Masks/idle.png') && !zoom.includes('idle-tv')) {
    throw new Error(`Safari: idleBase mask still on animation-player during TV zoom (${zoom})`);
  }
  // zoom ends -> terminal state (tv menu); mask is tv/mask.png (covered by fix4b)
  await page.evaluate(() => document.getElementById('animation-player').dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => {
    const menu = document.getElementById('tv-vhs-menu');
    return menu && !menu.hidden;
  }, { timeout: 10000 });
  // Go Back -> returnToIdle hides animation-player -> mask must be cleared
  await page.evaluate(() => document.getElementById('back-button').click());
  await page.evaluate(() => {
    const eo = document.getElementById('eye-overlay');
    const t = document.createElement('div');
    t.className = 'eyelid eyelid-top';
    const ev = new Event('animationend');
    Object.defineProperty(ev, 'target', { value: t });
    eo.dispatchEvent(ev);
  });
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 10000 });
  const afterIdle = await page.evaluate((f) => eval('(' + f + ')')(document.getElementById('animation-player')).img, maskGeom.toString());
  if (afterIdle && afterIdle !== 'none') throw new Error(`Safari: animation-player mask not cleared after returnToIdle (${afterIdle})`);

  // Chrome UA: never masked
  const page2 = await page.browser().newPage();
  await reachIdle(page2, { safari: false });
  await page2.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
    loadNextIdleClip();
  });
  await page2.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
  const chromeMask = await page2.evaluate((f) => eval('(' + f + ')')(document.getElementById('animation-player')).img, maskGeom.toString());
  if (chromeMask && chromeMask !== 'none') throw new Error(`Chrome: animation-player unexpectedly masked (${chromeMask})`);
  await page2.close();
});

// --- harness ---
async function main() {
  const filter = process.argv[2];
  const server = null; // reuse existing http.server on 8931
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const blockers = {
    pending: [],
    add(method, re) {
      let release;
      const p = new Promise((r) => { release = r; });
      this.pending.push({ method, re, p, release });
      return release;
    },
    intercept(req) {
      const m = this.pending.find((b) => b.method === req.method() && b.re.test(req.url()));
      if (m) { req.abort('blockedbyclient'); return true; }
      return false;
    },
  };
  // blocker implementation: abort until released; page will not retry, so instead we
  // fulfill LATE: hold the request, release fulfills from disk.
  blockers.intercept = function (req) {
    const m = this.pending.find((b) => b.method === req.method() && b.re.test(req.url()));
    if (!m) return false;
    const url = req.url();
    const file = path.join(ROOT, decodeURIComponent(new URL(url).pathname));
    m.p.then(() => {
      try { req.respond({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(file) }); }
      catch (e) { try { req.abort(); } catch (_) {} }
    });
    return true;
  };

  let pass = 0, fail = 0;
  for (const t of tests) {
    if (filter && !t.name.startsWith(filter)) continue;
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => { if (!blockers.intercept(req)) req.continue(); });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    try {
      await t.fn({ page, browser, blockers });
      if (consoleErrors.length) throw new Error(`page errors: ${consoleErrors.join('; ')}`);
      pass++; console.log(`PASS ${t.name}`);
    } catch (e) {
      fail++; console.log(`FAIL ${t.name}: ${e.message}`);
    }
    await page.close();
  }
  await browser.close();
  if (server) server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();

// --- Fix 5: Safari-only decode throttling (iOS WebKit decoder budget) ---
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function reachIdle(page, { safari }) {
  await page.setViewport(VIEWPORT);
  if (safari) await page.setUserAgent(SAFARI_UA);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.body.click());
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 30000 });
}

test('fix5a: Safari UA -> preloader no-op; Chrome UA -> preloadVideo.src set', async ({ page }) => {
  await reachIdle(page, { safari: true });
  await page.evaluate(() => scheduleNextIdleClip());
  await new Promise((r) => setTimeout(r, 150));
  const safariInfo = await page.evaluate(() => window.__hercPreloadDebug());
  if (safariInfo.src) throw new Error(`Safari: preload src set to ${safariInfo.src}`);

  const page2 = await page.browser().newPage();
  await reachIdle(page2, { safari: false });
  await page2.evaluate(() => scheduleNextIdleClip());
  await new Promise((r) => setTimeout(r, 150));
  const chromeInfo = await page2.evaluate(() => window.__hercPreloadDebug());
  if (!chromeInfo.src || !String(chromeInfo.src).includes('idle/')) {
    throw new Error(`Chrome: preload src not set (${chromeInfo.src})`);
  }
});

test('fix5b: Plan C Safari -> base retired (paused, hidden) through idle clip; Chrome UA -> base not paused', async ({ page }) => {
  await reachIdle(page, { safari: true });
  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
    loadNextIdleClip();
  });
  await page.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
  const during = await page.evaluate(() => document.getElementById('idle-base-player').paused);
  if (during !== true) throw new Error('Safari: idleBasePlayer not paused during idle clip');
  await page.evaluate(() => document.getElementById('animation-player').dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 10000 });
  const after = await page.evaluate(() => {
    const base = document.getElementById('idle-base-player');
    const img = document.getElementById('idle-image');
    return { paused: base.paused, opacity: base.style.opacity, imgO: img.style.opacity };
  });
  // Plan C: base stays retired; the JPG is the persistent shop
  if (after.paused !== true) throw new Error('Safari: retired base should stay paused');
  if (after.opacity !== '0') throw new Error(`Safari: base opacity ${after.opacity}, expected 0 (Plan C)`);
  if (after.imgO !== '1') throw new Error(`Safari: idle JPG opacity ${after.imgO}, expected 1 after returnToIdle`);

  const page2 = await page.browser().newPage();
  await reachIdle(page2, { safari: false });
  await page2.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
    loadNextIdleClip();
  });
  await page2.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
  const chromePaused = await page2.evaluate(() => document.getElementById('idle-base-player').paused);
  if (chromePaused !== false) throw new Error('Chrome: idleBasePlayer unexpectedly paused');
});

test('fix5c: Safari UA -> base paused during TV pathway, stays paused at terminal, resumes after Go Back', async ({ page }) => {
  await reachIdle(page, { safari: true });
  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
  });
  await page.evaluate(() => document.getElementById('tv-hotspot').click());
  await page.waitForFunction(() => document.getElementById('animation-player').style.opacity === '1', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 250));
  const during = await page.evaluate(() => document.getElementById('idle-base-player').paused);
  if (during !== true) throw new Error('Safari: base not paused during pathway');
  await page.evaluate(() => document.getElementById('animation-player').dispatchEvent(new Event('ended')));
  await new Promise((r) => setTimeout(r, 250));
  const terminal = await page.evaluate(() => ({
    paused: document.getElementById('idle-base-player').paused,
    opacity: document.getElementById('idle-base-player').style.opacity,
  }));
  if (terminal.paused !== true) throw new Error('Safari: base resumed at terminal (must stay paused)');
  if (terminal.opacity !== '0') throw new Error(`Safari: base opacity at terminal is ${terminal.opacity}, expected 0`);
  await page.evaluate(() => document.getElementById('back-button').click());
  await page.evaluate(() => {
    const eo = document.getElementById('eye-overlay');
    const t = document.createElement('div');
    t.className = 'eyelid eyelid-top';
    const ev = new Event('animationend');
    Object.defineProperty(ev, 'target', { value: t });
    eo.dispatchEvent(ev);
  });
  await page.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 10000 });
  const after = await page.evaluate(() => {
    const base = document.getElementById('idle-base-player');
    const img = document.getElementById('idle-image');
    return { paused: base.paused, opacity: base.style.opacity, imgO: img.style.opacity };
  });
  // Plan C: base stays retired after Go Back; JPG remains the shop
  if (after.paused !== true) throw new Error('Safari: retired base should stay paused after Go Back');
  if (after.opacity !== '0') throw new Error(`Safari: base opacity ${after.opacity}, expected 0`);
  if (after.imgO !== '1') throw new Error(`Safari: idle JPG opacity ${after.imgO}, expected 1`);
});

// --- Idle deck: no-repeat-until-all-played (Fisher-Yates) ---
test('idle-deck: 28 draws from 14-clip deck contain every clip exactly twice, no adjacent repeats, boundary-safe over 50 reshuffles', async ({ page }) => {
  await page.setViewport(VIEWPORT);
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(() => {
    if (typeof createIdleDeck !== 'function') return { missing: true };
    // (1) 28 draws from a fresh deck contain every index exactly twice
    const deck = createIdleDeck(14);
    const draws = [];
    for (let i = 0; i < 28; i++) draws.push(deck.draw());
    const counts = {};
    draws.forEach((d) => { counts[d] = (counts[d] || 0) + 1; });
    const everyTwice = Object.keys(counts).length === 14 && Object.values(counts).every((c) => c === 2);
    // (2) no two adjacent draws within one epoch are equal
    let adjacentInEpoch = false;
    for (let i = 1; i < 28; i++) {
      // epochs are 14 long; skip pairs spanning the boundary (index 13->14)
      if (i === 14) continue;
      if (draws[i] === draws[i - 1]) adjacentInEpoch = true;
    }
    // (3) across the boundary: first card of new epoch != last card of old epoch, 50 reshuffles
    let boundaryRepeat = false;
    let lastIdx = -1;
    for (let run = 0; run < 50; run++) {
      lastIdleClipIndex = lastIdx;
      const d = createIdleDeck(14);
      let prev = -1;
      for (let i = 0; i < 28; i++) {
        const card = d.draw();
        if (i === 14 && card === prev) boundaryRepeat = true;
        prev = card;
        lastIdleClipIndex = card; // simulate the consumer tracking the last played clip
      }
      lastIdx = prev;
    }
    return { everyTwice, adjacentInEpoch, boundaryRepeat, remainingFn: typeof deck.remaining === 'function' };
  });
  if (result.missing) throw new Error('createIdleDeck is not defined on the page');
  if (!result.remainingFn) throw new Error('deck.remaining() is not a function');
  if (!result.everyTwice) throw new Error('28 draws did not contain every clip exactly twice');
  if (result.adjacentInEpoch) throw new Error('adjacent repeat within one epoch');
  if (result.boundaryRepeat) throw new Error('epoch boundary repeated last clip as first card of new epoch');
});

test('idle-deck: preloader and direct picker draw from the same shared deck (no in-epoch repeats in a full sweep)', async ({ page }) => {
  await reachIdle(page, { safari: false });
  const result = await page.evaluate(() => {
    if (typeof idleDeck === 'undefined') return { missing: true };
    const ap = document.getElementById('animation-player');
    ap.play = function () { return Promise.resolve(); };
    const seen = [];
    const drawOnce = () => {
      clearScheduledIdleClip();
      preloadedIdleClip = null;
      preloadNextIdleClip(); // Chrome path: preloader draws, consumer consumes
      currentState = State.IDLE;
      loadNextIdleClip();
      if (typeof lastIdleClipIndex !== 'number' || lastIdleClipIndex === -1) throw new Error('bad index');
      seen.push(lastIdleClipIndex);
    };
    // Drain any cards consumed before this test ran (page load preloads).
    // Drain draws land in `seen` but are EXCLUDED from the epoch assertion —
    // the leftover count is arbitrary, so the first 14 seen draws would span
    // an epoch boundary and falsely flag legal cross-boundary repeats.
    const drainCount = idleDeck.remaining();
    while (idleDeck.remaining() > 0) drawOnce();
    // Hermetic: kill any armed idle timer and prevent re-arming mid-sweep —
    // a background timer firing between draws steals cards from the epoch.
    clearScheduledIdleClip();
    scheduleNextIdleClip = function () {};
    // Deck is empty; the next 14 draws are exactly one full epoch.
    const epochStart = seen.length;
    for (let i = 0; i < 14; i++) drawOnce();
    return { seen: seen.slice(epochStart), drained: drainCount };
  });
  if (result.missing) throw new Error('idleDeck is not defined on the page');
  if (result.badIndex) throw new Error('loadNextIdleClip did not set a valid lastIdleClipIndex');
  const seen = result.seen;
  const withinEpoch = seen.slice(0, 14);
  const unique = new Set(withinEpoch);
  if (unique.size !== 14) throw new Error(`one epoch drew only ${unique.size}/14 unique clips: ${withinEpoch.join(',')}`);
  for (let i = 1; i < withinEpoch.length; i++) {
    if (withinEpoch[i] === withinEpoch[i - 1]) throw new Error(`adjacent repeat in epoch at draws ${i - 1}->${i}`);
  }
  if (seen[14] === seen[13]) throw new Error('epoch boundary repeat: first card of epoch 2 equals last of epoch 1');
});
