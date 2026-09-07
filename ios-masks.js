/* ios-masks.js
 * Safari/iOS decodes VP9 WebM but ignores the alpha channel, so the
 * character videos render opaque black over the screens behind them.
 * Fix without re-encoding: apply the scene's mask PNG as a CSS mask on the
 * character video elements, only on Safari/iOS (Chrome's baked alpha works).
 *
 * Geometry: the character videos use object-fit:contain centered in a
 * full-viewport element, so a plain 100%-element mask would mismatch. We
 * size/position the mask to the letterboxed content rect (same math as
 * getSceneRect) using mask-position + mask-size.
 *
 * Self-healing: masks are often applied before media has a src / metadata,
 * so element boxes are the browser default (300x150) and geometry is garbage.
 * Applied masks are tracked in a WeakMap and recomputed on video
 * 'loadedmetadata'/'loadeddata' and window 'resize', always from the CURRENT
 * box + videoWidth/Height.
 */

(function () {
    'use strict';

    const MASK_VER = 1;

    function isSafariLike() {
        const ua = navigator.userAgent || '';
        const isChromeLike = /Chrome|Chromium|CriOS|Edg|OPR|SamsungBrowser/.test(ua);
        const isSafari = /Safari/.test(ua) && !isChromeLike;
        // iPad-as-Mac desktop UA: Mac platform with multi-touch
        const iPadAsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
        return isSafari || iPadAsMac;
    }

    // Letterboxed content rect of a contained media inside its element box,
    // relative to the element box (0..1 values).
    function contentRectFraction(mediaWidth, mediaHeight, boxWidth, boxHeight) {
        if (!mediaWidth || !mediaHeight || !boxWidth || !boxHeight) {
            return { left: 0, top: 0, width: 1, height: 1 };
        }
        const mediaAspect = mediaWidth / mediaHeight;
        const boxAspect = boxWidth / boxHeight;
        let width, height;
        if (mediaAspect > boxAspect) {
            width = 1;
            height = boxAspect / mediaAspect;
        } else {
            height = 1;
            width = mediaAspect / boxAspect;
        }
        return { left: (1 - width) / 2, top: (1 - height) / 2, width, height };
    }

    function maskUrl(url) {
        return `url("${url}?v=${MASK_VER}")`;
    }

    // element -> maskSrc for every live applied mask
    const appliedMasks = new WeakMap();

    // Re-run the mask-size/position math from the CURRENT box + media size.
    function recomputeGeometry(video) {
        const maskSrc = appliedMasks.get(video);
        if (!maskSrc) return;
        applyContentMask(video, maskSrc);
    }

    function onMediaGeometryChange(event) {
        recomputeGeometry(event.target);
    }

    function onWindowResize() {
        // WeakMap is not iterable; registered elements tag themselves with a marker
        // attribute so we can find them. Cheap: only masked videos carry it.
        document.querySelectorAll('[data-ios-mask]').forEach(recomputeGeometry);
    }

    let resizeListenerInstalled = false;
    function ensureWindowResizeListener() {
        if (resizeListenerInstalled) return;
        window.addEventListener('resize', onWindowResize);
        resizeListenerInstalled = true;
    }

    // Apply a mask sized/positioned to the letterboxed content rect of `video`.
    // The mask image is assumed to match the media's square 1024x1024 space.
    function applyContentMask(video, maskSrc) {
        if (!video || !maskSrc) return;
        const media = video.videoWidth || video.naturalWidth || 1024;
        const mediaH = video.videoHeight || video.naturalHeight || 1024;
        const box = video.getBoundingClientRect();
        const frac = contentRectFraction(media, mediaH, box.width, box.height);
        const left = Math.round(frac.left * box.width);
        const top = Math.round(frac.top * box.height);
        const w = Math.round(frac.width * box.width);
        const h = Math.round(frac.height * box.height);
        video.style.webkitMaskImage = maskUrl(maskSrc);
        video.style.maskImage = maskUrl(maskSrc);
        video.style.webkitMaskSize = `${w}px ${h}px`;
        video.style.maskSize = `${w}px ${h}px`;
        video.style.webkitMaskRepeat = 'no-repeat';
        video.style.maskRepeat = 'no-repeat';
        video.style.webkitMaskPosition = `${left}px ${top}px`;
        video.style.maskPosition = `${left}px ${top}px`;

        const isNew = appliedMasks.get(video) !== maskSrc;
        appliedMasks.set(video, maskSrc);
        video.setAttribute('data-ios-mask', maskSrc);
        if (isNew) {
            video.addEventListener('loadedmetadata', onMediaGeometryChange);
            video.addEventListener('loadeddata', onMediaGeometryChange);
            ensureWindowResizeListener();
        }
    }

    function clearContentMask(video) {
        if (!video) return;
        ['webkitMaskImage', 'maskImage', 'webkitMaskSize', 'maskSize',
            'webkitMaskRepeat', 'maskRepeat', 'webkitMaskPosition', 'maskPosition']
            .forEach((prop) => { video.style[prop] = ''; });
        if (appliedMasks.get(video)) {
            appliedMasks.delete(video);
            video.removeAttribute('data-ios-mask');
            video.removeEventListener('loadedmetadata', onMediaGeometryChange);
            video.removeEventListener('loadeddata', onMediaGeometryChange);
        }
    }

    window.IOSMasking = {
        isSafariLike,
        contentRectFraction,
        applyContentMask,
        clearContentMask,
        MASK_SOURCES: {
            idleBase: 'Media/Sources/idle/mask.png',
            tvZoom: 'Media/Sources/idle/tv/mask.png',
            cabinetZoom: 'Media/Sources/idle/cabinet/mask.png',
        },
    };
})();
