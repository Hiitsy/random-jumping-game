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
    cooldownBar: '#ff0000'
};

const sounds = {
    dash: new Audio('sounds/dash.mp3'),
    updraft: new Audio('sounds/updraft.mp3'),
    death: new Audio('sounds/death.mp3'),
};

const settings = {
    dashCooldown: 200,
    updraftCooldown: 200
};

const keybinds = {
    left: 'a',
    right: 'd',
    jump: 'w',
    dash: 'Shift',
    updraft: 'q',
    pause: 'Escape'
};

// --- INITIALIZATION ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const pauseMenu = document.getElementById('pause-menu');
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const GRAVITY = 0.3, GRAVITY_GLIDE = 0.05, TERMINAL_VELOCITY = 8, MAX_JUMP_SPEED = -8.5, PLAYER_SPEED = 3.5, DEATH_Y = 600;
let fuel = 100, isGliding = false, dashTimer = 0, deathTimer = 0, score = 0;
let particles = [];
function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 20, color });
    }
}
let cooldowns = { dash: 0, updraft: 0 };

let state = {
    paused: false, cameraX: 0, cameraY: 0, platforms: [], hazards: [],
    keys: { left: false, right: false, up: false, shift: false, q: false }
};

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
        // This line allows the sound to be played multiple times rapidly
        sounds[type].currentTime = 0;
        sounds[type].play().catch(e => console.log("Audio play prevented:", e));
    }
}

function handleInput(event, isDown) {
    const key = event.key || event;
    if (key === keybinds.left) state.keys.left = isDown;
    if (key === keybinds.right) state.keys.right = isDown;
    if (key === keybinds.jump || key === ' ' || key === 'Jump') state.keys.up = isDown;
    if (key === keybinds.dash || key === 'Dash') state.keys.shift = isDown;
    if (key === keybinds.updraft || key === 'Up') state.keys.q = isDown;
    if (key === keybinds.pause && isDown) togglePause();
}

window.addEventListener('keydown', (e) => handleInput(e, true));
window.addEventListener('keyup', (e) => handleInput(e, false));

