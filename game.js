// --- CONFIGURATION & KEYBINDS ---
const theme = {
    playerNormal: '#FF5722',
    playerClinging: '#00BCD4',
    playerGliding: '#FFEB3B',
    backgroundTop: '#1895f6ff',
    backgroundBottom: '#1977d5ff',
    uiPanel: 'rgba(0,0,0,0.5)',
    uiText: 'white',
    dashBarReady: '#00ff00',
    updraftBarReady: '#00ff00',
    teleportBarReady: '#00ff00',
    dashVfx: '#ff9800',
    updraftVfx: '#64ffda',
    teleportVfx: '#9C27B0',
    cooldownBar: '#ff0000'
};

const sounds = {
    dash: new Audio('sounds/dash.mp3'),
    updraft: new Audio('sounds/updraft.mp3'),
    death: new Audio('sounds/death.mp3'),
};

const settings = {
    dashCooldown: 200,
    updraftCooldown: 200,
    teleportCooldown: 300
};

const keybinds = {
    left: 'a',
    right: 'd',
    jump: 'w',
    dash: 'Shift',
    updraft: 'q',
    teleport: 'e',
    pause: 'Escape'
};

// --- INITIALIZATION ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const pauseMenu = document.getElementById('pause-menu');
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const GRAVITY = 0.3, GRAVITY_GLIDE = 0.05, TERMINAL_VELOCITY = 8, MAX_JUMP_SPEED = -8.5, PLAYER_SPEED = 3.5, DEATH_Y = 600;
let fuel = 100, isGliding = false, dashTimer = 0, deathTimer = 0, score = 0, inputLockTimer = 0;
let lastSafePosition = { x: 50, y: 200 };
let xVelocityLocked = false;
let teleportAnimation = null;
let teleportTrail = [];
let suppressedInputs = new Set();
let particles = [];
function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 20, color });
    }
}

function updateParticles() {
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
    });
    particles = particles.filter(p => p.life > 0);
}

function updateTeleportTrail() {
    teleportTrail.forEach(trail => {
        trail.life--;
    });
    teleportTrail = teleportTrail.filter(trail => trail.life > 0);
}

function beginTeleportRecall() {
    teleportAnimation = {
        fromX: player.x,
        fromY: player.y,
        toX: lastSafePosition.x,
        toY: lastSafePosition.y,
        frame: 0,
        duration: 24
    };
    player.vx = 0;
    player.vy = 0;
    dashTimer = 0;
    cooldowns.teleport = settings.teleportCooldown;
    inputLockTimer = 60;
    xVelocityLocked = suppressHeldActionInputs();
    spawnParticles(player.x + 10, player.y + 10, theme.teleportVfx, 20);
}

function updateTeleportRecall() {
    teleportAnimation.frame++;
    const t = Math.min(teleportAnimation.frame / teleportAnimation.duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);

    teleportTrail.push({ x: player.x, y: player.y, life: 18 });
    player.x = teleportAnimation.fromX + (teleportAnimation.toX - teleportAnimation.fromX) * eased;
    player.y = teleportAnimation.fromY + (teleportAnimation.toY - teleportAnimation.fromY) * eased;
    player.vx = 0;
    player.vy = 0;

    if (teleportAnimation.frame % 3 === 0) {
        spawnParticles(player.x + 10, player.y + 10, theme.teleportVfx, 6);
    }

    if (t === 1) {
        player.x = teleportAnimation.toX;
        player.y = teleportAnimation.toY;
        player.grounded = true;
        teleportAnimation = null;
        teleportTrail = [];
        spawnParticles(player.x + 10, player.y + 10, theme.teleportVfx, 24);
    }
}

