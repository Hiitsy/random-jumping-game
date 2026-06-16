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
const TWO_PI = Math.PI * 2;

// --- CACHED VALUES ---
let cachedHighScore = 0;
let cachedBgGradient = null;
let cachedBgGradientH = 0;
let frameCount = 0;
let gameTimestamp = 0;

const GRAVITY = 0.3, GRAVITY_GLIDE = 0.05, TERMINAL_VELOCITY = 8, MAX_JUMP_SPEED = -8.5, PLAYER_SPEED = 3.5, DEATH_Y = 600;
let fuel = 100, isGliding = false, dashTimer = 0, deathTimer = 0, score = 0, inputLockTimer = 0, blinkTimer = 0;
let lastSafePosition = { x: 50, y: 200 };
let xVelocityLocked = false;
let teleportAnimation = null;
let teleportTrail = [];
let suppressedInputs = new Set();
let particles = [];
const MAX_PARTICLES = 200;
function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        particles.push({ x, y, vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10, life: 20, color });
    }
}

function updateParticles() {
    // Reverse loop to safely splice without skipping elements or O(n²)
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) {
            // Swap with last element and pop for O(1) removal
            particles[i] = particles[particles.length - 1];
            particles.pop();
        }
    }
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

// Polyfill roundRect for older/incompatible environments if any
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = {tl: r, tr: r, br: r, bl: r};
        else if (Array.isArray(r)) {
            r = {tl: r[0], tr: r[1], br: r[2], bl: r[3]};
        }
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
    };
}

