import { Input } from './input.js';
import { AudioManager } from './audio.js';

/**
 * Coordinates the core Space Invaders gameplay loop, state, and rendering.
 * Receives the canvas element and its 2D context from the bootstrap code.
 */
export class Game {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.input = new Input();
    this.audio = new AudioManager();

    this.reset();
  }

  /**
   * Reinitializes the entire game state so a fresh run can begin.
   */
  reset() {
    this.state = 'playing'; // 'playing' | 'paused' | 'gameover'
    this.score = 0;
    this.lives = 10;
    this.level = 1;
    this.time = 0;
    this.toast = '';
    this.toastTime = 0;
    this.highScore = loadInt('highScore', 0);
    this.newHighAnnounced = false;
    this.player = new Player(this);
    this.playerBullets = [];
    this.enemyBullets = [];
    this.explosions = [];
    this.powerups = [];
    this.wave = this.createWave();
    this.invaderDir = 1; // 1 -> right, -1 -> left
    this.invaderSpeed = 16; // base horizontal speed
    this.dropStep = 18; // downward shift
    this.shootCooldown = 0;
    this.powerupSpawnChance = 0.06; // slightly reduced chance per destroyed invader
  }

  /**
   * Procedurally assembles a clustered wave of invaders for the active level.
   */
  createWave() {
    // Randomized compact formation with minimum spacing; scales gently with level
    const L = Math.max(0, this.level - 1);
    const invaders = [];
    const extraCluster = Math.min(1, Math.floor(L / 4)); // +1 additional cluster starting at level 5
    const clusters = 2 + Math.floor(Math.random() * 2) + extraCluster; // between 2 and 4
    const margin = 20;
    const minSep = 6; // minimum spacing between invaders
    for (let k = 0; k < clusters; k++) {
      const cx = 100 + Math.random() * (this.canvas.width - 200);
      const cy = 30 + Math.random() * 70; // near the upper playfield
      const addPerLevel = Math.min(2, Math.floor(L / 5)); // +0 to +2 invaders per cluster at higher levels
      const count = 4 + Math.floor(Math.random() * 3) + addPerLevel; // 4 to 8 per cluster
      for (let i = 0; i < count; i++) {
        // Attempt to find a collision-free spawn position
        let tries = 0;
        while (tries++ < 50) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 10 + Math.random() * 28;
          const rx = cx + Math.cos(angle) * radius + (Math.random()*10-5);
          const ry = cy + Math.sin(angle) * radius + (Math.random()*6-3);
          const x = Math.max(margin, Math.min(this.canvas.width - margin - 28, rx));
          const y = Math.max(margin, Math.min(this.canvas.height * 0.33, ry));
          const inv = new Invader(this, x, y, k % 5);
          inv.speedY = 20 + Math.random() * 10 + L * 2.5; // moderate descent that scales gently
          inv.homing = 16 + Math.random() * 16 + L * 1.8; // horizontal homing that also scales gently
          if (!invaders.some(o => overlapsWithMargin(inv, o, minSep))) {
            invaders.push(inv);
            break;
          }
        }
      }
    }
    return invaders;
  }

  /**
   * Advances the simulation by the supplied delta time (seconds).
   */
  update(dt) {
    // Handle global input shortcuts
    if (this.input.justPressed('KeyP')) {
      if (this.state === 'playing') this.state = 'paused';
      else if (this.state === 'paused') this.state = 'playing';
    }
    if (this.input.justPressed('KeyS')) {
      const on = this.audio.toggleSfx();
      this.toast = `SFX ${on ? 'an' : 'aus'}`; this.toastTime = 1.2;
    }
    if (this.input.justPressed('KeyM')) {
      const on = this.audio.toggleMusic();
      this.toast = `Musik ${on ? 'an' : 'aus'}`; this.toastTime = 1.2;
    }
    if (this.input.justPressed('KeyR')) {
      this.reset();
    }

    if (this.state !== 'playing') {
      this.input.update();
      return;
    }

    this.time += dt;
    this.input.update();

    // Player ship
    this.player.update(dt);
    if (this.player.powerTimer > 0) this.player.powerTimer -= dt;

    // Handle player firing
    if ((this.input.down('Space') || this.input.down('KeyJ')) && this.player.cooldown <= 0) {
      const cx = this.player.x + this.player.w / 2 - 2;
      const y = this.player.y - 8;
      if (this.player.powerTimer > 0) {
        // Triple shot: three parallel projectiles
        this.playerBullets.push(new Bullet(cx - 10, y, 0, -380, 'player'));
        this.playerBullets.push(new Bullet(cx,      y, 0, -380, 'player'));
        this.playerBullets.push(new Bullet(cx + 10, y, 0, -380, 'player'));
        this.player.cooldown = 0.28;
      } else {
        this.playerBullets.push(new Bullet(cx, y, 0, -380, 'player'));
        this.player.cooldown = 0.35;
      }
      this.audio.playShoot();
    }
    if (this.player.cooldown > 0) this.player.cooldown -= dt;

    // Invader logic: move downward while steering horizontally toward the player
    for (const inv of this.wave) {
      const targetX = this.player.x + this.player.w / 2;
      const centerX = inv.x + inv.w / 2;
      const want = (targetX - centerX) * 0.6; // proportional steering factor
      const maxStep = inv.homing * dt;
      const step = Math.max(-maxStep, Math.min(maxStep, want * dt));
      inv.x += step;
      inv.y += inv.speedY * dt;
    }
    // Apply separation so invaders do not overlap
    this.separateInvaders();

    // Allow a random surviving invader to shoot
    this.shootCooldown -= dt;
    if (this.shootCooldown <= 0 && this.wave.length) {
      const s = this.wave[Math.floor(Math.random() * this.wave.length)];
      this.enemyBullets.push(new Bullet(s.x + s.w / 2 - 2, s.y + s.h + 4, 0, 150 + Math.random()*50, 'enemy'));
      this.shootCooldown = Math.max(0.6, 1.2 - this.level * 0.08);
    }

    // Advance all active entities
    for (const b of this.playerBullets) b.update(dt);
    for (const b of this.enemyBullets) b.update(dt);
    for (const e of this.explosions) e.update(dt);
    for (const p of this.powerups) p.update(dt);

    // Resolve collisions
    // Player bullets vs. invaders
    for (const b of this.playerBullets) {
      for (const inv of this.wave) {
        if (!b.dead && aabb(b, inv)) {
          b.dead = true;
          inv.dead = true;
          this.explosions.push(new Explosion(inv.x + inv.w/2, inv.y + inv.h/2));
          this.score += 10 * (this.level);
          this.audio.playExplosion();
          this.checkHighScore?.();
          // Chance to spawn a power-up
          if (Math.random() < this.powerupSpawnChance) {
            this.powerups.push(new PowerUp(inv.x + inv.w/2 - 10, inv.y + inv.h/2 - 10, 'triple'));
          }
        }
      }
    }
    this.wave = this.wave.filter(i => !i.dead);

    // Enemy bullets vs. player
    for (const b of this.enemyBullets) {
      if (!b.dead && aabb(b, this.player)) {
        b.dead = true;
        this.explosions.push(new Explosion(this.player.x + this.player.w/2, this.player.y + this.player.h/2));
        this.lives -= 1;
        this.player.invuln = 1.2;
        this.audio.playHit();
        if (this.lives <= 0) this.state = 'gameover';
      }
    }

    // Remove invaders that reach the bottom and deduct a life
    for (const inv of this.wave) {
      if (!inv.dead && inv.y > this.canvas.height) {
        inv.dead = true;
        this.lives -= 1;
        this.audio?.playHit();
        if (this.lives <= 0) this.state = 'gameover';
      }
    }

    // Collect power-ups
    for (const p of this.powerups) {
      if (!p.dead && aabb(p, this.player)) {
        p.dead = true;
        this.player.powerTimer = 8.0; // 8 seconds of triple shot
        this.toast = 'Triple‑Schuss aktiviert'; this.toastTime = 1.6;
        this.audio.playPowerUp();
      }
    }

    // Cleanup bullets, explosions, and power-ups
    this.playerBullets = this.playerBullets.filter(b => !b.dead && b.y > -20);
    this.enemyBullets = this.enemyBullets.filter(b => !b.dead && b.y < this.canvas.height + 20);
    this.explosions = this.explosions.filter(e => !e.dead);
    this.powerups = this.powerups.filter(p => !p.dead && p.y < this.canvas.height + 24);

    // Wave cleared -> advance to the next level
    if (!this.wave.length) {
      // Crowd cheer for clearing the level plus a bonus life
      this.audio?.playLevelComplete();
      this.lives += 1;
      this.toast = '+1 Leben'; this.toastTime = 1.5;

      this.level += 1;
      // Slightly raise legacy parameters that might still be referenced
      this.invaderSpeed += 6;
      this.dropStep += 2;
      this.wave = this.createWave();
      // Short start jingle for the new level
      this.audio?.playLevelStart();
    }
  }

  getFrontInvaders() {
    // No longer required (formation is random) but kept for backward compatibility:
    return this.wave.slice();
  }

  /**
   * Renders the current frame to the canvas.
   */
  render() {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Background stars
    c.save();
    c.globalAlpha = 0.2;
    c.fillStyle = '#a0b9ff';
    for (let i = 0; i < 60; i++) {
      const x = (i * 127 + Math.floor(this.time*50) * (i%3+1)) % this.canvas.width;
      const y = (i * 53) % this.canvas.height;
      c.fillRect(x, y, 2, 2);
    }
    c.restore();

    // Player ship
    this.player.render(c);

    // Invader sprites
    for (const inv of this.wave) inv.render(c);

    // Projectiles
    c.fillStyle = '#ffd65a';
    for (const b of this.playerBullets) b.render(c);
    c.fillStyle = '#ff6a6a';
    for (const b of this.enemyBullets) b.render(c);

    // Explosion effects
    for (const e of this.explosions) e.render(c);
    // Power-ups
    for (const p of this.powerups) p.render(c);

    // HUD
    c.fillStyle = '#cfd6ff';
    c.font = '16px system-ui, Segoe UI, Arial';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(`Score: ${this.score}`, 16, 12);
    c.fillText(`Lives: ${this.lives}`, 140, 12);
    c.fillText(`Level: ${this.level}`, 240, 12);
    c.fillText(`Best: ${this.highScore}`, 340, 12);

    // Toast indicator in the lower right corner
    if (this.toastTime > 0 && this.toast) {
      this.toastTime -= 1/60;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, this.toastTime));
      c.fillStyle = '#cfd6ff';
      c.font = 'bold 16px system-ui, Segoe UI, Arial';
      c.textAlign = 'right';
      c.fillText(this.toast, this.canvas.width - 16, this.canvas.height - 16);
      c.restore();
    }

    if (this.state === 'paused') this.overlay('PAUSE');
    if (this.state === 'gameover') {
      this.overlay('GAME OVER');
      if (this.score === this.highScore && this.highScore > 0) {
        c.fillStyle = '#ffd65a';
        c.font = 'bold 22px system-ui, Segoe UI, Arial';
        c.textAlign = 'center';
        c.fillText('Neuer Highscore!', this.canvas.width/2, this.canvas.height/2 + 54);
      }
    }
  }

  /**
   * Draws a semi-transparent overlay with status messaging.
   */
  overlay(text) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = 0.85;
    c.fillStyle = '#0b0e18';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.restore();

    c.fillStyle = '#cfd6ff';
    c.font = 'bold 48px system-ui, Segoe UI, Arial';
    c.textAlign = 'center';
    c.fillText(text, this.canvas.width/2, this.canvas.height/2 - 20);
    c.font = '18px system-ui, Segoe UI, Arial';
    c.fillText('R: Neustart • P: Fortsetzen', this.canvas.width/2, this.canvas.height/2 + 20);
  }
}