function drawPlayer() {
    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    const bodyColor = player.isClinging ? theme.playerClinging : (isGliding ? theme.playerGliding : theme.playerNormal);

    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, player.height / 2 + 3, player.width * 0.55, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = '#2b1b16';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-player.width / 2, -player.height / 2, player.width, player.height, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#263238';
    ctx.beginPath();
    ctx.roundRect(-6, -6, 12, 7, 3);
    ctx.fill();

    ctx.fillStyle = '#E0F7FA';
    ctx.fillRect(player.dashDir > 0 ? 1 : -4, -4, 3, 3);

    ctx.fillStyle = '#3E2723';
    ctx.fillRect(-7, 8, 5, 4);
    ctx.fillRect(2, 8, 5, 4);

    if (isGliding) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10, -2);
        ctx.lineTo(-16, 4);
        ctx.moveTo(10, -2);
        ctx.lineTo(16, 4);
        ctx.stroke();
    }

    ctx.restore();
}

let cooldowns = { dash: 0, updraft: 0, teleport: 0 };

let state = {
    screen: 'title',
    paused: false, cameraX: 0, cameraY: 0, platforms: [], hazards: [],
    keys: { left: false, right: false, up: false, shift: false, q: false, teleport: false }
};

function clearActionInputs() {
    state.keys.left = false;
    state.keys.right = false;
    state.keys.up = false;
    state.keys.shift = false;
    state.keys.q = false;
    state.keys.teleport = false;
}

function suppressHeldActionInputs() {
    const wasMoving = state.keys.left || state.keys.right;
    if (state.keys.left) suppressedInputs.add(keybinds.left);
    if (state.keys.right) suppressedInputs.add(keybinds.right);
    if (state.keys.up) [keybinds.jump, ' ', 'Jump'].forEach(key => suppressedInputs.add(key));
    if (state.keys.shift) [keybinds.dash, 'Dash'].forEach(key => suppressedInputs.add(key));
    if (state.keys.q) [keybinds.updraft, 'Up'].forEach(key => suppressedInputs.add(key));
    if (state.keys.teleport) [keybinds.teleport, 'Teleport'].forEach(key => suppressedInputs.add(key));
    clearActionInputs();
    return wasMoving;
}

function startGame() {
    if (state.screen === 'title') {
        state.screen = 'game';
        particles = [];
        initGame();
    }
}

const player = { x: 50, y: 200, width: 20, height: 20, vx: 0, vy: 0, grounded: false, isClinging: false, dashDir: 1 };

function isMobile() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
function getHighScore() { try { return localStorage.getItem('highscore') || 0; } catch (e) { return 0; } }
function setHighScore(val) { try { localStorage.setItem('highscore', val); } catch (e) { } }

//function playTone(freq, type, duration) {
//     if (audioCtx.state === 'suspended') audioCtx.resume();
//     const osc = audioCtx.createOscillator();
//     const gain = audioCtx.createGain();
//     osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
//     gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
//     gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
//     osc.connect(gain); gain.connect(audioCtx.destination);
//     osc.start(); osc.stop(audioCtx.currentTime + duration);
// }

function playSound(type) {
    if (sounds[type]) {
        sounds[type].currentTime = 0;
        sounds[type].play().catch(e => console.log("Audio play prevented:", e));
    }
}

function handleInput(event, isDown) {
    const key = event.key || event;
    if (xVelocityLocked && (key === keybinds.left || key === keybinds.right)) {
        if (!isDown) {
            suppressedInputs.delete(key);
            xVelocityLocked = suppressedInputs.has(keybinds.left) || suppressedInputs.has(keybinds.right);
        }
        return;
    }
    if (suppressedInputs.has(key)) {
        if (!isDown) suppressedInputs.delete(key);
        return;
    }
    if (inputLockTimer > 0 && isDown && key !== keybinds.pause) {
        suppressedInputs.add(key);
        return;
    }
    if (key === keybinds.left) state.keys.left = isDown;
    if (key === keybinds.right) state.keys.right = isDown;
    if (key === keybinds.jump || key === ' ' || key === 'Jump') state.keys.up = isDown;
    if (key === keybinds.dash || key === 'Dash') state.keys.shift = isDown;
    if (key === keybinds.updraft || key === 'Up') state.keys.q = isDown;
    if (key === keybinds.teleport || key === 'Teleport') state.keys.teleport = isDown;
    if (key === keybinds.pause && isDown) togglePause();
}