function setupMobileControls() {
    const controlsDiv = document.getElementById('controls');
    if (!isMobile()) { if (controlsDiv) controlsDiv.style.display = 'none'; return; }

    const map = [
        { id: 'btn-left', key: 'a' }, { id: 'btn-right', key: 'd' },
        { id: 'btn-jump', key: 'Jump' }, { id: 'btn-dash', key: 'Dash' },
        { id: 'btn-updraft', key: 'Up' }, { id: 'btn-pause', key: 'Pause' }
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
    score = 0; player.x = 50; player.y = 200;
    cooldowns.dash = 0; cooldowns.updraft = 0; fuel = 100;
}

function generateEndless() {
    let difficulty = Math.min(score / 500, 2.5);
    let last = state.platforms[state.platforms.length - 1];

    if (last.x < player.x + 2000) {
        let nextX = last.x + last.w + 50 + (Math.random() * 80 * difficulty);
        let drift = (Math.random() - 0.5) * 300;
        let nextY = Math.max(200, Math.min(500, last.y + drift));
        let w = Math.max(50, 100 - (difficulty * 20));

        state.platforms.push({ x: nextX, y: nextY, w: w, h: 40 });

        if (Math.random() < 0.4 + (difficulty / 5)) {
            state.hazards.push({ x: nextX + 20, y: nextY - 15, w: 20, h: 15, type: 'spike' });
        }
    }

    state.platforms = state.platforms.filter(p => p.x > player.x - 1000);
    state.hazards = state.hazards.filter(h => h.x > player.x - 1000 || h.type === 'carpet');
}

function update() {
    if (state.paused) return;
    if (deathTimer > 0) { deathTimer--; if (deathTimer === 0) { if (score > getHighScore()) setHighScore(score); initGame(); } return; }
    if (cooldowns.dash > 0) cooldowns.dash--;
    if (cooldowns.updraft > 0) cooldowns.updraft--;
    score = Math.max(score, Math.floor(player.x / 10));
    generateEndless();

    if (state.keys.shift && cooldowns.dash === 0) { playSound('dash'); spawnParticles(player.x + 10, player.y + 10, theme.dashBarReady, 15); dashTimer = 10; cooldowns.dash = settings.dashCooldown; }
    if (dashTimer > 0) { player.vx = player.dashDir * 18; player.vy = 0; dashTimer--; }
    else { player.vx = (state.keys.right ? PLAYER_SPEED : 0) - (state.keys.left ? PLAYER_SPEED : 0); if (player.vx !== 0) player.dashDir = player.vx > 0 ? 1 : -1; }
    if (state.keys.q && cooldowns.updraft === 0) { spawnParticles(player.x + 10, player.y + 10, theme.updraftBarReady, 15); player.vy = -12; playSound('updraft'); cooldowns.updraft = settings.updraftCooldown; }

    player.x += player.vx;
    if (player.isClinging && state.keys.up && fuel > 0) { player.vy = 0; fuel = Math.max(0, fuel - 0.5); }
    else if (state.keys.up && player.vy >= 0 && !player.grounded && fuel > 0) { player.vy += GRAVITY_GLIDE; fuel = Math.max(0, fuel - 1.2); }
    else { player.vy += GRAVITY; if (fuel < 100) fuel += 2.5; }

    player.vy = Math.min(player.vy, TERMINAL_VELOCITY);
    if (state.keys.up && player.grounded) { player.vy = MAX_JUMP_SPEED; player.grounded = false; }
    player.y += player.vy; player.grounded = false;

    for (let p of state.platforms) {
        if (player.x < p.x + p.w && player.x + player.width > p.x && player.y < p.y + p.h && player.y + player.height > p.y) {
            if (player.vy > 0) { player.y = p.y - player.height; player.vy = 0; player.grounded = true; }
        }
    }
    player.isClinging = (state.keys.up && fuel > 0 && state.platforms.some(p => player.x < p.x + p.w + 5 && player.x + player.width > p.x - 5 && player.y < p.y + p.h + 5 && player.y + player.height > p.y - 5) && !player.grounded);

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

    ctx.save();
    ctx.translate(-state.cameraX, -state.cameraY);

    for (let p of state.platforms) {
        ctx.fillStyle = '#795548'; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = '#4CAF50'; ctx.fillRect(p.x, p.y, p.w, 10);
    }

    ctx.fillStyle = '#EF5350';
    for (let h of state.hazards) {
        if (h.type === 'spike') {
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + h.h);
            ctx.lineTo(h.x + h.w / 2, h.y);
            ctx.lineTo(h.x + h.w, h.y + h.h);
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

    ctx.fillStyle = player.isClinging ? theme.playerClinging : (isGliding ? theme.playerGliding : theme.playerNormal);
    ctx.fillRect(player.x, player.y, player.width, player.height);
    ctx.restore();

    ctx.fillStyle = theme.uiPanel; ctx.fillRect(5, 5, 120, 130);
    ctx.fillStyle = theme.uiText;
    ctx.fillText('SCORE: ' + score, 15, 20);
    ctx.fillText('BEST: ' + getHighScore(), 15, 40);
    ctx.fillStyle = '#fff'; ctx.fillText('FUEL', 15, 60); ctx.fillRect(15, 65, fuel, 10);
    ctx.fillStyle = cooldowns.dash > 0 ? theme.cooldownBar : theme.dashBarReady;
    ctx.fillText('DASH', 15, 95); ctx.fillRect(15, 100, 40, 10);
    ctx.fillStyle = cooldowns.updraft > 0 ? theme.cooldownBar : theme.updraftBarReady;
    ctx.fillText('UPDRFT', 65, 95); ctx.fillRect(65, 100, 40, 10);
}

initGame(); setupMobileControls();
function loop() { update(); draw(); requestAnimationFrame(loop); }
loop();