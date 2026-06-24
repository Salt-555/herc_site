const MEDIA_PATH = 'Media/Processed_Gaylords_Shop/';

/* =========================================================================
 *  Coordinate helper — converts from any source coordinate space to
 *  rendered pixel position relative to the scene container.
 *  All coordinate definitions carry their own baseWidth/baseHeight so
 *  callers never need to remember which space they're in.
 * ======================================================================= */

function sceneToPixel(coord, sourceBase, sceneRect) {
    const scaleX = sceneRect.width / sourceBase;
    const scaleY = sceneRect.height / sourceBase;
    return {
        x: sceneRect.left + coord.x * scaleX,
        y: sceneRect.top + coord.y * scaleY
    };
}

/* =========================================================================
 *  Background Screens — data-driven system.
 *  Each entry defines a video layer positioned behind the alpha-masked
 *  character. To add a new screen: add an entry here, add a <video> in
 *  index.html, add a manifest.js with window.YOUR_CHANNELS, and add a
 *  CSS class with the clip-path.
 * ======================================================================= */

const SCREENS = [
    {
        id: 'tv',
        elementId: 'tv-player',
        hotspotId: 'tv-hotspot',
        channels: Array.isArray(window.BG_TV_CHANNELS) ? window.BG_TV_CHANNELS : [],
        baseSize: 1440,
        corners: {
            topLeft:     { x: 221, y: 508 },
            topRight:    { x: 394, y: 518 },
            bottomLeft:  { x: 217, y: 660 },
            bottomRight: { x: 396, y: 658 }
        }
    },
    {
        id: 'game-cabinet',
        elementId: 'game-cabinet-player',
        hotspotId: 'game-hotspot',
        channels: Array.isArray(window.GAME_CABINET_CHANNELS) ? window.GAME_CABINET_CHANNELS : [],
        baseSize: 1024,
        corners: {
            topLeft:     { x: 764, y: 495 },
            topRight:    { x: 881, y: 496 },
            bottomLeft:  { x: 769, y: 608 },
            bottomRight: { x: 889, y: 600 }
        }
    }
];

/* =========================================================================
 *  Hotspots — single source of truth.
 *  Coordinates are in 1024x1024 JPG space. Elements are looked up by ID.
 *  'pathway' names a key in CONFIG.pathways whose value is an array of
 *  clip paths; a random one is chosen on click.
 * ======================================================================= */

const HOTSPOTS = [
    { elementId: 'tv-hotspot',   left: 142, top: 352, width: 173, height: 128, pathway: 'tvZooms' },
    { elementId: 'game-hotspot', left: 726, top: 410, width: 203, height: 290, pathway: 'gameZooms' }
];

const HOTSPOT_BASE = 1024;

/* =========================================================================
 *  Config
 * ======================================================================= */

const CONFIG = {
    idleDelay: { min: 5000, max: 15000 },
    baseClip: `${MEDIA_PATH}Idle_photo.webm`,
    wakeClip: `${MEDIA_PATH}wakes_up.webm`,
    idleClips: [
        { id: 'blink',      src: `${MEDIA_PATH}idle_blink.webm` },
        { id: 'speech-1',   src: `${MEDIA_PATH}idle_speech1.webm` },
        { id: 'speech-2',   src: `${MEDIA_PATH}idle_speech2.webm` },
        { id: 'speech-3',   src: `${MEDIA_PATH}idle_speech3.webm` },
        { id: 'gun-threat', src: `${MEDIA_PATH}idle_gun_threat.webm` },
        { id: 'butt-itch',  src: `${MEDIA_PATH}butt_itch.webm` }
    ],
    pathways: {
        sleep: [`${MEDIA_PATH}falls_asleep.webm`],
        tvZooms: [`${MEDIA_PATH}TV_zoom2.webm`],
        gameZooms: [`${MEDIA_PATH}Game_Zoom1.webm`]
    }
};