/**
 * Helper routine that nudges invaders apart to avoid overlaps.
 */
Game.prototype.separateInvaders = function() {
  const items = this.wave;
  const margin = 2; // minimal padding
  const maxIterations = 2;
  const leftBound = 20, rightBound = this.canvas.width - 20;
  for (let iter = 0; iter < maxIterations; iter++) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i]; if (a.dead) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]; if (b.dead) continue;
        if (overlapsWithMargin(a, b, margin)) {
          // compute the minimal displacement along the smaller penetration axis
          const dx1 = (b.x + b.w + margin) - a.x;        // b overlaps the left side of a
          const dx2 = (a.x + a.w + margin) - b.x;        // a overlaps the left side of b
          const dy1 = (b.y + b.h + margin) - a.y;
          const dy2 = (a.y + a.h + margin) - b.y;
          const penX = Math.min(dx1, dx2);
          const penY = Math.min(dy1, dy2);
          if (penX < penY) {
            // push apart horizontally
            const push = penX / 2;
            if (a.x < b.x) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
          } else {
            // separate vertically only a little so fall speed stays stable
            const push = Math.min(2, penY / 2);
            if (a.y < b.y) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
          // Keep invaders inside the horizontal bounds
          a.x = Math.max(leftBound, Math.min(rightBound - a.w, a.x));
          b.x = Math.max(leftBound, Math.min(rightBound - b.w, b.x));
        }
      }
    }
  }
};