function drawPlayer() {
    const cx = player.x + player.width / 2;
    const cy = player.y + player.height / 2;
    
    // Choose neon themes based on player state
    let bodyColor1, bodyColor2, eyeColor, glowColor;
    if (deathTimer > 0) {
        bodyColor1 = '#555555';
        bodyColor2 = '#333333';
        eyeColor = '#ff3333';
        glowColor = 'transparent';
    } else if (teleportAnimation) {
        bodyColor1 = '#E040FB'; // Teleport purple/magenta
        bodyColor2 = '#7B1FA2';
        eyeColor = '#F3E5F5';
        glowColor = '#E040FB';
    } else if (player.isClinging || player.isCeilingClinging) {
        bodyColor1 = '#00E5FF'; // Cyber cyan
        bodyColor2 = '#00838F';
        eyeColor = '#E0F7FA';
        glowColor = '#00E5FF';
    } else if (isGliding) {
        bodyColor1 = '#FFEB3B'; // Glowing yellow/gold
        bodyColor2 = '#F57F17';
        eyeColor = '#FFFDE7';
        glowColor = '#FFEB3B';
    } else if (dashTimer > 0) {
        bodyColor1 = '#FF5722'; // Blaze orange/red
        bodyColor2 = '#D84315';
        eyeColor = '#FFFFFF';
        glowColor = '#FF5722';
    } else {
        bodyColor1 = theme.playerNormal; // Configured main theme color (Orange-Red)
        bodyColor2 = '#BF360C';
        eyeColor = '#FFFFFF';
        glowColor = theme.playerNormal;
    }

    ctx.save();
    ctx.translate(cx, cy);
    
    // Apply squish, stretch, and tilting animations
    let scaleY = player.scaleY || 1;
    if (player.isCeilingClinging) {
        scaleY = -scaleY; // Flip upside down like a spider!
    }
    ctx.scale(player.scaleX || 1, scaleY);
    ctx.rotate(player.tilt || 0);

    // 1. Shadow underneath the player (drawn slightly below body bounds)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(0, player.height / 2 + 2, player.width * 0.5, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. High-end Neon Glow effect
    if (deathTimer === 0) {
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 10;
    }

    // 3. Slime / Cute Robot dome body shape (rounder top corners)
    ctx.beginPath();
    ctx.roundRect(-player.width / 2, -player.height / 2, player.width, player.height, [8, 8, 4, 4]);
    
    // Gradient fill
    let bodyGrad = ctx.createLinearGradient(0, -player.height / 2, 0, player.height / 2);
    bodyGrad.addColorStop(0, bodyColor1);
    bodyGrad.addColorStop(1, bodyColor2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Stroke border for crisp contrast (breaks the pure pixel art rules)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Reset shadow so it doesn't affect face details
    ctx.shadowBlur = 0;

    // 4. Glossy jelly-like reflection highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.beginPath();
    ctx.ellipse(-player.width * 0.2, -player.height * 0.22, player.width * 0.2, player.height * 0.1, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();

    // 5. Look directions for the face
    let lookX = 0;
    if (player.vx > 0) lookX = 1.5;
    else if (player.vx < 0) lookX = -1.5;
    
    let lookY = 0;
    if (player.vy < -1) lookY = -1.5; // Look up while jumping
    else if (player.vy > 1) lookY = 1.5; // Look down while falling

    const eyeSize = 3.5;
    const eyeSpacing = 4.5;
    const eyeY = -1;
    
    ctx.fillStyle = eyeColor;

    if (deathTimer > 0) {
        // Dead: draw "X" eyes
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        
        // Left Eye X
        ctx.beginPath();
        ctx.moveTo(-eyeSpacing + lookX - 2.5, eyeY + lookY - 2.5);
        ctx.lineTo(-eyeSpacing + lookX + 2.5, eyeY + lookY + 2.5);
        ctx.moveTo(-eyeSpacing + lookX + 2.5, eyeY + lookY - 2.5);
        ctx.lineTo(-eyeSpacing + lookX - 2.5, eyeY + lookY + 2.5);
        ctx.stroke();

        // Right Eye X
        ctx.beginPath();
        ctx.moveTo(eyeSpacing + lookX - 2.5, eyeY + lookY - 2.5);
        ctx.lineTo(eyeSpacing + lookX + 2.5, eyeY + lookY + 2.5);
        ctx.moveTo(eyeSpacing + lookX + 2.5, eyeY + lookY - 2.5);
        ctx.lineTo(eyeSpacing + lookX - 2.5, eyeY + lookY + 2.5);
        ctx.stroke();
    } else if (blinkTimer % 220 < 8) {
        // Blinking (closed eyelids)
        ctx.strokeStyle = eyeColor;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        
        ctx.beginPath();
        ctx.moveTo(-eyeSpacing + lookX - 2, eyeY + lookY);
        ctx.lineTo(-eyeSpacing + lookX + 2, eyeY + lookY);
        ctx.moveTo(eyeSpacing + lookX - 2, eyeY + lookY);
        ctx.lineTo(eyeSpacing + lookX + 2, eyeY + lookY);
        ctx.stroke();
    } else {
        // Expressive oval pupils
        ctx.beginPath();
        ctx.ellipse(-eyeSpacing + lookX, eyeY + lookY, eyeSize * 0.7, eyeSize, 0, 0, Math.PI * 2);
        ctx.ellipse(eyeSpacing + lookX, eyeY + lookY, eyeSize * 0.7, eyeSize, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark pupils inside
        ctx.fillStyle = '#000000';
        ctx.beginPath();
        ctx.arc(-eyeSpacing + lookX, eyeY + lookY, 1, 0, Math.PI * 2);
        ctx.arc(eyeSpacing + lookX, eyeY + lookY, 1, 0, Math.PI * 2);
        ctx.fill();
    }

    // 6. Accessories & Effects
    if (isGliding) {
        // Glowing cyber-wings
        ctx.strokeStyle = '#FFF59D';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        // Left Wing
        ctx.beginPath();
        ctx.moveTo(-player.width / 2, -2);
        ctx.lineTo(-player.width / 2 - 8, -6);
        ctx.lineTo(-player.width / 2 - 14, 2);
        ctx.lineTo(-player.width / 2 - 4, 4);
        ctx.stroke();

        // Right Wing
        ctx.beginPath();
        ctx.moveTo(player.width / 2, -2);
        ctx.lineTo(player.width / 2 + 8, -6);
        ctx.lineTo(player.width / 2 + 14, 2);
        ctx.lineTo(player.width / 2 + 4, 4);
        ctx.stroke();
    }

    if (player.isClinging) {
        // Sticky wall cling pads
        ctx.fillStyle = '#00E5FF';
        let handSide = (player.vx > 0 || player.dashDir > 0) ? player.width / 2 : -player.width / 2;
        ctx.beginPath();
        ctx.arc(handSide, -3, 3, 0, Math.PI * 2);
        ctx.arc(handSide, 3, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    if (player.isCeilingClinging) {
        // Sticky ceiling cling pads (drawn on the ceiling / player head)
        ctx.fillStyle = '#00E5FF';
        ctx.beginPath();
        ctx.arc(-5, -player.height / 2, 3, 0, Math.PI * 2);
        ctx.arc(5, -player.height / 2, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawPixelPlatform(ctx, p) {
    const isCeiling = p.variant === 'ceilingHazard';
    
    // Draw dirt base body
    ctx.fillStyle = isCeiling ? '#5D4037' : '#795548';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    
    // Draw pixelated dark borders around the whole platform block (2px thick)
    ctx.strokeStyle = '#3E2723';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    
    // Draw Top Layer (Grass / Dust)
    ctx.fillStyle = isCeiling ? '#8D6E63' : '#4CAF50';
    ctx.fillRect(p.x + 2, p.y + 2, p.w - 4, 6);
    
    // Jagged fringe:
    const pixelSize = 4;
    for (let gx = p.x + 2; gx < p.x + p.w - 2; gx += pixelSize) {
        if ((Math.sin(gx) * 1000) & 1) {
            ctx.fillRect(gx, p.y + 8, pixelSize, 4);
        }
    }
    
    // Draw highlights/details on grass (light specs)
    ctx.fillStyle = isCeiling ? '#D7CCC8' : '#8BC34A';
    for (let gx = p.x + 4; gx < p.x + p.w - 4; gx += 8) {
        if ((Math.cos(gx) * 1000) & 1) {
            ctx.fillRect(gx, p.y + 3, pixelSize, pixelSize);
        }
    }
    
    // Draw dirt rock details (blocky spots inside dirt body)
    const detailYStart = p.y + 14;
    const detailYEnd = p.y + p.h - 8;
    ctx.fillStyle = isCeiling ? '#BCAAA4' : '#8BC34A'; // light spots
    for (let dx = p.x + 6; dx < p.x + p.w - 6; dx += 24) {
        const dy = detailYStart + (Math.abs(Math.sin(dx) * 12345) % (detailYEnd - detailYStart - 4));
        ctx.fillRect(dx, dy, pixelSize, pixelSize);
    }
    
    ctx.fillStyle = '#3E2723'; // dark spots
    for (let dx = p.x + 16; dx < p.x + p.w - 6; dx += 24) {
        const dy = detailYStart + (Math.abs(Math.cos(dx) * 54321) % (detailYEnd - detailYStart - 4));
        ctx.fillRect(dx, dy, pixelSize, pixelSize);
    }
}

let cooldowns = { dash: 0, updraft: 0, teleport: 0 };

// --- BACKGROUND SCENERY ---
let bgClouds = [];
let bgBuildings = [];
let bgHills = [];
let bgBirds = [];
let bgStars = [];
let bgInitialized = false;

function initBackground() {
    bgClouds = [];
    bgBuildings = [];
    bgHills = [];
    bgBirds = [];
    bgStars = [];
    // Generate initial clouds spread across a wide area
    for (let i = 0; i < 18; i++) {
        bgClouds.push(createCloud(-800 + Math.random() * 3000));
    }
    // Generate city buildings in the far background
    for (let i = 0; i < 50; i++) {
        bgBuildings.push(createBuilding(-500 + i * 120));
    }
    // Generate rolling hills
    for (let i = 0; i < 80; i++) {
        bgHills.push({
            x: -500 + i * 100,
            height: 40 + Math.random() * 60,
            width: 140 + Math.random() * 120,
            color: i % 2 === 0 ? '#2E7D32' : '#388E3C'
        });
    }
    // Generate a few birds
    for (let i = 0; i < 6; i++) {
        bgBirds.push({
            x: Math.random() * 2000,
            y: 60 + Math.random() * 120,
            wingPhase: Math.random() * Math.PI * 2,
            speed: 0.3 + Math.random() * 0.5,
            size: 3 + Math.random() * 3
        });
    }
    // Stars (visible as faint dots in the upper sky)
    for (let i = 0; i < 30; i++) {
        bgStars.push({
            x: Math.random() * 4000 - 1000,
            y: Math.random() * 150,
            size: 1 + Math.random() * 1.5,
            twinklePhase: Math.random() * Math.PI * 2
        });
    }
    bgInitialized = true;
}

function createCloud(baseX) {
    return {
        x: baseX,
        y: 20 + Math.random() * 180,
        w: 60 + Math.random() * 120,
        h: 20 + Math.random() * 30,
        speed: 0.08 + Math.random() * 0.15,
        opacity: 0.3 + Math.random() * 0.5,
        puffs: generateCloudPuffs()
    };
}

function generateCloudPuffs() {
    const count = 3 + Math.floor(Math.random() * 4);
    const puffs = [];
    for (let i = 0; i < count; i++) {
        puffs.push({
            xOff: (i / count) * 0.8 + Math.random() * 0.2,
            yOff: (Math.random() - 0.5) * 0.4,
            rX: 0.25 + Math.random() * 0.3,
            rY: 0.3 + Math.random() * 0.25
        });
    }
    return puffs;
}

function createBuilding(baseX) {
    const w = 30 + Math.random() * 50;
    const h = 60 + Math.random() * 140;
    const windowRows = Math.floor(h / 18);
    const windowCols = Math.floor(w / 14);
    // Pre-generate which windows are "lit"
    const litWindows = [];
    for (let r = 0; r < windowRows; r++) {
        for (let c = 0; c < windowCols; c++) {
            if (Math.random() > 0.4) {
                litWindows.push({
                    r, c,
                    color: Math.random() > 0.7 ? '#FFF9C4' : (Math.random() > 0.5 ? '#FFE082' : '#FFCC80'),
                    flicker: Math.random() * Math.PI * 2
                });
            }
        }
    }
    return {
        x: baseX,
        w: w,
        h: h,
        bodyColor: `hsl(${200 + Math.random() * 30}, ${10 + Math.random() * 15}%, ${18 + Math.random() * 12}%)`,
        roofStyle: Math.floor(Math.random() * 3), // 0=flat, 1=pointed, 2=antenna
        windowRows, windowCols, litWindows
    };
}

function updateBackground() {
    if (!bgInitialized) return;
    // Drift clouds
    bgClouds.forEach(c => { c.x += c.speed; });
    // Animate birds
    bgBirds.forEach(b => {
        b.x += b.speed;
        b.wingPhase += 0.12;
    });
}

function drawBackground(camX, camY) {
    if (!bgInitialized) return;
    const now = gameTimestamp;

    // --- Layer 0: Subtle twinkling stars (very far, barely moves) ---
    ctx.fillStyle = '#FFFFFF';
    const starParallaxX = camX * 0.02;
    const starParallaxY = camY * 0.01;
    const sinTimeStars = now * 0.002;
    for (let i = 0, len = bgStars.length; i < len; i++) {
        const s = bgStars[i];
        const sx = s.x - starParallaxX;
        if (sx < -10 || sx > canvas.width + 10) continue;
        const sy = s.y - starParallaxY;
        const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(sinTimeStars + s.twinklePhase));
        ctx.globalAlpha = twinkle * 0.3;
        ctx.beginPath();
        ctx.arc(sx, sy, s.size, 0, TWO_PI);
        ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // --- Layer 1: Distant city buildings (parallax 0.08) ---
    const buildingBaseY = canvas.height * 0.78;
    const bldgParallaxX = camX * 0.08;
    const bldgParallaxY = camY * 0.04;
    const antennaBlink = Math.sin(now * 0.005) > 0 ? 1 : 0.2;
    const winSinTime = now * 0.003;
    for (let i = 0, len = bgBuildings.length; i < len; i++) {
        const b = bgBuildings[i];
        const bx = b.x - bldgParallaxX;
        // Only draw if on screen
        if (bx + b.w < -50 || bx > canvas.width + 50) continue;
        const by = buildingBaseY - b.h - bldgParallaxY;

        // Building body
        ctx.fillStyle = b.bodyColor;
        ctx.fillRect(bx, by, b.w, b.h);

        // Darker edge accent
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(bx + b.w - 4, by, 4, b.h);

        // Roof details
        if (b.roofStyle === 1) {
            ctx.fillStyle = b.bodyColor;
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + b.w * 0.5, by - 12);
            ctx.lineTo(bx + b.w, by);
            ctx.closePath();
            ctx.fill();
        } else if (b.roofStyle === 2) {
            const halfW = bx + b.w * 0.5;
            ctx.strokeStyle = '#546E7A';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(halfW, by);
            ctx.lineTo(halfW, by - 18);
            ctx.stroke();
            // Antenna light
            ctx.fillStyle = '#EF5350';
            ctx.globalAlpha = antennaBlink;
            ctx.beginPath();
            ctx.arc(halfW, by - 20, 2, 0, TWO_PI);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        }

        // Windows - batch by reducing globalAlpha changes
        const litWins = b.litWindows;
        for (let w = 0, wLen = litWins.length; w < wLen; w++) {
            const win = litWins[w];
            const wy = by + 8 + win.r * 18;
            if (wy + 8 > buildingBaseY) continue;
            const wx = bx + 6 + win.c * 14;
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(winSinTime + win.flicker);
            ctx.fillStyle = win.color;
            ctx.fillRect(wx, wy, 6, 8);
        }
        ctx.globalAlpha = 1.0;
    }

    // --- Layer 2: Rolling hills (parallax 0.15) ---
    const hillParallaxX = camX * 0.15;
    const hillBaseY = canvas.height * 0.85 - camY * 0.08;
    for (let i = 0, len = bgHills.length; i < len; i++) {
        const hill = bgHills[i];
        const hx = hill.x - hillParallaxX;
        if (hx + hill.width < -50 || hx > canvas.width + 50) continue;

        ctx.fillStyle = hill.color;
        ctx.beginPath();
        ctx.ellipse(hx + hill.width * 0.5, hillBaseY, hill.width * 0.5, hill.height, 0, Math.PI, 0);
        ctx.fill();
    }
    // Fill below hills
    ctx.fillStyle = '#1B5E20';
    ctx.fillRect(0, hillBaseY, canvas.width, canvas.height * 0.2);

    // --- Layer 3: Clouds (parallax 0.12, also drift) ---
    ctx.fillStyle = '#FFFFFF';
    const cloudParallaxX = camX * 0.12;
    const cloudParallaxY = camY * 0.06;
    for (let i = 0, len = bgClouds.length; i < len; i++) {
        const c = bgClouds[i];
        const cx = c.x - cloudParallaxX;
        if (cx + c.w < -100 || cx > canvas.width + 100) continue;
        const cy = c.y - cloudParallaxY;

        ctx.globalAlpha = c.opacity;
        const puffs = c.puffs;
        for (let j = 0, pLen = puffs.length; j < pLen; j++) {
            const puff = puffs[j];
            ctx.beginPath();
            ctx.ellipse(
                cx + puff.xOff * c.w,
                cy + puff.yOff * c.h,
                puff.rX * c.w,
                puff.rY * c.h,
                0, 0, TWO_PI
            );
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1.0;

    // --- Layer 4: Animated birds (parallax 0.2) ---
    ctx.strokeStyle = '#37474F';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const birdParallaxX = camX * 0.2;
    const birdParallaxY = camY * 0.1;
    for (let i = 0, len = bgBirds.length; i < len; i++) {
        const b = bgBirds[i];
        const bx = b.x - birdParallaxX;
        if (bx < -50 || bx > canvas.width + 50) continue;
        const by = b.y - birdParallaxY;

        const wingY = Math.sin(b.wingPhase) * b.size * 0.6;
        const absWingY03 = Math.abs(wingY) * 0.3;
        ctx.beginPath();
        ctx.moveTo(bx - b.size, by + wingY);
        ctx.quadraticCurveTo(bx - b.size * 0.4, by - absWingY03, bx, by);
        ctx.quadraticCurveTo(bx + b.size * 0.4, by - absWingY03, bx + b.size, by + wingY);
        ctx.stroke();
    }
}

function manageBackgroundElements() {
    if (!bgInitialized) return;
    const camX = state.cameraX;
    const cw = canvas.width;

    // Respawn clouds that drift off screen far right, recycle to the left
    for (let i = 0, len = bgClouds.length; i < len; i++) {
        const c = bgClouds[i];
        const screenX = c.x - camX * 0.12;
        if (screenX > cw + 200) {
            c.x -= cw / 0.12 + 400;
            c.y = 20 + Math.random() * 180;
            c.opacity = 0.3 + Math.random() * 0.5;
        }
    }

    // Keep buildings wrapping around
    for (let i = 0, len = bgBuildings.length; i < len; i++) {
        const b = bgBuildings[i];
        const screenX = b.x - camX * 0.08;
        if (screenX + b.w < -200) {
            b.x += 6400;
        }
    }

    // Keep hills wrapping
    for (let i = 0, len = bgHills.length; i < len; i++) {
        const h = bgHills[i];
        const screenX = h.x - camX * 0.15;
        if (screenX + h.width < -200) {
            h.x += 8400;
        }
    }

    // Keep birds looping
    for (let i = 0, len = bgBirds.length; i < len; i++) {
        const b = bgBirds[i];
        const screenX = b.x - camX * 0.2;
        if (screenX > cw + 100) {
            b.x -= cw / 0.2 + 200;
            b.y = 60 + Math.random() * 120;
        } else if (screenX < -100) {
            b.x += cw / 0.2 + 200;
            b.y = 60 + Math.random() * 120;
        }
    }

    // Keep stars wrapping
    for (let i = 0, len = bgStars.length; i < len; i++) {
        const s = bgStars[i];
        const screenX = s.x - camX * 0.02;
        if (screenX < -100) s.x += 5000;
        else if (screenX > cw + 100) s.x -= 5000;
    }
}

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

const player = { x: 50, y: 200, width: 20, height: 20, vx: 0, vy: 0, grounded: false, isClinging: false, isCeilingClinging: false, dashDir: 1, scaleX: 1, scaleY: 1, tilt: 0 };

function isMobile() { return 'ontouchstart' in window || navigator.maxTouchPoints > 0; }
function getHighScore() { return cachedHighScore; }
function setHighScore(val) { cachedHighScore = val; try { localStorage.setItem('highscore', val); } catch (e) { } }
function loadHighScore() { try { cachedHighScore = parseInt(localStorage.getItem('highscore')) || 0; } catch (e) { cachedHighScore = 0; } }

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
    player.scaleX = 1; player.scaleY = 1; player.tilt = 0;
    player.isCeilingClinging = false;
    lastSafePosition = { x: player.x, y: player.y };
    teleportAnimation = null;
    teleportTrail = [];
    cooldowns.dash = 0; cooldowns.updraft = 0; cooldowns.teleport = 0; inputLockTimer = 0; xVelocityLocked = false; fuel = 100;
    blinkTimer = 0;
    suppressedInputs.clear();
    clearActionInputs();
    if (!bgInitialized) initBackground();
}

function generateEndless() {
    let difficulty = Math.min(score / 500, 2.5);
    let pathPlatforms = [];
    for (let i = 0, len = state.platforms.length; i < len; i++) {
        if (!state.platforms[i].obstacle) pathPlatforms.push(state.platforms[i]);
    }
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
        updateBackground();
        return;
    }
    if (state.paused) return;
    if (deathTimer > 0) { deathTimer--; if (deathTimer === 0) { if (score > getHighScore()) setHighScore(score); initGame(); } return; }
    if (inputLockTimer > 0) inputLockTimer--;
    if (cooldowns.dash > 0) cooldowns.dash--;
    if (cooldowns.updraft > 0) cooldowns.updraft--;
    if (cooldowns.teleport > 0) cooldowns.teleport--;
    blinkTimer++;
    
    // Smoothly return player to base scale
    player.scaleX += (1 - player.scaleX) * 0.18;
    player.scaleY += (1 - player.scaleY) * 0.18;
    
    // Tilt body based on horizontal speed (tilt resets when wall clinging)
    let targetTilt = player.vx * 0.04;
    if (player.isClinging) targetTilt = 0;
    player.tilt += (targetTilt - player.tilt) * 0.2;
    
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

    if (inputLockTimer === 0 && state.keys.shift && cooldowns.dash === 0) {
        playSound('dash');
        spawnParticles(player.x + 10, player.y + 10, theme.dashVfx, 15);
        dashTimer = 10;
        cooldowns.dash = settings.dashCooldown;
        player.scaleX = 1.35; // stretch horizontally
        player.scaleY = 0.7;  // compress vertically
    }
    if (inputLockTimer === 0 && dashTimer > 0) { player.vx = player.dashDir * 18; player.vy = 0; dashTimer--; }
    else if (inputLockTimer === 0) { player.vx = (state.keys.right ? PLAYER_SPEED : 0) - (state.keys.left ? PLAYER_SPEED : 0); if (player.vx !== 0) player.dashDir = player.vx > 0 ? 1 : -1; }
    else { player.vx = 0; dashTimer = 0; }
    if (xVelocityLocked) player.vx = 0;
    if (inputLockTimer === 0 && state.keys.q && cooldowns.updraft === 0) {
        spawnParticles(player.x + 10, player.y + 10, theme.updraftVfx, 15);
        player.vy = -12;
        playSound('updraft');
        cooldowns.updraft = settings.updraftCooldown;
        player.scaleX = 0.65; // stretch vertically
        player.scaleY = 1.35;
    }
    if (inputLockTimer === 0 && state.keys.teleport && cooldowns.teleport === 0) {
        beginTeleportRecall();
        updateParticles();
        updateTeleportTrail();
        return;
    }

    player.x += player.vx;
    
    // Spawn subtle dust particles when moving fast on the ground
    if (player.grounded && Math.abs(player.vx) > 0.5 && Math.random() < 0.25) {
        particles.push({
            x: player.x + (player.vx > 0 ? 0 : player.width),
            y: player.y + player.height,
            vx: -player.vx * 0.3 + (Math.random() - 0.5) * 0.8,
            vy: -Math.random() * 1.2,
            life: 12 + Math.random() * 6,
            color: '#8D6E63' // Dust color matching ground/platform tops
        });
    }

    // Spawn glowing particle trail when moving rapidly upwards (e.g., during an updraft boost)
    if (player.vy < -3 && !player.grounded && !player.isClinging && deathTimer === 0 && Math.random() < 0.4) {
        particles.push({
            x: player.x + player.width / 2 + (Math.random() - 0.5) * 8,
            y: player.y + player.height,
            vx: (Math.random() - 0.5) * 2,
            vy: -player.vy * 0.25 + Math.random() * 1.5, // drift downwards relative to the player
            life: 12 + Math.random() * 8,
            color: theme.updraftVfx
        });
    }
    
    isGliding = false;
    if (inputLockTimer === 0 && (player.isClinging || player.isCeilingClinging) && state.keys.up && fuel > 0) { player.vy = 0; fuel = Math.max(0, fuel - 0.5); }
    else if (inputLockTimer === 0 && state.keys.up && player.vy >= 0 && !player.grounded && fuel > 0) { player.vy += GRAVITY_GLIDE; fuel = Math.max(0, fuel - 1.2); isGliding = true; }
    else { player.vy += GRAVITY; if (fuel < 100) fuel += 2.5; }

    player.vy = Math.min(player.vy, TERMINAL_VELOCITY);
    if (inputLockTimer === 0 && state.keys.up && player.grounded) { 
        player.vy = MAX_JUMP_SPEED; 
        player.grounded = false; 
        player.scaleX = 0.75; // stretch vertically on jump
        player.scaleY = 1.25;
    }
    player.y += player.vy; player.grounded = false;

    for (let p of state.platforms) {
        if (player.x < p.x + p.w && player.x + player.width > p.x && player.y < p.y + p.h && player.y + player.height > p.y) {
            if (player.vy > 0) {
                if (!player.grounded) {
                    // Impact squash on landing, based on landing velocity
                    const squashAmount = Math.min(0.4, player.vy * 0.05);
                    player.scaleX = 1 + squashAmount;
                    player.scaleY = 1 - squashAmount;
                }
                player.y = p.y - player.height;
                player.vy = 0;
                player.grounded = true;
                lastSafePosition = { x: player.x, y: player.y };
            } else if (player.vy < 0) {
                // Rising collision: bump head against the bottom edge instead of clipping inside
                player.y = p.y + p.h;
                player.vy = 0;
            }
        }
    }
    
    player.isClinging = false;
    player.isCeilingClinging = false;
    if (inputLockTimer === 0 && state.keys.up && fuel > 0 && !player.grounded) {
        // 1. Check bottom-edge proximity for spider/ceiling cling (overlap horizontally, near bottom edge)
        const touchingBottom = state.platforms.some(p => 
            player.x < p.x + p.w && 
            player.x + player.width > p.x && 
            player.y >= p.y + p.h - 6 && 
            player.y <= p.y + p.h + 6
        );
        
        if (touchingBottom) {
            player.isCeilingClinging = true;
        } else {
            // 2. Check side-edge proximity for wall cling
            const touchingSide = state.platforms.some(p => 
                player.x < p.x + p.w + 5 && 
                player.x + player.width > p.x - 5 && 
                player.y < p.y + p.h && 
                player.y + player.height > p.y
            );
            if (touchingSide) {
                player.isClinging = true;
            }
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) {
            particles[i] = particles[particles.length - 1];
            particles.pop();
        }
    }

    for (let h of state.hazards) {
        if (player.x < h.x + h.w && player.x + player.width > h.x && player.y < h.y + h.h && player.y + player.height > h.y) { playSound('death'); deathTimer = 60; }
    }
    state.cameraX += (player.x - canvas.width / 3 - state.cameraX) * 0.1;
    state.cameraY += (player.y - canvas.height / 2 - state.cameraY) * 0.1;
    updateBackground();
    // Only manage wrapping every 30 frames to avoid unnecessary work
    if (frameCount % 30 === 0) manageBackgroundElements();
}

function draw() {
    // Cache the background gradient — only recreate if canvas height changed
    if (!cachedBgGradient || cachedBgGradientH !== canvas.height) {
        cachedBgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        cachedBgGradient.addColorStop(0, theme.backgroundTop);
        cachedBgGradient.addColorStop(1, theme.backgroundBottom);
        cachedBgGradientH = canvas.height;
    }
    ctx.fillStyle = cachedBgGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw parallax background layers
    drawBackground(state.cameraX, state.cameraY);

    if (state.screen === 'title') {
        // Draw title screen floating particles (retro pixel dust)
        particles.forEach(p => {
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, 4, 4);
        });

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 1. Draw Title text with a retro sharp 3px drop-shadow
        ctx.font = '24px "Press Start 2P", monospace';
        ctx.fillStyle = '#000000';
        ctx.fillText('RANDOM JUMPING GAME', canvas.width / 2 + 3, canvas.height / 2 - 100 + 3);
        ctx.fillStyle = '#FFD54F'; // Nice golden yellow
        ctx.fillText('RANDOM JUMPING GAME', canvas.width / 2, canvas.height / 2 - 100);

        // 2. Pulsing retro start text
        let pulse = 0.5 + 0.5 * Math.sin(gameTimestamp / 200);
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, ' + pulse + ')';
        ctx.fillText('PRESS ANY KEY OR CLICK TO PLAY', canvas.width / 2, canvas.height / 2 - 25);

        // 3. Control Instructions Box (Simple, sharp retro panel)
        const boxW = 560;
        const boxH = 155;
        const boxX = canvas.width / 2 - boxW / 2;
        const boxY = canvas.height / 2 + 25;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Instructions header
        ctx.fillStyle = '#FF8A65'; // Retro coral
        ctx.fillText('CONTROLS', canvas.width / 2, boxY + 25);

        // Instructions text (blocky and aligned)
        ctx.fillStyle = '#ECEFF1';
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.fillText('A / D  or  L/R Buttons  —  Move Left / Right', canvas.width / 2, boxY + 55);
        ctx.fillText('W / Space  or  J Button  —  Jump / Glide / Wall Cling', canvas.width / 2, boxY + 80);
        ctx.fillText('Shift  or  D Button  —  Dash', canvas.width / 2, boxY + 105);
        ctx.fillText('Q/U  —  Updraft  |  E/T  —  Teleport  |  Esc/P  —  Pause', canvas.width / 2, boxY + 130);

        // Reset text alignment for HUD/Gameplay drawing
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        return;
    }

    ctx.save();
    const camX = state.cameraX;
    const camY = state.cameraY;
    ctx.translate(-camX, -camY);

    // Compute visible viewport in world coordinates
    const viewL = camX - 50;
    const viewR = camX + canvas.width + 50;
    const viewT = camY - 50;
    const viewB = camY + canvas.height + 50;

    for (let i = 0, len = state.platforms.length; i < len; i++) {
        const p = state.platforms[i];
        // Viewport culling for platforms
        if (p.x + p.w < viewL || p.x > viewR || p.y + p.h < viewT || p.y > viewB) continue;
        if (p.variant === 'ceilingHazard') {
            // Draw pixel-art chains
            ctx.fillStyle = '#90A4AE'; // Iron grey
            const chainX1 = p.x + 16;
            const chainX2 = p.x + p.w - 20;
            for (let cy = p.y - 40; cy < p.y; cy += 8) {
                ctx.fillRect(chainX1, cy, 4, 6);
                ctx.fillRect(chainX2, cy, 4, 6);
            }
        }
        drawPixelPlatform(ctx, p);
    }

    for (let i = 0, len = state.hazards.length; i < len; i++) {
        const h = state.hazards[i];
        if (h.type === 'spike') {
            // Viewport culling for individual spikes
            if (h.x + h.w < viewL || h.x > viewR) continue;
            // Upward metal spike
            const halfW = h.w * 0.5;
            ctx.fillStyle = '#37474F';
            ctx.fillRect(h.x + 2, h.y + h.h - 3, h.w - 4, 3);
            
            ctx.fillStyle = '#78909C';
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + h.h - 3);
            ctx.lineTo(h.x + halfW, h.y);
            ctx.lineTo(h.x + h.w, h.y + h.h - 3);
            ctx.closePath();
            ctx.fill();
            
            ctx.fillStyle = '#CFD8DC';
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + h.h - 3);
            ctx.lineTo(h.x + halfW, h.y);
            ctx.lineTo(h.x + halfW, h.y + h.h - 3);
            ctx.closePath();
            ctx.fill();
            
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + h.h - 3);
            ctx.lineTo(h.x + halfW, h.y);
            ctx.lineTo(h.x + h.w, h.y + h.h - 3);
            ctx.stroke();
        } else if (h.type === 'bottomSpike') {
            if (h.x + h.w < viewL || h.x > viewR) continue;
            const halfW = h.w * 0.5;
            ctx.fillStyle = '#37474F';
            ctx.fillRect(h.x + 2, h.y, h.w - 4, 3);
            
            ctx.fillStyle = '#78909C';
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + 3);
            ctx.lineTo(h.x + halfW, h.y + h.h);
            ctx.lineTo(h.x + h.w, h.y + 3);
            ctx.closePath();
            ctx.fill();
            
            ctx.fillStyle = '#CFD8DC';
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + 3);
            ctx.lineTo(h.x + halfW, h.y + h.h);
            ctx.lineTo(h.x + halfW, h.y + 3);
            ctx.closePath();
            ctx.fill();
            
            ctx.strokeStyle = '#263238';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(h.x, h.y + 3);
            ctx.lineTo(h.x + halfW, h.y + h.h);
            ctx.lineTo(h.x + h.w, h.y + 3);
            ctx.stroke();
        } else if (h.type === 'carpet') {
            // Only draw carpet spikes that are within the viewport
            ctx.fillStyle = '#263238';
            const carpetDrawL = Math.max(h.x, viewL);
            const carpetDrawR = Math.min(h.x + h.w, viewR);
            ctx.fillRect(carpetDrawL, h.y + 16, carpetDrawR - carpetDrawL, h.h - 16);
            
            const spikeW = 16;
            const spikeH = 16;
            const halfSW = spikeW * 0.5;
            // Only iterate spikes in the visible range
            const startX = Math.floor(carpetDrawL / spikeW) * spikeW;
            const endX = carpetDrawR;
            
            for (let sx = startX; sx < endX; sx += spikeW) {
                ctx.fillStyle = '#78909C';
                ctx.beginPath();
                ctx.moveTo(sx, h.y + spikeH);
                ctx.lineTo(sx + halfSW, h.y);
                ctx.lineTo(sx + spikeW, h.y + spikeH);
                ctx.closePath();
                ctx.fill();
                
                ctx.fillStyle = '#CFD8DC';
                ctx.beginPath();
                ctx.moveTo(sx, h.y + spikeH);
                ctx.lineTo(sx + halfSW, h.y);
                ctx.lineTo(sx + halfSW, h.y + spikeH);
                ctx.closePath();
                ctx.fill();
                
                ctx.strokeStyle = '#37474F';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(sx, h.y + spikeH);
                ctx.lineTo(sx + halfSW, h.y);
                ctx.lineTo(sx + spikeW, h.y + spikeH);
                ctx.stroke();
            }
        }
    }

    for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i];
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life * 0.05; // pre-computed 1/20
        ctx.fillRect(p.x, p.y, 4, 4);
    }
    ctx.globalAlpha = 1.0;

    if (teleportAnimation) {
        teleportTrail.forEach(trail => {
            ctx.globalAlpha = trail.life / 18 * 0.55;
            ctx.fillStyle = theme.teleportVfx;
            ctx.fillRect(trail.x - 3, trail.y - 3, player.width + 6, player.height + 6);
        });
        ctx.globalAlpha = 1.0;
    }

    drawPlayer();
    ctx.restore();

    ctx.save();
    ctx.font = '10px "Press Start 2P", monospace';
    
    // Reposition HUD to Top Right and increase sizes by ~25%
    const hudW = 240;
    const hudH = 140;
    const hudX = canvas.width - hudW - 15;
    const hudY = 15;
    
    // HUD Panel Background & Border
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(hudX, hudY, hudW, hudH);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.strokeRect(hudX, hudY, hudW, hudH);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('SCORE: ' + score, hudX + 15, hudY + 30);
    ctx.fillText('BEST : ' + getHighScore(), hudX + 15, hudY + 50);
    
    ctx.fillText('FUEL', hudX + 15, hudY + 74);
    // Draw fuel bar frame (larger scale)
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(hudX + 15, hudY + 80, 132, 12);
    ctx.fillStyle = '#263238';
    ctx.fillRect(hudX + 16, hudY + 81, 130, 10);
    // Fill fuel (adjusted multiplier for 130px width)
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(hudX + 16, hudY + 81, Math.min(130, fuel * 1.3), 10);
    
    // Ability cooldown bars (repositioned and widened)
    // Dash
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('DSH', hudX + 15, hudY + 112);
    ctx.strokeRect(hudX + 15, hudY + 116, 52, 10);
    ctx.fillStyle = cooldowns.dash > 0 ? '#BF360C' : '#00E5FF';
    ctx.fillRect(hudX + 16, hudY + 117, 50 * (cooldowns.dash > 0 ? (settings.dashCooldown - cooldowns.dash) / settings.dashCooldown : 1), 8);
    
    // Updraft
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('UPD', hudX + 85, hudY + 112);
    ctx.strokeRect(hudX + 85, hudY + 116, 52, 10);
    ctx.fillStyle = cooldowns.updraft > 0 ? '#BF360C' : '#FFEB3B';
    ctx.fillRect(hudX + 86, hudY + 117, 50 * (cooldowns.updraft > 0 ? (settings.updraftCooldown - cooldowns.updraft) / settings.updraftCooldown : 1), 8);
    
    // Teleport
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('TEL', hudX + 155, hudY + 112);
    ctx.strokeRect(hudX + 155, hudY + 116, 52, 10);
    ctx.fillStyle = cooldowns.teleport > 0 ? '#BF360C' : '#E040FB';
    ctx.fillRect(hudX + 156, hudY + 117, 50 * (cooldowns.teleport > 0 ? (settings.teleportCooldown - cooldowns.teleport) / settings.teleportCooldown : 1), 8);
    
    ctx.restore();
}

loadHighScore();
initBackground();
initGame(); setupMobileControls();
function loop(timestamp) {
    gameTimestamp = timestamp || performance.now();
    frameCount++;
    update();
    draw();
    requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