/* =========================================================================
 *  State
 * ======================================================================= */

const State = {
    WAITING_WAKE: 'waiting-wake',
    PLAYING_WAKE: 'playing-wake',
    IDLE: 'idle',
    LOADING_IDLE_CLIP: 'loading-idle-clip',
    PLAYING_IDLE_CLIP: 'playing-idle-clip',
    PATHWAY: 'pathway'
};

/* =========================================================================
 *  DOM refs
 * ======================================================================= */

const characterDisplay = document.getElementById('character-display');
const idleImage = document.getElementById('idle-image');
const idleBasePlayer = document.getElementById('idle-base-player');
const animationPlayer = document.getElementById('animation-player');
const backButton = document.getElementById('back-button');
const eyeOverlay = document.getElementById('eye-overlay');
const arcadeCanvas = document.getElementById('arcade-canvas');
const arcadeControls = document.getElementById('arcade-controls');
const tvVhsMenu = document.getElementById('tv-vhs-menu');
const cabinetArcade = window.createCabinetArcade
    ? window.createCabinetArcade({ canvas: arcadeCanvas, guide: arcadeControls })
    : null;

const CABINET_ARCADE_SCREEN = {
    baseSize: 1440,
    left: 510,
    top: 637,
    width: 391,
    height: 318
};

const TV_VHS_SCREEN = {
    baseSize: 1440,
    left: 302,
    top: 284,
    width: 898,
    height: 664
};

/* =========================================================================
 *  Runtime state
 * ======================================================================= */

let currentState = State.WAITING_WAKE;
let lastIdleClipIndex = -1;
let scheduledIdleTimeout = null;
let activeIdleClip = null;
let preloadedIdleClip = null;
let isReturningToIdle = false;
let audioUnlocked = false;
let masterVolume = 1.0;
let isMuted = false;
let activePathwayName = null;
let cabinetIdleLayersSuppressed = false;
let zoomIdleLayersSuppressed = false;
let wakeStarted = false;

/* =========================================================================
 *  Sound Engine
 *  Manages three audio layers with smooth cross-fading:
 *    1. BG Music   — always playing, ducks when hovering a screen
 *    2. TV audio   — silent by default, fades up on hover
 *    3. Game Cabinet audio — silent by default, fades up on hover
 *
 *  Volume model (all multiplied by masterVolume):
 *    - Default:   bgMusic = AUDIO_MIX.bgDefault,  screens = 0
 *    - Hovering:  bgMusic = AUDIO_MIX.bgDucked,   hovered screen = AUDIO_MIX.screenFocused
 *
 *  Transitions use requestAnimationFrame for smooth ramping.
 * ======================================================================= */

const AUDIO_MIX = {
    bgDefault:     0.1,     // BG music volume when nothing is hovered
    bgDucked:      0.05,    // BG music volume when hovering a screen
    charDefault:   0.7,     // Character clip volume when nothing is hovered
    charDucked:    0.3,     // Character clip volume when hovering a screen
    screenFocused: 0.4,     // Screen volume when hovered (full)
    fadeSpeed:     4.0      // Units per second (0→1 in 250ms)
};

const muteButton = document.getElementById('mute-button');
const volumeSlider = document.getElementById('volume-slider');

/* --- BG Music player --- */
const bgMusicPlayer = document.getElementById('bg-music-player');
let bgMusicLastIndex = -1;
const bgMusicTracks = Array.isArray(window.BG_MUSIC_TRACKS) ? window.BG_MUSIC_TRACKS : [];

function playRandomBgTrack() {
    if (!bgMusicTracks.length) return;
    const index = getRandomIndex(bgMusicTracks, bgMusicLastIndex);
    if (index === -1) return;
    bgMusicLastIndex = index;
    bgMusicPlayer.src = bgMusicTracks[index];
    bgMusicPlayer.load();
    bgMusicPlayer.play().catch(() => {});
    log(`BG Music: playing ${bgMusicTracks[index]}`);
}

