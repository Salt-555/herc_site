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
        keepMuted: true,
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
        keepMuted: false,
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

/* =========================================================================
 *  Runtime state
 * ======================================================================= */

let currentState = State.IDLE;
let lastIdleClipIndex = -1;
let scheduledIdleTimeout = null;
let activeIdleClip = null;
let preloadedIdleClip = null;
let isReturningToIdle = false;
let audioUnlocked = false;
let masterVolume = 1.0;
let isMuted = false;

/* =========================================================================
 *  Audio controls
 *  All videos start muted for autoplay compliance. On first user
 *  interaction, unmute eligible elements. Mute button and volume slider
 *  control master volume across all audio-enabled video elements.
 * ======================================================================= */

const muteButton = document.getElementById('mute-button');
const volumeSlider = document.getElementById('volume-slider');

function getAudioElements() {
    const elements = [animationPlayer];
    SCREENS.forEach((screen) => {
        if (!screen.keepMuted) elements.push(screen.element);
    });
    return elements;
}

function applyVolume() {
    const vol = isMuted ? 0 : masterVolume;
    getAudioElements().forEach((el) => { el.volume = vol; });
}

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    SCREENS.forEach((screen) => {
        if (!screen.keepMuted) screen.element.muted = false;
    });
    animationPlayer.muted = false;
    applyVolume();

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
    applyVolume();
});

volumeSlider.addEventListener('input', () => {
    masterVolume = volumeSlider.value / 100;
    if (masterVolume > 0 && isMuted) {
        isMuted = false;
        muteButton.classList.remove('is-muted');
    }
    applyVolume();
});

/* =========================================================================
 *  Initialize background screens
 *  Each screen gets its own element ref, last-index tracker, and
 *  ended-event listener. No per-screen functions needed.
 * ======================================================================= */

SCREENS.forEach((screen) => {
    screen.element = document.getElementById(screen.elementId);
    screen.lastIndex = -1;
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
        playPathwayClip(clip);
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

function returnToIdle() {
    if (currentState === State.IDLE) return;

    currentState = State.IDLE;
    activeIdleClip = null;

    animationPlayer.style.opacity = '0';
    animationPlayer.pause();
    animationPlayer.removeAttribute('src');
    animationPlayer.load();

    idleBasePlayer.style.opacity = '1';
    SCREENS.forEach((screen) => {
        if (screen.channels.length) screen.element.style.opacity = '1';
    });

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

function playPathwayClip(videoSrc) {
    clearScheduledIdleClip();
    hideHotspots();
    showBackButton();

    currentState = State.PATHWAY;
    log(`Playing pathway clip: ${videoSrc}`);

    animationPlayer.style.opacity = '1';
    animationPlayer.loop = false;
    animationPlayer.src = videoSrc;
    animationPlayer.load();
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
    if (currentState === State.PLAYING_IDLE_CLIP) {
        log('Idle clip ended');
        returnToIdle();
        return;
    }

    if (currentState === State.PATHWAY) {
        log('Pathway clip ended');
        animationPlayer.pause();
    }
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
    startBaseIdleLoop();
    scheduleNextIdleClip();
});

characterDisplay.addEventListener('transitionend', updateLayout);

log('Initializing animation controller');