window.addEventListener('keydown', (e) => {
    if (state.screen === 'title') {
        if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
        }
        startGame();
    } else {
        handleInput(e, true);
    }
});
window.addEventListener('keyup', (e) => handleInput(e, false));

canvas.addEventListener('click', startGame);
canvas.addEventListener('touchstart', (e) => {
    if (state.screen === 'title') {
        e.preventDefault();
        startGame();
    }
});

function setupMobileControls() {
    const controlsDiv = document.getElementById('controls');
    if (!isMobile()) { if (controlsDiv) controlsDiv.style.display = 'none'; return; }

    const map = [
        { id: 'btn-left', key: 'a' }, { id: 'btn-right', key: 'd' },
        { id: 'btn-jump', key: 'Jump' }, { id: 'btn-dash', key: 'Dash' },
        { id: 'btn-updraft', key: 'Up' }, { id: 'btn-teleport', key: 'Teleport' },
        { id: 'btn-pause', key: 'Pause' }
    ];
    map.forEach(btn => {
        const el = document.getElementById(btn.id);
        if (el) {
            el.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (btn.key === 'Pause') togglePause(); else handleInput(btn.key, true);
            });
            el.addEventListener('touchend', (e) => { e.preventDefault(); if (btn.key !== 'Pause') handleInput(btn.key, false); });
        }
    });
}