bgMusicPlayer.addEventListener('ended', () => {
    if (bgMusicTracks.length > 1) {
        playRandomBgTrack();
    } else if (bgMusicTracks.length === 1) {
        bgMusicPlayer.currentTime = 0;
        bgMusicPlayer.play().catch(() => {});
    }
});

/* --- Volume targets & current levels (pre-masterVolume, 0-1) --- */
const volumeTargets = { bgMusic: AUDIO_MIX.bgDefault, character: AUDIO_MIX.charDefault };
const volumeCurrent = { bgMusic: 0, character: 0 };

/* Per-screen volume tracking is stored on the screen objects after init.
   screen.volTarget = 0;  screen.volCurrent = 0;                         */

let hoveredScreen = null;
let volumeRafId = null;

function setHoverTarget(screen) {
    hoveredScreen = screen;
    if (screen) {
        volumeTargets.bgMusic = AUDIO_MIX.bgDucked;
        volumeTargets.character = AUDIO_MIX.charDucked;
        SCREENS.forEach((s) => { s.volTarget = (s === screen) ? AUDIO_MIX.screenFocused : 0; });
    } else {
        volumeTargets.bgMusic = AUDIO_MIX.bgDefault;
        volumeTargets.character = AUDIO_MIX.charDefault;
        SCREENS.forEach((s) => { s.volTarget = 0; });
    }
    startVolumeFade();
}

function startVolumeFade() {
    if (volumeRafId) return;
    let lastTime = performance.now();
    function tick(now) {
        const dt = (now - lastTime) / 1000;
        lastTime = now;
        let done = true;

        // Ramp BG music
        volumeCurrent.bgMusic = ramp(volumeCurrent.bgMusic, volumeTargets.bgMusic, dt);
        if (Math.abs(volumeCurrent.bgMusic - volumeTargets.bgMusic) > 0.001) done = false;

        // Ramp character (idle clips, pathway clips)
        volumeCurrent.character = ramp(volumeCurrent.character, volumeTargets.character, dt);
        if (Math.abs(volumeCurrent.character - volumeTargets.character) > 0.001) done = false;

        // Ramp each screen
        SCREENS.forEach((s) => {
            s.volCurrent = ramp(s.volCurrent, s.volTarget, dt);
            if (Math.abs(s.volCurrent - s.volTarget) > 0.001) done = false;
        });

        commitVolumes();

        if (done) {
            volumeRafId = null;
        } else {
            volumeRafId = requestAnimationFrame(tick);
        }
    }
    volumeRafId = requestAnimationFrame(tick);
}

function ramp(current, target, dt) {
    current = clampVolume(current);
    target = clampVolume(target);
    const step = AUDIO_MIX.fadeSpeed * dt;
    if (current < target) return Math.min(current + step, target);
    if (current > target) return Math.max(current - step, target);
    return target;
}

function clampVolume(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function commitVolumes() {
    /* Before first user gesture everything stays muted (autoplay policy) */
    if (!audioUnlocked) {
        if (cabinetArcade) cabinetArcade.setAudioState({ muted: true, volume: clampVolume(masterVolume) });
        return;
    }
    const m = isMuted ? 0 : clampVolume(masterVolume);
    bgMusicPlayer.volume = clampVolume(volumeCurrent.bgMusic * m);
    SCREENS.forEach((s) => {
        if (s.element) s.element.volume = clampVolume(s.volCurrent * m);
    });
    animationPlayer.volume = clampVolume(volumeCurrent.character * m);
    if (cabinetArcade) cabinetArcade.setAudioState({ muted: isMuted, volume: clampVolume(masterVolume) });
}

function applyVolume() {
    commitVolumes();
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    /* Unmute elements (browsers block playback of unmuted media without
       a user gesture, so this must happen inside a click/keydown handler) */
    SCREENS.forEach((s) => { s.element.muted = false; });
    animationPlayer.muted = false;
    bgMusicPlayer.muted = false;

    /* Reset ramp state so volumes fade in from zero */
    volumeCurrent.bgMusic = 0;
    volumeCurrent.character = 0;
    SCREENS.forEach((s) => { s.volCurrent = 0; });

    commitVolumes();
    playRandomBgTrack();
    startVolumeFade();

    log('Audio unlocked');
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
}

document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);

