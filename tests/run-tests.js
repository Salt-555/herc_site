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
test('fix4a: Safari UA -> idle-base-player gets mask-image, Chrome UA -> none', async ({ browser, blockers }) => {
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
  // Safari UA: mask present on idle base
  {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 300));
    const mask = await page.evaluate(() => {
      const el = document.getElementById('idle-base-player');
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { v: cs.webkitMaskImage || cs.maskImage, size: cs.webkitMaskSize || cs.maskSize, box };
    });
    if (!mask.v || mask.v === 'none') throw new Error('Safari UA: idle-base-player has no mask-image');
    if (!mask.v.includes('Media/Sources/idle/mask.png')) throw new Error(`unexpected mask url: ${mask.v}`);
    // Content-rect geometry: square media in a square-ish box -> mask matches the letterboxed content rect.
    const dim = mask.size.split(' ').map(parseFloat);
    const expected = Math.min(mask.box.width, mask.box.height);
    if (Math.abs(dim[0] - expected) > 2 || Math.abs(dim[1] - expected) > 2) {
      throw new Error(`mask-size ${mask.size} != content rect ${expected}px`);
    }
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
  // Fire ended manually to avoid waiting out the whole clip
  await page.evaluate(() => {
    const ap = document.getElementById('animation-player');
    ap.dispatchEvent(new Event('ended'));
  });
  const after = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('animation-player'));
    return cs.webkitMaskImage || cs.maskImage;
  });
  if (!after || after === 'none' || !after.includes('idle/tv/mask.png')) throw new Error(`mask not applied on ended: "${after}"`);
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
  if (!during.img || during.img === 'none' || !during.img.includes('Media/Sources/idle/mask.png')) {
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
  if (zoom && zoom !== 'none' && zoom.includes('Sources/idle/mask.png') && !zoom.includes('tv/mask.png')) {
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

test('fix5b: Safari UA -> base paused during idle clip, resumed after returnToIdle; Chrome UA -> base not paused', async ({ page }) => {
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
  const after = await page.evaluate(() => document.getElementById('idle-base-player').paused);
  if (after !== false) throw new Error('Safari: idleBasePlayer still paused after returnToIdle');

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
  const after = await page.evaluate(() => document.getElementById('idle-base-player').paused);
  if (after !== false) throw new Error('Safari: base not resumed after Go Back returnToIdle');
});
