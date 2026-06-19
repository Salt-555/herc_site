(function() {
    const canvas = document.getElementById('smoke-canvas');
    const ctx = canvas.getContext('2d');

    // Offscreen canvas — particles render here, then get blurred onto main
    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d');

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        offCanvas.width = canvas.width;
        offCanvas.height = canvas.height;
    }
    resize();
    window.addEventListener('resize', resize);

    // Mouse tracking with velocity
    const mouse = { x: 0, y: 0, vx: 0, vy: 0, active: false };
    let prevMouse = { x: 0, y: 0 };

    window.addEventListener('mousemove', (e) => {
        mouse.vx = (e.clientX - prevMouse.x) * 0.5;
        mouse.vy = (e.clientY - prevMouse.y) * 0.5;
        prevMouse.x = mouse.x;
        prevMouse.y = mouse.y;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
    });

    window.addEventListener('mouseleave', () => { mouse.active = false; });

    // Hash-based value noise
    function noise2D(x, y) {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = x - ix;
        const fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        function hash(a, b) {
            let h = (a * 2654435761 ^ b * 2246822519) & 0x7fffffff;
            h = ((h >> 13) ^ h) * 1274126177;
            return ((h >> 13) ^ h) / 0x7fffffff;
        }
        const n00 = hash(ix, iy);
        const n10 = hash(ix + 1, iy);
        const n01 = hash(ix, iy + 1);
        const n11 = hash(ix + 1, iy + 1);
        const nx0 = n00 + sx * (n10 - n00);
        const nx1 = n01 + sx * (n11 - n01);
        return nx0 + sy * (nx1 - nx0);
    }

    const PARTICLE_COUNT = 160;
    const MOUSE_RADIUS = 180;
    const MOUSE_STRENGTH = 0.28;

    class SmokeNode {
        constructor() {
            this.reset(true);
        }

        reset(initial) {
            // A few slow ceiling wisps keep the room hazy; most smoke rises from below.
            this.fromTop = Math.random() < 0.12;

            const r1 = Math.random(), r2 = Math.random();
            const gaussian = Math.sqrt(-2 * Math.log(r1 || 0.001)) * Math.cos(2 * Math.PI * r2);

            if (this.fromTop) {
                // Top-center spawn, tighter spread
                this.x = canvas.width * 0.5 + gaussian * canvas.width * 0.1;
                this.y = initial ? -Math.random() * 80 : -Math.random() * 40;
                this.baseSize = Math.random() * 45 + 18;
                this.size = this.baseSize;
                this.baseSpeedY = Math.random() * 0.18 + 0.04;
                this.vx = gaussian * 0.18;
                this.vy = this.baseSpeedY;
                this.brightness = Math.random() * 0.18 + 0.08;
                this.life = 0;
                this.maxLife = Math.random() * 700 + 500;
            } else {
                // Bottom-center spawn
                this.x = canvas.width * 0.5 + gaussian * canvas.width * 0.16;
                this.y = initial
                    ? canvas.height + Math.random() * canvas.height * 0.5
                    : canvas.height + Math.random() * 40;
                this.baseSize = Math.random() * 42 + 28;
                this.size = this.baseSize;
                const fast = Math.random() < 0.2;
                this.baseSpeedY = fast
                    ? -(Math.random() * 0.45 + 0.28)
                    : -(Math.random() * 0.22 + 0.08);
                this.vx = gaussian * 0.04;
                this.vy = this.baseSpeedY;
                this.brightness = Math.random() * 0.14 + 0.06;
                this.life = 0;
                this.maxLife = fast
                    ? Math.random() * 1100 + 900
                    : Math.random() * 900 + 700;
            }
            this.noiseOffsetX = Math.random() * 1000;
            this.noiseOffsetY = Math.random() * 1000;
            this.noiseSpeed = Math.random() * 0.0007 + 0.00025;
            this.wobbleAmp = Math.random() * 0.45 + 0.18;
            this.stretch = Math.random() * 1.3 + 1.2;
            this.rotation = Math.random() * Math.PI;
            this.rotationSpeed = (Math.random() - 0.5) * 0.003;
            this.tone = Math.random();
            this.drag = 0.991;
        }

        update(time) {
            this.life++;
            const lifeRatio = this.life / this.maxLife;

            // Layered turbulence creates slow curls instead of straight rising bubbles.
            const nTime = time * this.noiseSpeed;
            const nx = noise2D(this.noiseOffsetX + nTime, this.noiseOffsetY) - 0.5;
            const ny = noise2D(this.noiseOffsetX, this.noiseOffsetY + nTime) - 0.5;
            const curl = noise2D(this.noiseOffsetX + nTime * 1.7, this.noiseOffsetY + nTime * 1.3) - 0.5;
            this.vx += (nx + curl * 0.8) * this.wobbleAmp * 0.06;
            this.vy += ny * this.wobbleAmp * 0.018;
            this.rotation += this.rotationSpeed + curl * 0.002;

            // Buoyancy
            this.vy += (this.baseSpeedY - this.vy) * 0.01;

            // Mouse interaction — trailing swirl
            if (mouse.active) {
                const dx = this.x - mouse.x;
                const dy = this.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < MOUSE_RADIUS && dist > 1) {
                    const force = (1 - dist / MOUSE_RADIUS) * MOUSE_STRENGTH;
                    const f2 = force * force;
                    this.vx += (dx / dist) * f2 * 0.35;
                    this.vy += (dy / dist) * f2 * 0.15;
                    this.vx += mouse.vx * f2 * 0.1;
                    this.vy += mouse.vy * f2 * 0.04;
                    this.vx += (-dy / dist) * force * 0.18;
                    this.vy += (dx / dist) * force * 0.18;
                }
            }

            this.vx *= this.drag;
            this.vy *= this.drag;
            this.x += this.vx;
            this.y += this.vy;

            // Smoke expands and diffuses as it cools.
            this.size = this.baseSize + Math.pow(lifeRatio, 0.75) * 95;

            if (this.life > this.maxLife
                || (!this.fromTop && this.y < -this.size * 2)
                || (this.fromTop && this.y > canvas.height + this.size)) {
                this.reset(false);
            }
        }

        getAlpha() {
            const r = this.life / this.maxLife;
            const fadeIn = Math.min(1, r / 0.12);
            const fadeOut = Math.pow(Math.max(0, 1 - r), 1.6);
            return this.brightness * fadeIn * fadeOut;
        }
    }

    const particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push(new SmokeNode());
    }

    function animate(timestamp) {
        const time = timestamp || 0;

        // 1) Draw raw particles to offscreen canvas
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        offCtx.globalCompositeOperation = 'lighter';

        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.update(time);
            const a = p.getAlpha();
            if (a <= 0.002) continue;

            offCtx.save();
            offCtx.translate(p.x, p.y);
            offCtx.rotate(p.rotation);
            offCtx.scale(p.stretch, 1);
            offCtx.globalAlpha = a;

            const g = offCtx.createRadialGradient(0, 0, 0, 0, 0, p.size);
            if (p.tone < 0.55) {
                g.addColorStop(0, 'rgba(205, 202, 194, 0.95)');
                g.addColorStop(0.35, 'rgba(145, 143, 138, 0.45)');
                g.addColorStop(1, 'rgba(45, 45, 43, 0)');
            } else {
                g.addColorStop(0, 'rgba(150, 154, 158, 0.65)');
                g.addColorStop(0.45, 'rgba(100, 104, 108, 0.32)');
                g.addColorStop(1, 'rgba(35, 36, 38, 0)');
            }
            offCtx.fillStyle = g;
            offCtx.beginPath();
            offCtx.arc(0, 0, p.size, 0, Math.PI * 2);
            offCtx.fill();
            offCtx.restore();
        }

        offCtx.globalCompositeOperation = 'source-over';
        offCtx.globalAlpha = 1;

        // 2) Composite blurred layers onto main canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Heavy blur layer: broad haze that connects individual plumes.
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 0.34;
        ctx.filter = 'blur(26px) saturate(85%)';
        ctx.drawImage(offCanvas, 0, 0);

        // Medium layer: visible smoke body.
        ctx.globalAlpha = 0.32;
        ctx.filter = 'blur(10px)';
        ctx.drawImage(offCanvas, 0, 0);

        // Fine layer: thin tendrils and curls.
        ctx.globalAlpha = 0.16;
        ctx.filter = 'blur(2px) contrast(105%)';
        ctx.drawImage(offCanvas, 0, 0);

        // Reset
        ctx.filter = 'none';
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // Decay mouse velocity
        mouse.vx *= 0.92;
        mouse.vy *= 0.92;

        requestAnimationFrame(animate);
    }

    animate(0);
})();