muteButton.addEventListener('click', (e) => {
    e.stopPropagation();
    isMuted = !isMuted;
    muteButton.classList.toggle('is-muted', isMuted);
    commitVolumes();
});

volumeSlider.addEventListener('input', () => {
    masterVolume = clampVolume(volumeSlider.value / 100);
    if (masterVolume > 0 && isMuted) {
        isMuted = false;
        muteButton.classList.remove('is-muted');
    }
    commitVolumes();
});

/* =========================================================================
 *  Initialize background screens
 *  Each screen gets its own element ref, last-index tracker, and
 *  ended-event listener. No per-screen functions needed.
 * ======================================================================= */

SCREENS.forEach((screen) => {
    screen.element = document.getElementById(screen.elementId);
    screen.lastIndex = -1;
    screen.volTarget = 0;
    screen.volCurrent = 0;
    screen.element.volume = 0;

    /* Wire hover listeners on the associated hotspot element */
    const hotspotEl = document.getElementById(screen.hotspotId);
    if (hotspotEl) {
        hotspotEl.addEventListener('mouseenter', () => { setHoverTarget(screen); });
        hotspotEl.addEventListener('mouseleave', () => { setHoverTarget(null); });
    }
});

function playRandomChannel(screen) {
    if (!screen.channels.length) {
        screen.element.style.opacity = '0';
        return;
    }

    const index = getRandomIndex(screen.channels, screen.lastIndex);
    if (index === -1) return;

    screen.lastIndex = index;
    screen.element.style.opacity = '1';
    log(`Playing ${screen.id} channel: ${screen.channels[index]}`);

    playVideo(screen.element, screen.channels[index], {
        loop: screen.channels.length === 1
    }).catch((error) => {
        screen.element.style.opacity = '0';
        log(`${screen.id} playback error: ${error.message}`);
    });
}

function updateScreenPosition(screen, sceneRect) {
    const wrapperRect = characterDisplay.getBoundingClientRect();
    const points = Object.values(screen.corners);
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const scaleX = sceneRect.width / screen.baseSize;
    const scaleY = sceneRect.height / screen.baseSize;

    screen.element.style.left = `${sceneRect.left - wrapperRect.left + minX * scaleX}px`;
    screen.element.style.top = `${sceneRect.top - wrapperRect.top + minY * scaleY}px`;
    screen.element.style.width = `${(maxX - minX) * scaleX}px`;
    screen.element.style.height = `${(maxY - minY) * scaleY}px`;
}

SCREENS.forEach((screen) => {
    screen.element.addEventListener('ended', () => {
        if (screen.channels.length > 1) playRandomChannel(screen);
    });
});

/* =========================================================================
 *  Initialize hotspots
 *  Elements are looked up once; click handlers wired from config.
 * ======================================================================= */

const hotspotElements = HOTSPOTS.map((hs) => {
    const el = document.getElementById(hs.elementId);
    hs.element = el;

    el.addEventListener('click', () => {
        const clips = CONFIG.pathways[hs.pathway];
        if (!clips || !clips.length) return;
        const clip = clips[getRandomIndex(clips)];
        playPathwayClip(clip, hs.pathway);
    });

    return el;
});

/* =========================================================================
 *  Utilities
 * ======================================================================= */

function log(message) {
    console.log(`[${currentState}] ${message}`);
}

