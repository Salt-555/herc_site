const MEDIA_PATH = 'Media/Videos_Gaylords_Shop/';
const TV_CHANNELS = Array.isArray(window.BG_TV_CHANNELS) ? window.BG_TV_CHANNELS : [];

const TV_SCREEN = {
    baseWidth: 1440,
    baseHeight: 1440,
    corners: {
        topLeft: { x: 221, y: 508 },
        topRight: { x: 394, y: 518 },
        bottomLeft: { x: 217, y: 660 },
        bottomRight: { x: 396, y: 658 }
    }
};

const CONFIG = {
    debugAlphaBackground: false,
    idleDelay: {
        min: 5000,
        max: 15000
    },
    baseClip: `${MEDIA_PATH}Idle_photo.webm`,
    tvChannels: TV_CHANNELS,
    idleClips: [
        { id: 'blink', src: `${MEDIA_PATH}idle_blink.webm` },
        { id: 'speech-1', src: `${MEDIA_PATH}idle_speech1.webm` },
        { id: 'speech-3', src: `${MEDIA_PATH}Idle_speech3.webm` },
        { id: 'gun-threat', src: `${MEDIA_PATH}idle_gun_threat.webm` }
    ],
    pathways: {
        sleep: `${MEDIA_PATH}falls_asleep.webm`,
        tvZooms: [
            `${MEDIA_PATH}TV_zoom2.webm`
        ],
        gameZooms: [
            `${MEDIA_PATH}Game_Zoom1.mp4`
        ]
    }
};

const State = {
    IDLE: 'idle',
    LOADING_IDLE_CLIP: 'loading-idle-clip',
    PLAYING_IDLE_CLIP: 'playing-idle-clip',
    PATHWAY: 'pathway'
};

const characterDisplay = document.getElementById('character-display');
const idleImage = document.getElementById('idle-image');
const idleBasePlayer = document.getElementById('idle-base-player');
const animationPlayer = document.getElementById('animation-player');
const tvPlayer = document.getElementById('tv-player');
const tvHotspot = document.getElementById('tv-hotspot');
const gameHotspot = document.getElementById('game-hotspot');
const backButton = document.getElementById('back-button');
const eyeOverlay = document.getElementById('eye-overlay');

let currentState = State.IDLE;
let lastIdleClipIndex = -1;
let lastTvChannelIndex = -1;
let scheduledIdleTimeout = null;
let activeIdleClip = null;
let isReturningToIdle = false;

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

function scheduleNextIdleClip() {
    clearScheduledIdleClip();

    const delay = Math.random() * (CONFIG.idleDelay.max - CONFIG.idleDelay.min) + CONFIG.idleDelay.min;
    log(`Scheduling next idle clip in ${Math.round(delay)}ms`);

    scheduledIdleTimeout = setTimeout(loadNextIdleClip, delay);
}

function clearScheduledIdleClip() {
    if (!scheduledIdleTimeout) return;

    clearTimeout(scheduledIdleTimeout);
    scheduledIdleTimeout = null;
}

