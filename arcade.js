/* =========================================================================
 *  Cabinet Arcade
 *  Plain JS mini-game layer for the game cabinet zoom.
 * ======================================================================= */

(function () {
    const GAME_WIDTH = 770;
    const GAME_HEIGHT = 632;
    const TWO_PI = Math.PI * 2;

    function createCabinetArcade({ canvas, guide }) {
        if (!canvas || !guide) return null;

        const screenCtx = canvas.getContext('2d');
        const bufferCanvas = document.createElement('canvas');
        const ctx = bufferCanvas.getContext('2d');
        const keys = new Set();
        const mouse = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2, active: false, down: false };

        let active = false;
        let mode = 'menu';
        let rafId = null;
        let lastTime = 0;
        let audioContext = null;
        let outputGain = null;
        let isMuted = true;
        let masterVolume = 1;
        let lastThrustSound = 0;

        let ship;
        let bullets;
        let roaches;
        let particles;
        let score;
        let lives;
        let wave;
        let fireCooldown;
        let respawnTimer;
        let menuPulse = 0;

        canvas.width = GAME_WIDTH;
        canvas.height = GAME_HEIGHT;
        bufferCanvas.width = GAME_WIDTH;
        bufferCanvas.height = GAME_HEIGHT;
        canvas.tabIndex = -1;

        function showMenu() {
            active = true;
            mode = 'menu';
            keys.clear();
            mouse.down = false;
            canvas.hidden = false;
            guide.hidden = false;
            canvas.classList.add('is-active');
            updateGuide();
            startLoop();
            setTimeout(() => canvas.focus({ preventScroll: true }), 0);
        }

        function hide() {
            active = false;
            mode = 'menu';
            keys.clear();
            mouse.down = false;
            canvas.classList.remove('is-active');
            canvas.hidden = true;
            guide.hidden = true;
            stopLoop();
        }

        function setAudioState({ muted, volume }) {
            isMuted = Boolean(muted);
            masterVolume = Math.max(0, Math.min(1, Number(volume) || 0));
            if (outputGain) outputGain.gain.value = isMuted ? 0 : masterVolume * 0.28;
        }

        function startGame() {
            mode = 'playing';
            score = 0;
            lives = 3;
            wave = 1;
            bullets = [];
            roaches = [];
            particles = [];
            fireCooldown = 0;
            respawnTimer = 0;
            resetShip();
            spawnWave();
            updateGuide();
            playSound('select');
        }

        function resetShip() {
            ship = {
                x: GAME_WIDTH / 2,
                y: GAME_HEIGHT / 2,
                vx: 0,
                vy: 0,
                angle: -Math.PI / 2,
                radius: 18,
                invuln: 2.2
            };
        }

        function spawnWave() {
            const count = Math.min(4 + wave, 9);
            for (let i = 0; i < count; i++) {
                const side = Math.floor(Math.random() * 4);
                const x = side === 0 ? -30 : side === 1 ? GAME_WIDTH + 30 : Math.random() * GAME_WIDTH;
                const y = side === 2 ? -30 : side === 3 ? GAME_HEIGHT + 30 : Math.random() * GAME_HEIGHT;
                roaches.push(makeRoach(x, y, 3));
            }
        }

        function makeRoach(x, y, size) {
            const speed = (4 - size) * 24 + 24 + wave * 3;
            const angle = Math.random() * TWO_PI;
            return {
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size,
                radius: size === 3 ? 45 : size === 2 ? 28 : 17,
                rot: Math.random() * TWO_PI,
                spin: (Math.random() - 0.5) * 2.2,
                wobble: Math.random() * TWO_PI
            };
        }

        function update(dt, now) {
            menuPulse += dt;
            if (mode !== 'playing') return;

            fireCooldown = Math.max(0, fireCooldown - dt);
            updateShip(dt, now);
            updateBullets(dt);
            updateRoaches(dt);
            updateParticles(dt);
            checkCollisions();

            if (!roaches.length) {
                wave += 1;
                spawnWave();
                playSound('wave');
            }
        }

        function updateShip(dt, now) {
            if (!ship) return;

            if (keys.has('ArrowLeft') || keys.has('KeyA')) ship.angle -= 4.6 * dt;
            if (keys.has('ArrowRight') || keys.has('KeyD')) ship.angle += 4.6 * dt;

            if (mouse.active) {
                ship.angle = Math.atan2(mouse.y - ship.y, mouse.x - ship.x);
            }

            const thrusting = keys.has('ArrowUp') || keys.has('KeyW') || mouse.down;
            if (thrusting) {
                ship.vx += Math.cos(ship.angle) * 250 * dt;
                ship.vy += Math.sin(ship.angle) * 250 * dt;
                spawnThrustParticle();
                if (now - lastThrustSound > 140) {
                    lastThrustSound = now;
                    playSound('thrust');
                }
            }

            if (keys.has('Space')) fireBullet();

            ship.x += ship.vx * dt;
            ship.y += ship.vy * dt;
            ship.vx *= 0.992;
            ship.vy *= 0.992;
            ship.invuln = Math.max(0, ship.invuln - dt);
            wrap(ship);
        }

        function updateBullets(dt) {
            bullets = bullets.filter((bullet) => {
                bullet.x += bullet.vx * dt;
                bullet.y += bullet.vy * dt;
                bullet.life -= dt;
                wrap(bullet);
                return bullet.life > 0;
            });
        }

        function updateRoaches(dt) {
            roaches.forEach((roach) => {
                roach.x += roach.vx * dt;
                roach.y += roach.vy * dt;
                roach.rot += roach.spin * dt;
                roach.wobble += dt * 7;
                wrap(roach);
            });
        }

        function updateParticles(dt) {
            particles = particles.filter((particle) => {
                particle.x += particle.vx * dt;
                particle.y += particle.vy * dt;
                particle.life -= dt;
                particle.size *= 0.985;
                return particle.life > 0;
            });
        }

        function fireBullet() {
            if (!ship || fireCooldown > 0 || bullets.length > 5) return;
            fireCooldown = 0.18;
            bullets.push({
                x: ship.x + Math.cos(ship.angle) * 22,
                y: ship.y + Math.sin(ship.angle) * 22,
                vx: ship.vx + Math.cos(ship.angle) * 470,
                vy: ship.vy + Math.sin(ship.angle) * 470,
                life: 0.9
            });
            playSound('fire');
        }

        function spawnThrustParticle() {
            particles.push({
                x: ship.x - Math.cos(ship.angle) * 17,
                y: ship.y - Math.sin(ship.angle) * 17,
                vx: ship.vx * 0.2 - Math.cos(ship.angle) * (40 + Math.random() * 60),
                vy: ship.vy * 0.2 - Math.sin(ship.angle) * (40 + Math.random() * 60),
                life: 0.28,
                size: 3 + Math.random() * 4,
                color: '#ffb347'
            });
        }

        function checkCollisions() {
            for (let i = roaches.length - 1; i >= 0; i--) {
                const roach = roaches[i];
                for (let j = bullets.length - 1; j >= 0; j--) {
                    const bullet = bullets[j];
                    if (distance(roach, bullet) > roach.radius) continue;
                    bullets.splice(j, 1);
                    destroyRoach(i);
                    break;
                }
            }

            if (!ship || ship.invuln > 0) return;
            for (const roach of roaches) {
                if (distance(ship, roach) > ship.radius + roach.radius * 0.72) continue;
                lives -= 1;
                explode(ship.x, ship.y, '#e8ff79', 28);
                playSound('death');
                if (lives <= 0) {
                    mode = 'gameover';
                    updateGuide();
                    return;
                }
                resetShip();
                respawnTimer = 1;
                return;
            }
        }

        function destroyRoach(index) {
            const roach = roaches[index];
            roaches.splice(index, 1);
            score += roach.size === 3 ? 50 : roach.size === 2 ? 100 : 200;
            explode(roach.x, roach.y, '#8cff57', 18 + roach.size * 5);
            playSound('explode');

            if (roach.size <= 1) return;
            roaches.push(makeRoach(roach.x, roach.y, roach.size - 1));
            roaches.push(makeRoach(roach.x, roach.y, roach.size - 1));
        }

        function explode(x, y, color, count) {
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * TWO_PI;
                const speed = 45 + Math.random() * 180;
                particles.push({
                    x,
                    y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 0.35 + Math.random() * 0.5,
                    size: 2 + Math.random() * 5,
                    color
                });
            }
        }

        function draw() {
            drawBackground();
            if (mode === 'menu') drawMenu();
            if (mode === 'playing') drawGame();
            if (mode === 'gameover') {
                drawGame();
                drawGameOver();
            }
            drawScanlines();
            renderWarpedScreen();
        }

        function renderWarpedScreen() {
            screenCtx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            screenCtx.imageSmoothingEnabled = false;

            const stripHeight = 6;
            const columns = 22;
            const columnWidth = GAME_WIDTH / columns;

            for (let y = 0; y < GAME_HEIGHT; y += stripHeight) {
                const ny = (y / GAME_HEIGHT - 0.5) * 2;
                const edgePull = Math.pow(Math.abs(ny), 1.75) * 28 + 3;
                const verticalBend = -ny * ny * 4;
                const topInfluence = Math.max(0, 1 - y / (GAME_HEIGHT * 0.28));

                for (let col = 0; col < columns; col++) {
                    const sx = col * columnWidth;
                    const nextSx = Math.min(GAME_WIDTH, sx + columnWidth);
                    const centerX = (sx + nextSx) / 2;
                    const nxCol = (centerX / GAME_WIDTH - 0.5) * 2;
                    const centerLift = -Math.pow(Math.max(0, 1 - Math.abs(nxCol)), 1.8) * topInfluence * 8;
                    const dx = edgePull + (sx / GAME_WIDTH) * (GAME_WIDTH - edgePull * 2);
                    const nextDx = edgePull + (nextSx / GAME_WIDTH) * (GAME_WIDTH - edgePull * 2);

                    screenCtx.drawImage(
                        bufferCanvas,
                        sx,
                        y,
                        nextSx - sx,
                        stripHeight,
                        dx,
                        y + verticalBend + centerLift,
                        nextDx - dx + 1,
                        stripHeight + 1
                    );
                }
            }

            const glow = screenCtx.createRadialGradient(
                GAME_WIDTH / 2,
                GAME_HEIGHT / 2,
                GAME_WIDTH * 0.12,
                GAME_WIDTH / 2,
                GAME_HEIGHT / 2,
                GAME_WIDTH * 0.62
            );
            glow.addColorStop(0, 'rgba(190, 255, 115, 0.08)');
            glow.addColorStop(0.58, 'rgba(30, 90, 20, 0.02)');
            glow.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
            screenCtx.fillStyle = glow;
            screenCtx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        }

        function drawBackground() {
            ctx.fillStyle = '#020500';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            ctx.strokeStyle = 'rgba(94, 255, 71, 0.09)';
            ctx.lineWidth = 1;
            for (let x = 0; x < GAME_WIDTH; x += 38) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, GAME_HEIGHT);
                ctx.stroke();
            }
            for (let y = 0; y < GAME_HEIGHT; y += 38) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(GAME_WIDTH, y);
                ctx.stroke();
            }
        }

        function drawMenu() {
            const pulse = 0.55 + Math.sin(menuPulse * 5) * 0.22;
            drawText('ASTEROACH', GAME_WIDTH / 2, 138, 58, '#caff63', 'center');
            drawText('ROBCO VECTOR RAID', GAME_WIDTH / 2, 190, 20, '#73ff63', 'center');

            ctx.strokeStyle = `rgba(202, 255, 99, ${pulse})`;
            ctx.lineWidth = 4;
            ctx.strokeRect(202, 256, 366, 76);
            drawText('START GAME', GAME_WIDTH / 2, 305, 34, '#f5ffd0', 'center');
            drawText('MORE GAMES: VAULT SEALED', GAME_WIDTH / 2, 390, 19, '#73ff63', 'center');
            drawText('DESTROY MUTANT ROACH ROCKS', GAME_WIDTH / 2, 462, 21, '#caff63', 'center');
            drawRoach(GAME_WIDTH / 2, 528, 2, Math.sin(menuPulse) * 0.3, 1.1);
        }

        function drawGame() {
            drawHud();
            particles.forEach(drawParticle);
            bullets.forEach(drawBullet);
            roaches.forEach((roach) => drawRoach(roach.x, roach.y, roach.size, roach.rot, 1));
            if (ship) drawShip();
        }

        function drawHud() {
            drawText(`SCORE ${score}`, 22, 34, 21, '#caff63', 'left');
            drawText(`WAVE ${wave}`, GAME_WIDTH / 2, 34, 21, '#caff63', 'center');
            drawText(`LIVES ${Math.max(0, lives)}`, GAME_WIDTH - 22, 34, 21, '#caff63', 'right');
        }

        function drawShip() {
            if (ship.invuln > 0 && Math.floor(ship.invuln * 10) % 2 === 0) return;
            ctx.save();
            ctx.translate(ship.x, ship.y);
            ctx.rotate(ship.angle);
            ctx.strokeStyle = '#f5ffd0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(24, 0);
            ctx.lineTo(-15, -14);
            ctx.lineTo(-8, 0);
            ctx.lineTo(-15, 14);
            ctx.closePath();
            ctx.stroke();
            ctx.strokeStyle = '#73ff63';
            ctx.beginPath();
            ctx.moveTo(-8, -8);
            ctx.lineTo(4, 0);
            ctx.lineTo(-8, 8);
            ctx.stroke();
            ctx.restore();
        }

        function drawRoach(x, y, size, rot, scale) {
            const radius = (size === 3 ? 45 : size === 2 ? 28 : 17) * scale;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(rot);
            ctx.strokeStyle = '#8cff57';
            ctx.lineWidth = Math.max(2, size);

            ctx.beginPath();
            ctx.ellipse(0, 0, radius * 0.62, radius * 0.9, 0, 0, TWO_PI);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(0, -radius * 0.54, radius * 0.45, radius * 0.35, 0, 0, TWO_PI);
            ctx.stroke();

            for (let i = -1; i <= 1; i++) {
                const yLeg = i * radius * 0.32;
                drawLeg(-radius * 0.45, yLeg, -1, radius);
                drawLeg(radius * 0.45, yLeg, 1, radius);
            }

            ctx.strokeStyle = '#f5ffd0';
            ctx.beginPath();
            ctx.moveTo(-radius * 0.16, -radius * 0.72);
            ctx.lineTo(-radius * 0.5, -radius * 1.08);
            ctx.moveTo(radius * 0.16, -radius * 0.72);
            ctx.lineTo(radius * 0.5, -radius * 1.08);
            ctx.stroke();
            ctx.restore();
        }

        function drawLeg(x, y, side, radius) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + side * radius * 0.42, y + radius * 0.15);
            ctx.lineTo(x + side * radius * 0.68, y + radius * 0.34);
            ctx.stroke();
        }

        function drawBullet(bullet) {
            ctx.fillStyle = '#f5ffd0';
            ctx.shadowColor = '#caff63';
            ctx.shadowBlur = 10;
            ctx.fillRect(bullet.x - 2, bullet.y - 2, 4, 4);
            ctx.shadowBlur = 0;
        }

        function drawParticle(particle) {
            ctx.fillStyle = particle.color;
            ctx.globalAlpha = Math.max(0, particle.life * 2);
            ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
            ctx.globalAlpha = 1;
        }

        function drawGameOver() {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.68)';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            drawText('CABINET BREACH', GAME_WIDTH / 2, 246, 45, '#ff765f', 'center');
            drawText(`FINAL SCORE ${score}`, GAME_WIDTH / 2, 306, 24, '#f5ffd0', 'center');
            drawText('ENTER/R TO REBOOT  ESC MENU', GAME_WIDTH / 2, 370, 20, '#caff63', 'center');
        }

        function drawScanlines() {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
            for (let y = 0; y < GAME_HEIGHT; y += 4) ctx.fillRect(0, y, GAME_WIDTH, 1);
            ctx.strokeStyle = 'rgba(202, 255, 99, 0.28)';
            ctx.lineWidth = 8;
            ctx.strokeRect(4, 4, GAME_WIDTH - 8, GAME_HEIGHT - 8);
        }

        function drawText(text, x, y, size, color, align) {
            ctx.fillStyle = color;
            ctx.font = `700 ${size}px 'Courier New', monospace`;
            ctx.textAlign = align;
            ctx.textBaseline = 'middle';
            ctx.shadowColor = color;
            ctx.shadowBlur = 10;
            ctx.fillText(text, x, y);
            ctx.shadowBlur = 0;
        }

        function wrap(body) {
            const margin = body.radius || 8;
            if (body.x < -margin) body.x = GAME_WIDTH + margin;
            if (body.x > GAME_WIDTH + margin) body.x = -margin;
            if (body.y < -margin) body.y = GAME_HEIGHT + margin;
            if (body.y > GAME_HEIGHT + margin) body.y = -margin;
        }

        function distance(a, b) {
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function startLoop() {
            if (rafId) return;
            lastTime = performance.now();
            rafId = requestAnimationFrame(tick);
        }

        function stopLoop() {
            if (!rafId) return;
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        function tick(now) {
            if (!active) {
                rafId = null;
                return;
            }
            const dt = Math.min(0.033, (now - lastTime) / 1000);
            lastTime = now;
            update(dt, now);
            draw();
            rafId = requestAnimationFrame(tick);
        }

        function updateGuide() {
            if (mode === 'playing') {
                guide.innerHTML = [
                    '<p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / <kbd>ARROWS</kbd> MOVE</p>',
                    '<p><kbd>SPACE</kbd> FIRE</p>',
                    '<p><kbd>MOUSE</kbd> AIM  <kbd>CLICK</kbd> FIRE</p>',
                    '<p><kbd>ESC</kbd> CABINET MENU</p>',
                    '<p>GO BACK EXITS CABINET</p>'
                ].join('');
                return;
            }

            if (mode === 'gameover') {
                guide.innerHTML = [
                    '<p><kbd>ENTER</kbd> / <kbd>R</kbd> REBOOT</p>',
                    '<p><kbd>ESC</kbd> CABINET MENU</p>',
                    '<p>GO BACK EXITS CABINET</p>'
                ].join('');
                return;
            }

            guide.innerHTML = [
                '<p><kbd>ENTER</kbd> START ASTEROACH</p>',
                '<p><kbd>CLICK</kbd> SELECT</p>',
                '<p>DESTROY MUTANT ROACH ROCKS</p>',
                '<p>GO BACK EXITS CABINET</p>'
            ].join('');
        }

        function playSound(name) {
            const audio = ensureAudio();
            if (!audio) return;
            if (name === 'fire') chirp(660, 0.055, 'square', 280);
            if (name === 'explode') {
                chirp(120, 0.08, 'sawtooth', -55);
                setTimeout(() => chirp(85, 0.09, 'square', -25), 32);
            }
            if (name === 'death') {
                chirp(280, 0.1, 'square', -120);
                setTimeout(() => chirp(110, 0.14, 'sawtooth', -60), 95);
            }
            if (name === 'select') chirp(440, 0.06, 'square', 220);
            if (name === 'wave') {
                chirp(330, 0.06, 'square', 0);
                setTimeout(() => chirp(495, 0.07, 'square', 0), 70);
            }
            if (name === 'thrust') chirp(75, 0.045, 'sawtooth', 18);
        }

        function ensureAudio() {
            if (isMuted || masterVolume <= 0) return null;
            if (!audioContext) {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextClass) return null;
                audioContext = new AudioContextClass();
                outputGain = audioContext.createGain();
                outputGain.gain.value = masterVolume * 0.28;
                outputGain.connect(audioContext.destination);
            }
            if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
            return audioContext;
        }

        function chirp(freq, duration, type, sweep) {
            const now = audioContext.currentTime;
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.linearRampToValueAtTime(Math.max(20, freq + sweep), now + duration);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.8, now + 0.006);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
            osc.connect(gain);
            gain.connect(outputGain);
            osc.start(now);
            osc.stop(now + duration + 0.02);
        }

        function handleKeyDown(event) {
            if (!active) return;
            if (!isArcadeKey(event.code)) return;
            event.preventDefault();

            if (mode === 'menu') {
                if (event.code === 'Enter' || event.code === 'Space') startGame();
                return;
            }

            if (mode === 'gameover') {
                if (event.code === 'Escape') {
                    showMenu();
                    playSound('select');
                    return;
                }
                if (event.code === 'Enter' || event.code === 'KeyR' || event.code === 'Space') startGame();
                return;
            }

            if (event.code === 'Escape') {
                showMenu();
                playSound('select');
                return;
            }
            keys.add(event.code);
        }

        function handleKeyUp(event) {
            if (!active) return;
            keys.delete(event.code);
        }

        function handleMouseMove(event) {
            if (!active) return;
            const point = canvasPoint(event);
            mouse.x = point.x;
            mouse.y = point.y;
            mouse.active = mode === 'playing';
        }

        function handleMouseDown(event) {
            if (!active) return;
            event.preventDefault();
            canvas.focus({ preventScroll: true });
            mouse.down = true;
            if (mode === 'menu') {
                startGame();
                return;
            }
            if (mode === 'gameover') {
                startGame();
                return;
            }
            fireBullet();
        }

        function handleMouseUp() {
            mouse.down = false;
        }

        function canvasPoint(event) {
            const rect = canvas.getBoundingClientRect();
            return {
                x: (event.clientX - rect.left) / rect.width * GAME_WIDTH,
                y: (event.clientY - rect.top) / rect.height * GAME_HEIGHT
            };
        }

        function isArcadeKey(code) {
            return [
                'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
                'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'Enter', 'Escape', 'KeyR'
            ].includes(code);
        }

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());

        hide();

        return {
            showMenu,
            hide,
            setAudioState
        };
    }

    window.createCabinetArcade = createCabinetArcade;
}());