/**
 * Persists and announces a new high score when it is achieved.
 */
Game.prototype.checkHighScore = function() {
  if (this.score > this.highScore) {
    this.highScore = this.score;
    saveInt('highScore', this.highScore);
    if (!this.newHighAnnounced) {
      this.toast = 'Neuer Highscore!';
      this.toastTime = 1.8;
      this.newHighAnnounced = true;
    }
  }
};

/**
 * Represents the player-controlled ship responsible for movement and firing.
 */
class Player {
  constructor(game) {
    this.game = game;
    this.w = 42; this.h = 20;
    this.x = game.canvas.width/2 - this.w/2;
    this.y = game.canvas.height - 70;
    this.speed = 260;
    this.cooldown = 0;
    this.invuln = 0;
    this.powerTimer = 0; // Triple shot remains active while > 0
  }
  /**
   * Reads current input and moves the ship while respecting arena bounds.
   */
  update(dt) {
    const g = this.game;
    // 2D movement: arrow keys or WASD in any direction
    let dx = 0, dy = 0;
    if (g.input.down('ArrowLeft')  || g.input.down('KeyA')) dx -= 1;
    if (g.input.down('ArrowRight') || g.input.down('KeyD')) dx += 1;
    if (g.input.down('ArrowUp')    || g.input.down('KeyW')) dy -= 1;
    if (g.input.down('ArrowDown')  || g.input.down('KeyS')) dy += 1;

    const len = Math.hypot(dx, dy) || 1; // normalize diagonal movement
    this.x += (dx/len) * this.speed * dt;
    this.y += (dy/len) * this.speed * dt;

    const margin = 20;
    this.x = Math.max(margin, Math.min(g.canvas.width  - this.w - margin, this.x));
    this.y = Math.max(margin, Math.min(g.canvas.height - this.h - margin, this.y));
    if (this.invuln > 0) this.invuln -= dt;
  }
  /**
   * Draws the player ship using layered vector shapes.
   */
  render(c) {
    c.save();
    if (this.invuln > 0) c.globalAlpha = 0.5 + 0.5*Math.sin(this.game.time*20);

    const cx = this.x + this.w/2;
    const cy = this.y + this.h/2 + 2;

    // Saucer hull
    c.fillStyle = '#bfe3ff';
    c.strokeStyle = '#6aa9d8';
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(cx, cy, this.w*0.38, this.h*0.55, 0, 0, Math.PI*2);
    c.fill();
    c.stroke();

    // Command bridge dome
    c.beginPath();
    c.fillStyle = '#e9f6ff';
    c.arc(cx, cy - this.h*0.25, 3.5, 0, Math.PI*2);
    c.fill();

    // Pylons connecting to the warp nacelles
    c.fillStyle = '#a9d5f5';
    c.fillRect(cx - this.w*0.42, cy + 1, this.w*0.22, 2);
    c.fillRect(cx + this.w*0.20, cy + 1, this.w*0.22, 2);

    // Warp nacelles on both sides
    c.fillStyle = '#9fd0f3';
    const gondelW = this.w*0.25, gondelH = 6;
    // left side
    c.fillRect(cx - this.w*0.62, cy - gondelH/2, gondelW, gondelH);
    c.fillStyle = '#ff6a6a';
    c.fillRect(cx - this.w*0.62 - 3, cy - gondelH/2, 3, gondelH); // red tip
    // right side
    c.fillStyle = '#9fd0f3';
    c.fillRect(cx + this.w*0.37, cy - gondelH/2, gondelW, gondelH);
    c.fillStyle = '#ff6a6a';
    c.fillRect(cx + this.w*0.37 + gondelW, cy - gondelH/2, 3, gondelH);

    // Forward deflector dish beneath the saucer
    c.fillStyle = '#ffd65a';
    c.beginPath();
    c.arc(cx, cy + this.h*0.35, 3, 0, Math.PI*2);
    c.fill();

    c.restore();
  }
}