function getRandomIndex(items, lastIndex = -1) {
    if (!items.length) return -1;
    let index;
    do {
        index = Math.floor(Math.random() * items.length);
    } while (index === lastIndex && items.length > 1);
    return index;
}

function playVideo(video, src, { loop = false } = {}) {
    video.loop = loop;
    if (video.getAttribute('src') !== src) {
        video.src = src;
        video.load();
    }
    return video.play();
}

/* =========================================================================
 *  Idle clip preloading
 *  During idle state, we preload the next random clip into a detached
 *  <video> element so it's ready instantly when the timer fires.
 * ======================================================================= */

const preloadVideo = document.createElement('video');
preloadVideo.muted = true;
preloadVideo.preload = 'auto';

function preloadNextIdleClip() {
    const index = getRandomIndex(CONFIG.idleClips, lastIdleClipIndex);
    if (index === -1) return;

    preloadedIdleClip = { index, clip: CONFIG.idleClips[index] };
    preloadVideo.src = CONFIG.idleClips[index].src;
    preloadVideo.load();
    log(`Preloading next idle clip: ${CONFIG.idleClips[index].id}`);
}

/* =========================================================================
 *  Idle scheduling
 * ======================================================================= */

function scheduleNextIdleClip() {
    clearScheduledIdleClip();
    const delay = Math.random() * (CONFIG.idleDelay.max - CONFIG.idleDelay.min) + CONFIG.idleDelay.min;
    log(`Scheduling next idle clip in ${Math.round(delay)}ms`);
    scheduledIdleTimeout = setTimeout(loadNextIdleClip, delay);

    preloadNextIdleClip();
}

function clearScheduledIdleClip() {
    if (!scheduledIdleTimeout) return;
    clearTimeout(scheduledIdleTimeout);
    scheduledIdleTimeout = null;
}

function loadNextIdleClip() {
    if (currentState !== State.IDLE) return;

    let index, clip;
    if (preloadedIdleClip) {
        index = preloadedIdleClip.index;
        clip = preloadedIdleClip.clip;
        preloadedIdleClip = null;
    } else {
        index = getRandomIndex(CONFIG.idleClips, lastIdleClipIndex);
        if (index === -1) return;
        clip = CONFIG.idleClips[index];
    }

    activeIdleClip = clip;
    lastIdleClipIndex = index;
    currentState = State.LOADING_IDLE_CLIP;

    log(`Loading idle clip: ${activeIdleClip.id}`);
    animationPlayer.style.opacity = '0';
    animationPlayer.loop = false;
    animationPlayer.src = activeIdleClip.src;
    animationPlayer.load();
}

function playLoadedIdleClip() {
    if (currentState !== State.LOADING_IDLE_CLIP || !activeIdleClip) return;

    currentState = State.PLAYING_IDLE_CLIP;
    log(`Playing idle clip: ${activeIdleClip.id}`);
    animationPlayer.style.opacity = '1';

    animationPlayer.play().catch((error) => {
        log(`Idle clip play error: ${error.message}`);
        returnToIdle();
    });
}

/* =========================================================================
 *  State transitions
 * ======================================================================= */

function prepareWakeSequence() {
    currentState = State.WAITING_WAKE;
    wakeStarted = false;
    hideHotspots();
    hideCabinetArcade();
    hideTvVhsMenu();

    animationPlayer.style.opacity = '1';
    animationPlayer.loop = false;
    animationPlayer.muted = true;
    animationPlayer.src = CONFIG.wakeClip;
    animationPlayer.load();

    log('Wake clip loaded and waiting for first click');
    document.addEventListener('click', startWakeSequence, { once: true });
}

function startWakeSequence() {
    if (currentState !== State.WAITING_WAKE || wakeStarted) return;
    wakeStarted = true;
    currentState = State.PLAYING_WAKE;

    animationPlayer.currentTime = 0;
    animationPlayer.style.opacity = '1';
    startBaseIdleLoop();

    animationPlayer.play().catch((error) => {
        log(`Wake clip play error: ${error.message}`);
        finishWakeSequence();
    });
}