function resizeCanvas() {
    const container = document.getElementById('game-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    canvas.width = width;
    canvas.height = height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function togglePause() { state.paused = !state.paused; if (pauseMenu) pauseMenu.style.display = state.paused ? 'flex' : 'none'; }

function initGame() {
    state.platforms = [{ x: 0, y: 300, w: 200, h: 40 }];
    state.hazards = [{ x: -5000, y: DEATH_Y, w: 20000, h: 100, type: 'carpet' }];
    score = 0; player.x = 50; player.y = 200; player.vx = 0; player.vy = 0;
    lastSafePosition = { x: player.x, y: player.y };
    teleportAnimation = null;
    teleportTrail = [];
    cooldowns.dash = 0; cooldowns.updraft = 0; cooldowns.teleport = 0; inputLockTimer = 0; xVelocityLocked = false; fuel = 100;
    suppressedInputs.clear();
    clearActionInputs();
}

function generateEndless() {
    let difficulty = Math.min(score / 500, 2.5);
    let pathPlatforms = state.platforms.filter(p => !p.obstacle);
    let last = pathPlatforms[pathPlatforms.length - 1];

    if (last.x < player.x + 2000) {
        let nextX = last.x + last.w + 50 + (Math.random() * 80 * difficulty);
        let drift = (Math.random() - 0.5) * 300;
        let nextY = Math.max(200, Math.min(500, last.y + drift));
        let w = Math.max(50, 100 - (difficulty * 20));
        let variants = ['safe', 'safe', 'leftSpike'];

        if (score >= 100) variants.push('rightSpike');
        if (score >= 200) variants.push('doubleSpike');
        if (score >= 300) variants.push('ceilingWithFloor', 'ceilingStandalone');

        let variant = variants[Math.floor(Math.random() * variants.length)];
        if (Math.random() > 0.45 + (difficulty / 6)) variant = 'safe';

        if (variant === 'ceilingWithFloor') {
            w = Math.max(95, w);
            nextY = Math.max(320, Math.min(500, nextY + 40));
            let ceilingY = Math.max(130, nextY - 150);
            let ceilingW = Math.max(110, w + 25);
            state.platforms.push({ x: nextX - 10, y: ceilingY, w: ceilingW, h: 30, variant: 'ceilingHazard', obstacle: true });
            addBottomSpikes(nextX - 10, ceilingY, ceilingW, 30);
        }

        if (variant === 'ceilingStandalone') {
            w = Math.max(85, w);
            let ceilingY = Math.max(140, last.y - 170);
            let ceilingW = Math.max(105, w + 40);
            state.platforms.push({ x: nextX + 10, y: ceilingY, w: ceilingW, h: 30, variant: 'ceilingHazard', obstacle: true });
            addBottomSpikes(nextX + 10, ceilingY, ceilingW, 30);
            nextX = nextX + ceilingW + 55;
            nextY = Math.max(220, last.y - 45);
            variant = 'safe';
        }

        state.platforms.push({ x: nextX, y: nextY, w: w, h: 40, variant: variant });

        if (variant === 'leftSpike' || variant === 'doubleSpike') {
            state.hazards.push({ x: nextX + 18, y: nextY - 15, w: 20, h: 15, type: 'spike' });
        }
        if (variant === 'rightSpike' || variant === 'doubleSpike') {
            state.hazards.push({ x: nextX + w - 38, y: nextY - 15, w: 20, h: 15, type: 'spike' });
        }
    }

    state.platforms = state.platforms.filter(p => p.x > player.x - 1000);
    state.hazards = state.hazards.filter(h => h.x > player.x - 1000 || h.type === 'carpet');
}

function addBottomSpikes(x, y, w, h) {
    let spikeCount = Math.max(2, Math.floor(w / 35));
    for (let i = 0; i < spikeCount; i++) {
        let spikeX = x + 16 + i * ((w - 32) / spikeCount);
        state.hazards.push({ x: spikeX, y: y + h, w: 18, h: 16, type: 'bottomSpike' });
    }
}

function update() {
    if (state.screen === 'title') {
        if (particles.length < 30 && Math.random() < 0.1) {
            particles.push({
                x: Math.random() * canvas.width,
                y: canvas.height + 10,
                vx: (Math.random() - 0.5) * 1.5,
                vy: -Math.random() * 1.5 - 0.5,
                life: 300 + Math.random() * 200,
                color: 'rgba(255, 255, 255, ' + (0.1 + Math.random() * 0.4) + ')'
            });
        }
        updateParticles();
        return;
    }
    if (state.paused) return;
    if (deathTimer > 0) { deathTimer--; if (deathTimer === 0) { if (score > getHighScore()) setHighScore(score); initGame(); } return; }
    if (inputLockTimer > 0) inputLockTimer--;
    if (cooldowns.dash > 0) cooldowns.dash--;
    if (cooldowns.updraft > 0) cooldowns.updraft--;
    if (cooldowns.teleport > 0) cooldowns.teleport--;
    score = Math.max(score, Math.floor(player.x / 10));
    generateEndless();

    if (teleportAnimation) {
        updateTeleportRecall();
        updateParticles();
        updateTeleportTrail();
        state.cameraX += (player.x - canvas.width / 3 - state.cameraX) * 0.1;
        state.cameraY += (player.y - canvas.height / 2 - state.cameraY) * 0.1;
        return;
    }

    if (inputLockTimer === 0 && state.keys.shift && cooldowns.dash === 0) { playSound('dash'); spawnParticles(player.x + 10, player.y + 10, theme.dashVfx, 15); dashTimer = 10; cooldowns.dash = settings.dashCooldown; }
    if (inputLockTimer === 0 && dashTimer > 0) { player.vx = player.dashDir * 18; player.vy = 0; dashTimer--; }
    else if (inputLockTimer === 0) { player.vx = (state.keys.right ? PLAYER_SPEED : 0) - (state.keys.left ? PLAYER_SPEED : 0); if (player.vx !== 0) player.dashDir = player.vx > 0 ? 1 : -1; }
    else { player.vx = 0; dashTimer = 0; }
    if (xVelocityLocked) player.vx = 0;
    if (inputLockTimer === 0 && state.keys.q && cooldowns.updraft === 0) { spawnParticles(player.x + 10, player.y + 10, theme.updraftVfx, 15); player.vy = -12; playSound('updraft'); cooldowns.updraft = settings.updraftCooldown; }
    if (inputLockTimer === 0 && state.keys.teleport && cooldowns.teleport === 0) {
        beginTeleportRecall();
        updateParticles();
        updateTeleportTrail();
        return;
    }

    player.x += player.vx;
    isGliding = false;
    if (inputLockTimer === 0 && player.isClinging && state.keys.up && fuel > 0) { player.vy = 0; fuel = Math.max(0, fuel - 0.5); }
    else if (inputLockTimer === 0 && state.keys.up && player.vy >= 0 && !player.grounded && fuel > 0) { player.vy += GRAVITY_GLIDE; fuel = Math.max(0, fuel - 1.2); isGliding = true; }
    else { player.vy += GRAVITY; if (fuel < 100) fuel += 2.5; }

    player.vy = Math.min(player.vy, TERMINAL_VELOCITY);
    if (inputLockTimer === 0 && state.keys.up && player.grounded) { player.vy = MAX_JUMP_SPEED; player.grounded = false; }
    player.y += player.vy; player.grounded = false;

    for (let p of state.platforms) {
        if (player.x < p.x + p.w && player.x + player.width > p.x && player.y < p.y + p.h && player.y + player.height > p.y) {
            if (player.vy > 0) { player.y = p.y - player.height; player.vy = 0; player.grounded = true; lastSafePosition = { x: player.x, y: player.y }; }
        }
    }
    player.isClinging = (inputLockTimer === 0 && state.keys.up && fuel > 0 && state.platforms.some(p => player.x < p.x + p.w + 5 && player.x + player.width > p.x - 5 && player.y < p.y + p.h + 5 && player.y + player.height > p.y - 5) && !player.grounded);

    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    });

    for (let h of state.hazards) {
        if (player.x < h.x + h.w && player.x + player.width > h.x && player.y < h.y + h.h && player.y + player.height > h.y) { playSound('death'); deathTimer = 60; }
    }
    state.cameraX += (player.x - canvas.width / 3 - state.cameraX) * 0.1;
    state.cameraY += (player.y - canvas.height / 2 - state.cameraY) * 0.1;
}