/**
 * Represents a single invader sprite with simple rendering variations.
 */
class Invader {
  constructor(game, x, y, row) {
    this.game = game;
    this.x = x; this.y = y;
    this.w = 28; this.h = 18;
    this.row = row;
    this.dead = false;
    // Visual variety: 0=Fighter, 1=Cruiser, 2=Scout
    this.kind = Math.floor(Math.random() * 3);
  }
  /**
   * Renders the invader variant with lightweight sprite art.
   */
  render(c) {
    const t = this.game.time;
    const flicker = 0.6 + 0.4 * Math.sin(t * 20 + (this.x + this.y) * 0.05);
    const schemes = [
      { body: '#ff7979', accent: '#ffd1a1', engine: '#ffb74d' }, // Fighter – red/orange
      { body: '#b47cff', accent: '#e3c7ff', engine: '#c59eff' }, // Cruiser – purple
      { body: '#6ee7ff', accent: '#c7f8ff', engine: '#86efff' }, // Scout – cyan
    ];
    const s = schemes[this.kind % schemes.length];

    const x = this.x, y = this.y, w = this.w, h = this.h;
    c.save();
    // Body
    c.fillStyle = s.body;

    if (this.kind === 0) {
      // Fighter: pointed nose, short wings, twin engines
      c.beginPath();
      c.moveTo(x + w*0.5, y);            // Nose
      c.lineTo(x + w*0.9, y + h*0.45);   // Right fuselage
      c.lineTo(x + w*0.7, y + h*0.55);
      c.lineTo(x + w*0.7, y + h*0.8);
      c.lineTo(x + w*0.3, y + h*0.8);
      c.lineTo(x + w*0.3, y + h*0.55);
      c.lineTo(x + w*0.1, y + h*0.45);   // Left fuselage
      c.closePath();
      c.fill();

      // Wings
      c.fillRect(x + w*0.05, y + h*0.5, w*0.25, 3);
      c.fillRect(x + w*0.70, y + h*0.5, w*0.25, 3);

      // Cockpit canopy
      c.fillStyle = s.accent;
      c.fillRect(x + w*0.45, y + h*0.2, w*0.10, h*0.18);

      // Engine glow
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.34, y + h*0.80, 4, 4);
      c.fillRect(x + w*0.62, y + h*0.80, 4, 4);
    } else if (this.kind === 1) {
      // Cruiser: wide hull with side pods and three engines
      c.fillRect(x + w*0.18, y + h*0.15, w*0.64, h*0.55);
      // Nose / cockpit dome
      c.fillStyle = s.accent;
      c.beginPath();
      c.arc(x + w*0.5, y + h*0.18, 3, 0, Math.PI*2);
      c.fill();
      // Side wings
      c.fillStyle = s.body;
      c.fillRect(x,           y + h*0.40, w*0.2, 3);
      c.fillRect(x + w*0.80,  y + h*0.40, w*0.2, 3);
      // Engines
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.30, y + h*0.70, 4, 4);
      c.fillRect(x + w*0.48, y + h*0.70, 4, 4);
      c.fillRect(x + w*0.66, y + h*0.70, 4, 4);
    } else {
      // Scout: small saucer with prongs
      c.beginPath();
      c.ellipse(x + w*0.5, y + h*0.45, w*0.32, h*0.28, 0, 0, Math.PI*2);
      c.fill();
      // Prongs / spikes
      c.fillRect(x + w*0.1, y + h*0.45, 3, 3);
      c.fillRect(x + w*0.87, y + h*0.45, 3, 3);
      // Canopy
      c.fillStyle = s.accent;
      c.fillRect(x + w*0.47, y + h*0.3, 4, 4);
      // Bottom thruster
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.48, y + h*0.70, 5, 4);
    }

    c.restore();
  }
}