function loadNextIdleClip() {
    if (currentState !== State.IDLE) return;

    const index = getRandomIndex(CONFIG.idleClips, lastIdleClipIndex);
    if (index === -1) return;

    activeIdleClip = CONFIG.idleClips[index];
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

function returnToIdle() {
    if (currentState === State.IDLE) return;

    currentState = State.IDLE;
    activeIdleClip = null;

    animationPlayer.style.opacity = '0';
    animationPlayer.pause();
    animationPlayer.removeAttribute('src');
    animationPlayer.load();

    setSceneUnderlayVisible(true);
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

function startTvLoop() {
    if (!CONFIG.tvChannels.length) {
        tvPlayer.style.opacity = '0';
        return;
    }

    playRandomTvChannel();
}

function playRandomTvChannel() {
    const index = getRandomIndex(CONFIG.tvChannels, lastTvChannelIndex);
    if (index === -1) return;

    lastTvChannelIndex = index;
    tvPlayer.style.opacity = '1';
    log(`Playing TV channel: ${CONFIG.tvChannels[index]}`);

    playVideo(tvPlayer, CONFIG.tvChannels[index], { loop: CONFIG.tvChannels.length === 1 })
        .catch((error) => {
            tvPlayer.style.opacity = '0';
            log(`TV loop unavailable: ${error.message}`);
        });
}

function hideHotspots() {
    tvHotspot.hidden = true;
    gameHotspot.hidden = true;
}

function showHotspots() {
    tvHotspot.hidden = false;
    gameHotspot.hidden = false;
}

function showBackButton() {
    backButton.hidden = false;
}

function hideBackButton() {
    backButton.hidden = true;
}

function setSceneUnderlayVisible(isVisible) {
    if (!CONFIG.debugAlphaBackground) return;

    idleImage.style.opacity = isVisible ? '0' : '0';
    idleBasePlayer.style.opacity = isVisible ? '1' : '0';
    tvPlayer.style.opacity = isVisible && CONFIG.tvChannels.length ? '1' : '0';
}

function playPathwayClip(videoSrc) {
    clearScheduledIdleClip();
    hideHotspots();
    showBackButton();
    setSceneUnderlayVisible(false);

    currentState = State.PATHWAY;
    log(`Playing pathway clip: ${videoSrc}`);

    animationPlayer.style.opacity = '1';
    animationPlayer.loop = false;
    animationPlayer.src = videoSrc;
    animationPlayer.load();
}

function getSceneRect() {
    return idleImage.getBoundingClientRect();
}

function updateHotspotPositions() {
    const sceneRect = getSceneRect();
    const scaleX = sceneRect.width / 1024;
    const scaleY = sceneRect.height / 1024;

    const hotspots = [
        { element: tvHotspot, left: 142, top: 352, width: 173, height: 128 },
        { element: gameHotspot, left: 726, top: 410, width: 203, height: 290 }
    ];

    hotspots.forEach(({ element, left, top, width, height }) => {
        element.style.left = `${sceneRect.left + left * scaleX}px`;
        element.style.top = `${sceneRect.top + top * scaleY}px`;
        element.style.width = `${width * scaleX}px`;
        element.style.height = `${height * scaleY}px`;
    });

    updateTvScreenPosition(sceneRect);
}

function updateTvScreenPosition(sceneRect) {
    const wrapperRect = characterDisplay.getBoundingClientRect();
    const points = Object.values(TV_SCREEN.corners);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const scaleX = sceneRect.width / TV_SCREEN.baseWidth;
    const scaleY = sceneRect.height / TV_SCREEN.baseHeight;

    tvPlayer.style.left = `${sceneRect.left - wrapperRect.left + minX * scaleX}px`;
    tvPlayer.style.top = `${sceneRect.top - wrapperRect.top + minY * scaleY}px`;
    tvPlayer.style.width = `${(maxX - minX) * scaleX}px`;
    tvPlayer.style.height = `${(maxY - minY) * scaleY}px`;
}

tvPlayer.addEventListener('ended', () => {
    if (CONFIG.tvChannels.length > 1) playRandomTvChannel();
});

eyeOverlay.addEventListener('animationend', (event) => {
    if (!event.target.classList.contains('eyelid-top')) return;

    if (eyeOverlay.classList.contains('closing')) {
        window.location.reload();
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

tvHotspot.addEventListener('click', () => {
    const zooms = CONFIG.pathways.tvZooms;
    const randomTvZoom = zooms[getRandomIndex(zooms)];
    playPathwayClip(randomTvZoom);
});

gameHotspot.addEventListener('click', () => {
    const zooms = CONFIG.pathways.gameZooms;
    const randomGameZoom = zooms[getRandomIndex(zooms)];
    playPathwayClip(randomGameZoom);
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

window.addEventListener('resize', updateHotspotPositions);
window.addEventListener('load', () => {
    hideBackButton();
    updateHotspotPositions();
    startTvLoop();
    startBaseIdleLoop();
    scheduleNextIdleClip();
});

characterDisplay.addEventListener('transitionend', updateHotspotPositions);

log('Initializing animation controller');
