const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await p.setViewport({ width: 375, height: 667 });
  await p.goto('http://127.0.0.1:8931/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));

  // idle base gets its src at wake (startBaseIdleLoop); verify after first click below
  await p.evaluate(() => document.body.click());
  await p.waitForFunction(() => {
    const el = document.getElementById('idle-base-player');
    return (el.getAttribute('src') || el.currentSrc || '').includes('Media/Processed/idle/base.webm');
  }, { timeout: 20000 });
  await p.waitForFunction(() => {
    const hs = document.getElementById('tv-hotspot');
    return hs && getComputedStyle(hs).display !== 'none';
  }, { timeout: 30000 });

  const pos = await p.evaluate(() => {
    const hs = document.getElementById('tv-hotspot');
    return { left: hs.offsetLeft, top: hs.offsetTop, w: hs.offsetWidth, h: hs.offsetHeight };
  });
  if (pos.left === 0 && pos.top === 0) throw new Error('hotspots not positioned: ' + JSON.stringify(pos));

  // Spy play() and click TV hotspot
  const count = await p.evaluate(() => {
    const ap = document.getElementById('animation-player');
    window.__c = 0;
    const orig = ap.play.bind(ap);
    ap.play = function () { window.__c++; return orig(); };
    window.__c = 0;
    document.getElementById('tv-hotspot').click();
    return window.__c;
  });
  if (count !== 1) throw new Error('sync play count: ' + count);
  await p.waitForFunction(() => (document.getElementById('animation-player').currentSrc || '').includes('idle/tv'), { timeout: 15000 });

  // Chrome must have NO mask
  const mask = await p.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('idle-base-player'));
    return cs.webkitMaskImage || cs.maskImage;
  });
  if (mask && mask !== 'none') throw new Error('Chrome unexpectedly masked: ' + mask);

  const realErrors = errors.filter((e) => !/404/.test(e));
  if (realErrors.length) throw new Error('errors: ' + realErrors.join(' | '));
  console.log('SMOKE PASS: load ok, no console errors, idle base src set, hotspots positioned', JSON.stringify(pos), 'sync play=1, tv pathway src ok, no Chrome mask');
  await b.close();
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