function draw() {
    let grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, theme.backgroundTop);
    grad.addColorStop(1, theme.backgroundBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (state.screen === 'title') {
        // Draw title screen floating particles
        particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, 3, 3);
        });

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Title text shadows/glow effect
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 4;
        ctx.shadowOffsetY = 4;

        // Draw title
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 44px "Segoe UI", Arial, sans-serif';
        ctx.fillText('RANDOM JUMPING GAME', canvas.width / 2, canvas.height / 2 - 100);

        // Reset shadow for subtitle/instruction
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Pulsing "Press to play" text using sine of current time
        let pulse = 0.5 + 0.5 * Math.sin(Date.now() / 250);
        ctx.fillStyle = 'rgba(255, 235, 59, ' + pulse + ')'; // Glowing yellow
        ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
        ctx.fillText('PRESS ANY KEY OR CLICK TO PLAY', canvas.width / 2, canvas.height / 2 - 20);

        // Control Panel box background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.roundRect = ctx.roundRect || function (x, y, w, h, r) {
            if (typeof r === 'number') r = {tl: r, tr: r, br: r, bl: r};
            this.beginPath();
            this.moveTo(x + r.tl, y);
            this.lineTo(x + w - r.tr, y);
            this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
            this.lineTo(x + w, y + h - r.br);
            this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
            this.lineTo(x + r.bl, y + h);
            this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
            this.lineTo(x, y + r.tl);
            this.quadraticCurveTo(x, y, x + r.tl, y);
            this.closePath();
            this.fill();
        };
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.roundRect(canvas.width / 2 - 250, canvas.height / 2 + 30, 500, 160, 12);

        // Control instructions
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 16px "Segoe UI", Arial, sans-serif';
        ctx.fillText('CONTROLS', canvas.width / 2, canvas.height / 2 + 55);

        ctx.font = '14px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#E0E0E0';
        ctx.fillText('A / D  or  L/R Buttons  —  Move Left / Right', canvas.width / 2, canvas.height / 2 + 85);
        ctx.fillText('W / Space  or  J Button  —  Jump / Glide / Wall Cling', canvas.width / 2, canvas.height / 2 + 110);
        ctx.fillText('Shift  or  D Button  —  Dash', canvas.width / 2, canvas.height / 2 + 135);
        ctx.fillText('Q / U Button  —  Updraft  |  E / T Button  —  Teleport  |  Esc / P  —  Pause', canvas.width / 2, canvas.height / 2 + 160);

        // Reset textAlign and textBaseline so HUD/game draw normally
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        return;
    }

    ctx.save();
    ctx.translate(-state.cameraX, -state.cameraY);

    for (let p of state.platforms) {
        if (p.variant === 'ceilingHazard') {
            ctx.strokeStyle = '#D7CCC8';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(p.x + 18, p.y);
            ctx.lineTo(p.x + 18, p.y - 40);
            ctx.moveTo(p.x + p.w - 18, p.y);
            ctx.lineTo(p.x + p.w - 18, p.y - 40);
            ctx.stroke();
        }
        ctx.fillStyle = p.variant === 'ceilingHazard' ? '#5D4037' : '#795548';
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = p.variant === 'ceilingHazard' ? '#A1887F' : '#4CAF50';
        ctx.fillRect(p.x, p.y, p.w, 10);
    }

    ctx.fillStyle = '#EF5350';
    for (let h of state.hazards) {
        if (h.type === 'spike') {
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + h.h);
            ctx.lineTo(h.x + h.w / 2, h.y);
            ctx.lineTo(h.x + h.w, h.y + h.h);
            ctx.fill();
        } else if (h.type === 'bottomSpike') {
            ctx.beginPath();
            ctx.moveTo(h.x, h.y);
            ctx.lineTo(h.x + h.w / 2, h.y + h.h);
            ctx.lineTo(h.x + h.w, h.y);
            ctx.fill();
        } else if (h.type === 'carpet') {
            for (let i = Math.floor(h.x / 30) * 30; i < h.x + h.w; i += 30) {
                ctx.beginPath();
                ctx.moveTo(i, h.y + h.h);
                ctx.lineTo(i + 15, h.y);
                ctx.lineTo(i + 30, h.y + h.h);
                ctx.fill();
            }
        }
    }

    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 20;
        ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1.0;

    if (teleportAnimation) {
        teleportTrail.forEach(trail => {
            ctx.globalAlpha = trail.life / 18 * 0.55;
            ctx.fillStyle = theme.teleportVfx;
            ctx.fillRect(trail.x - 3, trail.y - 3, player.width + 6, player.height + 6);
        });
        ctx.globalAlpha = 1.0;
    }

    ctx.fillStyle = player.isClinging ? theme.playerClinging : (isGliding ? theme.playerGliding : theme.playerNormal);
    ctx.fillRect(player.x, player.y, player.width, player.height);
    ctx.restore();

    ctx.fillStyle = theme.uiPanel; ctx.fillRect(5, 5, 170, 130);
    ctx.fillStyle = theme.uiText;
    ctx.fillText('SCORE: ' + score, 15, 20);
    ctx.fillText('BEST: ' + getHighScore(), 15, 40);
    ctx.fillStyle = '#fff'; ctx.fillText('FUEL', 15, 60); ctx.fillRect(15, 65, fuel, 10);
    ctx.fillStyle = cooldowns.dash > 0 ? theme.cooldownBar : theme.dashBarReady;
    ctx.fillText('DASH', 15, 95); ctx.fillRect(15, 100, 40, 10);
    ctx.fillStyle = cooldowns.updraft > 0 ? theme.cooldownBar : theme.updraftBarReady;
    ctx.fillText('UPDRFT', 65, 95); ctx.fillRect(65, 100, 40, 10);
    ctx.fillStyle = cooldowns.teleport > 0 ? theme.cooldownBar : theme.teleportBarReady;
    ctx.fillText('TELE', 115, 95); ctx.fillRect(115, 100, 40, 10);
}

initGame(); setupMobileControls();
function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();