function finishWakeSequence() {
    if (currentState !== State.PLAYING_WAKE && currentState !== State.WAITING_WAKE) return;

    currentState = State.IDLE;
    animationPlayer.style.opacity = '0';
    animationPlayer.pause();
    animationPlayer.removeAttribute('src');
    animationPlayer.load();

    idleBasePlayer.style.opacity = '1';
    hideBackButton();
    showHotspots();
    scheduleNextIdleClip();
}

function returnToIdle() {
    if (currentState === State.IDLE) return;

    currentState = State.IDLE;
    activeIdleClip = null;
    activePathwayName = null;
    cabinetIdleLayersSuppressed = false;
    zoomIdleLayersSuppressed = false;

    animationPlayer.style.opacity = '0';
    animationPlayer.pause();
    animationPlayer.removeAttribute('src');
    animationPlayer.load();

    idleBasePlayer.style.opacity = '1';
    hideCabinetArcade();
    hideTvVhsMenu();
    resumeBackgroundScreens();

    hideBackButton();
    showHotspots();
    scheduleNextIdleClip();
}

function startBaseIdleLoop() {
    idleBasePlayer.style.opacity = '1';

    playVideo(idleBasePlayer, CONFIG.baseClip, { loop: true })
        .then(() => {
            idleImage.style.opacity = '0';
            log('Base idle WebM loop started');
        })
        .catch((error) => {
            idleBasePlayer.style.opacity = '0';
            idleImage.style.opacity = '1';
            log(`Base idle loop unavailable, using JPG fallback: ${error.message}`);
        });
}

function playPathwayClip(videoSrc, pathwayName) {
    clearScheduledIdleClip();
    hideHotspots();
    showBackButton();

    currentState = State.PATHWAY;
    activePathwayName = pathwayName;
    log(`Playing pathway clip: ${videoSrc}`);

    if (activePathwayName === 'gameZooms') {
        enterCabinetArcadePathway();
    } else if (activePathwayName === 'tvZooms') {
        enterTvVhsPathway();
    } else {
        hideCabinetArcade();
        hideTvVhsMenu();
    }

    animationPlayer.style.opacity = '1';
    animationPlayer.loop = false;
    animationPlayer.src = videoSrc;
    animationPlayer.load();
}

function enterCabinetArcadePathway() {
    setHoverTarget(null);
    hideCabinetArcade();
    hideTvVhsMenu();
    cabinetIdleLayersSuppressed = false;
    idleBasePlayer.style.opacity = '1';
    SCREENS.forEach((screen) => {
        screen.volTarget = 0;
        if (screen.channels.length) screen.element.style.opacity = '1';
    });
    startVolumeFade();
}

function enterTvVhsPathway() {
    setHoverTarget(null);
    hideCabinetArcade();
    hideTvVhsMenu();
    zoomIdleLayersSuppressed = false;
    idleBasePlayer.style.opacity = '1';
    SCREENS.forEach((screen) => {
        screen.volTarget = 0;
        if (screen.channels.length) screen.element.style.opacity = '1';
    });
    startVolumeFade();
}

function suppressCabinetIdleLayers() {
    if (cabinetIdleLayersSuppressed) return;
    cabinetIdleLayersSuppressed = true;
    idleBasePlayer.style.opacity = '0';
    SCREENS.forEach((screen) => {
        screen.volTarget = 0;
        screen.element.pause();
        screen.element.style.opacity = '0';
    });
    startVolumeFade();
}

function suppressTvIdleLayers() {
    if (zoomIdleLayersSuppressed) return;
    zoomIdleLayersSuppressed = true;
    idleBasePlayer.style.opacity = '0';
    SCREENS.forEach((screen) => {
        screen.volTarget = 0;
        screen.element.pause();
        screen.element.style.opacity = '0';
    });
    startVolumeFade();
}