/**
 * Lightweight projectile used by both the player and invaders.
 */
class Bullet {
  constructor(x, y, vx, vy, kind) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.w = 4; this.h = 8;
    this.kind = kind; // 'player' | 'enemy'
    this.dead = false;
  }
  /** Updates the bullet position using its velocity. */
  update(dt) { this.x += this.vx*dt; this.y += this.vy*dt; }
  /** Draws the bullet as a simple rectangle. */
  render(c) { c.fillRect(this.x, this.y, this.w, this.h); }
}

/**
 * Short-lived radial outline used to visualize explosions.
 */
class Explosion {
  constructor(x, y) {
    this.x = x; this.y = y; this.t = 0; this.dead = false;
  }
  /** Advances the animation timer and expires the explosion quickly. */
  update(dt) { this.t += dt; if (this.t > 0.35) this.dead = true; }
  /**
   * Renders a fading ring to suggest an energy burst.
   */
  render(c) {
    const r = 6 + this.t * 50;
    const a = Math.max(0, 1 - this.t/0.35);
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = '#ffd65a';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(this.x, this.y, r, 0, Math.PI*2);
    c.stroke();
    c.restore();
  }
}

/**
 * Falling collectible that grants the player a temporary triple shot.
 */
class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type;
    this.w = 20; this.h = 20;
    this.vy = 90 + Math.random()*20;
    this.dead = false;
    this.t = 0;
  }
  /**
   * Moves the power-up downward while tracking a timer for animation.
   */
  update(dt) {
    this.t += dt;
    this.y += this.vy * dt;
  }
  /**
   * Draws a glowing diamond with a lightning bolt icon.
   */
  render(c) {
    c.save();
    // gentle pulsing animation
    const a = 0.8 + 0.2 * Math.sin(this.t*6);
    c.globalAlpha = a;
    // Diamond-shaped tile icon in cyan
    c.translate(this.x + this.w/2, this.y + this.h/2);
    c.rotate(Math.PI/4);
    c.fillStyle = '#5af0ff';
    c.strokeStyle = '#1aa7c4';
    c.lineWidth = 2;
    c.fillRect(-10, -10, 20, 20);
    c.strokeRect(-10, -10, 20, 20);
    c.rotate(-Math.PI/4);
    // small lightning bolt in the center
    c.fillStyle = '#0b0e18';
    c.beginPath();
    const cx = -4, cy = -6;
    c.moveTo(cx, cy);
    c.lineTo(cx+6, cy+2);
    c.lineTo(cx+2, cy+2);
    c.lineTo(cx+8, cy+10);
    c.lineTo(cx-2, cy+4);
    c.lineTo(cx+2, cy+4);
    c.closePath();
    c.fill();
    c.restore();
  }
}

/**
 * Axis-aligned bounding box overlap test.
 */
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Extended overlap test with additional margin
/**
 * Axis-aligned overlap test that expands shapes by an optional margin.
 */
function overlapsWithMargin(a, b, margin = 0) {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function loadInt(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : (parseInt(v, 10) || 0); } catch { return def; }
}
function saveInt(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}