function showCabinetArcadeMenu() {
    if (!cabinetArcade) return;
    updateArcadePosition();
    cabinetArcade.showMenu();
}

function hideCabinetArcade() {
    if (cabinetArcade) cabinetArcade.hide();
}

function showTvVhsMenu() {
    if (!tvVhsMenu) return;
    updateTvVhsPosition();
    tvVhsMenu.hidden = false;
    tvVhsMenu.classList.add('is-active');
}

function hideTvVhsMenu() {
    if (!tvVhsMenu) return;
    tvVhsMenu.classList.remove('is-active');
    tvVhsMenu.hidden = true;
}

function resumeBackgroundScreens() {
    SCREENS.forEach((screen) => {
        if (!screen.channels.length) {
            screen.element.style.opacity = '0';
            return;
        }

        screen.element.style.opacity = '1';
        if (!screen.element.currentSrc) {
            playRandomChannel(screen);
            return;
        }

        screen.element.play().catch((error) => {
            log(`${screen.id} resume error: ${error.message}`);
        });
    });
}

/* =========================================================================
 *  Hotspot visibility
 * ======================================================================= */

function hideHotspots() {
    hotspotElements.forEach((el) => { el.hidden = true; });
}

function showHotspots() {
    hotspotElements.forEach((el) => { el.hidden = false; });
}

/* =========================================================================
 *  Back button
 * ======================================================================= */

function showBackButton() {
    backButton.hidden = false;
}

function hideBackButton() {
    backButton.hidden = true;
}

/* =========================================================================
 *  Layout — positions hotspots and background screens
 * ======================================================================= */

function getSceneRect() {
    return idleImage.getBoundingClientRect();
}

function updateLayout() {
    const sceneRect = getSceneRect();

    // Position hotspots (all in 1024x1024 space)
    const scaleX = sceneRect.width / HOTSPOT_BASE;
    const scaleY = sceneRect.height / HOTSPOT_BASE;

    HOTSPOTS.forEach((hs) => {
        hs.element.style.left = `${sceneRect.left + hs.left * scaleX}px`;
        hs.element.style.top = `${sceneRect.top + hs.top * scaleY}px`;
        hs.element.style.width = `${hs.width * scaleX}px`;
        hs.element.style.height = `${hs.height * scaleY}px`;
    });

    // Position background screens (each carries its own base size)
    SCREENS.forEach((screen) => {
        updateScreenPosition(screen, sceneRect);
    });

    updateArcadePosition(sceneRect);
    updateTvVhsPosition(sceneRect);
}

function updateArcadePosition(sceneRect = getSceneRect()) {
    if (!arcadeCanvas) return;
    const wrapperRect = characterDisplay.getBoundingClientRect();
    const scaleX = sceneRect.width / CABINET_ARCADE_SCREEN.baseSize;
    const scaleY = sceneRect.height / CABINET_ARCADE_SCREEN.baseSize;

    arcadeCanvas.style.left = `${sceneRect.left - wrapperRect.left + CABINET_ARCADE_SCREEN.left * scaleX}px`;
    arcadeCanvas.style.top = `${sceneRect.top - wrapperRect.top + CABINET_ARCADE_SCREEN.top * scaleY}px`;
    arcadeCanvas.style.width = `${CABINET_ARCADE_SCREEN.width * scaleX}px`;
    arcadeCanvas.style.height = `${CABINET_ARCADE_SCREEN.height * scaleY}px`;
}

function updateTvVhsPosition(sceneRect = getSceneRect()) {
    if (!tvVhsMenu) return;
    const wrapperRect = characterDisplay.getBoundingClientRect();
    const scaleX = sceneRect.width / TV_VHS_SCREEN.baseSize;
    const scaleY = sceneRect.height / TV_VHS_SCREEN.baseSize;

    tvVhsMenu.style.left = `${sceneRect.left - wrapperRect.left + TV_VHS_SCREEN.left * scaleX}px`;
    tvVhsMenu.style.top = `${sceneRect.top - wrapperRect.top + TV_VHS_SCREEN.top * scaleY}px`;
    tvVhsMenu.style.width = `${TV_VHS_SCREEN.width * scaleX}px`;
    tvVhsMenu.style.height = `${TV_VHS_SCREEN.height * scaleY}px`;
}

/* =========================================================================
 *  Event listeners
 * ======================================================================= */

eyeOverlay.addEventListener('animationend', (event) => {
    if (!event.target.classList.contains('eyelid-top')) return;

    if (eyeOverlay.classList.contains('closing')) {
        // Eyelids closed — reset to idle instead of full page reload
        eyeOverlay.classList.remove('closing');
        isReturningToIdle = false;
        returnToIdle();

        // Re-open the eyelids
        eyeOverlay.classList.remove('done');
        const eyelids = eyeOverlay.querySelectorAll('.eyelid');
        eyelids.forEach((lid) => {
            lid.style.animation = 'none';
            void lid.offsetHeight;  // force reflow
            lid.style.animation = '';
        });
        return;
    }

    eyeOverlay.classList.add('done');
});

animationPlayer.addEventListener('canplay', () => {
    if (currentState === State.WAITING_WAKE) {
        animationPlayer.pause();
        animationPlayer.currentTime = 0;
        animationPlayer.style.opacity = '1';
        return;
    }

    if (currentState === State.LOADING_IDLE_CLIP) {
        playLoadedIdleClip();
        return;
    }

    if (currentState === State.PATHWAY) {
        animationPlayer.play().catch((error) => {
            log(`Pathway play error: ${error.message}`);
            returnToIdle();
        });
    }
});

animationPlayer.addEventListener('ended', () => {
    if (currentState === State.PLAYING_WAKE) {
        log('Wake clip ended');
        finishWakeSequence();
        return;
    }

    if (currentState === State.PLAYING_IDLE_CLIP) {
        log('Idle clip ended');
        returnToIdle();
        return;
    }

    if (currentState === State.PATHWAY) {
        log('Pathway clip ended');
        animationPlayer.pause();
        if (activePathwayName === 'gameZooms') suppressCabinetIdleLayers();
        if (activePathwayName === 'gameZooms') showCabinetArcadeMenu();
        if (activePathwayName === 'tvZooms') suppressTvIdleLayers();
        if (activePathwayName === 'tvZooms') showTvVhsMenu();
    }
});

animationPlayer.addEventListener('timeupdate', () => {
    if (currentState !== State.PATHWAY) return;
    if (activePathwayName !== 'gameZooms' && activePathwayName !== 'tvZooms') return;
    if (!Number.isFinite(animationPlayer.duration) || animationPlayer.duration <= 0) return;
    if (animationPlayer.currentTime < animationPlayer.duration * 0.25) return;

    if (activePathwayName === 'gameZooms') suppressCabinetIdleLayers();
    if (activePathwayName === 'tvZooms') suppressTvIdleLayers();
});

animationPlayer.addEventListener('error', () => {
    log('Animation video error');
    returnToIdle();
});

backButton.addEventListener('click', () => {
    if (isReturningToIdle) return;

    isReturningToIdle = true;
    clearScheduledIdleClip();
    hideBackButton();
    hideHotspots();
    animationPlayer.pause();
    eyeOverlay.classList.remove('done');
    eyeOverlay.classList.add('closing');
});

/* =========================================================================
 *  Startup
 * ======================================================================= */

window.addEventListener('resize', updateLayout);
window.addEventListener('load', () => {
    hideBackButton();
    updateLayout();
    SCREENS.forEach((screen) => playRandomChannel(screen));
    prepareWakeSequence();
});

characterDisplay.addEventListener('transitionend', updateLayout);

log('Initializing animation controller');
