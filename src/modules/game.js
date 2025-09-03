import { Input } from './input.js';
import { AudioManager } from './audio.js';

export class Game {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.input = new Input();
    this.audio = new AudioManager();

    this.reset();
  }

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
    this.powerupSpawnChance = 0.06; // etwas geringere Chance pro zerstörtem Gegner
  }

  createWave() {
    // Randomisierte, kleine Formation mit Mindestabständen; leichte Skalierung pro Level
    const L = Math.max(0, this.level - 1);
    const invaders = [];
    const extraCluster = Math.min(1, Math.floor(L / 4)); // +1 Cluster ab Level 5
    const clusters = 2 + Math.floor(Math.random() * 2) + extraCluster; // 2..4
    const margin = 20;
    const minSep = 6; // Mindestabstand zwischen Gegnern
    for (let k = 0; k < clusters; k++) {
      const cx = 100 + Math.random() * (this.canvas.width - 200);
      const cy = 30 + Math.random() * 70; // nahe oberen Bereich
      const addPerLevel = Math.min(2, Math.floor(L / 5)); // +0..2 Gegner je Cluster bei höherem Level
      const count = 4 + Math.floor(Math.random() * 3) + addPerLevel; // 4..8 pro Cluster
      for (let i = 0; i < count; i++) {
        // Versuche, eine kollisionsfreie Startposition zu finden
        let tries = 0;
        while (tries++ < 50) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 10 + Math.random() * 28;
          const rx = cx + Math.cos(angle) * radius + (Math.random()*10-5);
          const ry = cy + Math.sin(angle) * radius + (Math.random()*6-3);
          const x = Math.max(margin, Math.min(this.canvas.width - margin - 28, rx));
          const y = Math.max(margin, Math.min(this.canvas.height * 0.33, ry));
          const inv = new Invader(this, x, y, k % 5);
          inv.speedY = 20 + Math.random() * 10 + L * 2.5; // moderates Sinken, skaliert sanft
          inv.homing = 16 + Math.random() * 16 + L * 1.8; // horizontales Nachführen, skaliert sanft
          if (!invaders.some(o => overlapsWithMargin(inv, o, minSep))) {
            invaders.push(inv);
            break;
          }
        }
      }
    }
    return invaders;
  }

  update(dt) {
    // Global input
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

    // Player
    this.player.update(dt);
    if (this.player.powerTimer > 0) this.player.powerTimer -= dt;

    // Player shoot
    if ((this.input.down('Space') || this.input.down('KeyJ')) && this.player.cooldown <= 0) {
      const cx = this.player.x + this.player.w / 2 - 2;
      const y = this.player.y - 8;
      if (this.player.powerTimer > 0) {
        // Triple‑Schuss: drei parallele Schüsse nebeneinander
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

    // Invader logic: alle Gegner bewegen sich nach unten und steuern horizontal auf den Spieler zu
    for (const inv of this.wave) {
      const targetX = this.player.x + this.player.w / 2;
      const centerX = inv.x + inv.w / 2;
      const want = (targetX - centerX) * 0.6; // proportional
      const maxStep = inv.homing * dt;
      const step = Math.max(-maxStep, Math.min(maxStep, want * dt));
      inv.x += step;
      inv.y += inv.speedY * dt;
    }
    // Kollisionsvermeidung zwischen Gegnern (Separation)
    this.separateInvaders();

    // Invader shooting (random alive invader)
    this.shootCooldown -= dt;
    if (this.shootCooldown <= 0 && this.wave.length) {
      const s = this.wave[Math.floor(Math.random() * this.wave.length)];
      this.enemyBullets.push(new Bullet(s.x + s.w / 2 - 2, s.y + s.h + 4, 0, 150 + Math.random()*50, 'enemy'));
      this.shootCooldown = Math.max(0.6, 1.2 - this.level * 0.08);
    }

    // Update entities
    for (const b of this.playerBullets) b.update(dt);
    for (const b of this.enemyBullets) b.update(dt);
    for (const e of this.explosions) e.update(dt);
    for (const p of this.powerups) p.update(dt);

    // Collisions
    // Player bullets vs invaders
    for (const b of this.playerBullets) {
      for (const inv of this.wave) {
        if (!b.dead && aabb(b, inv)) {
          b.dead = true;
          inv.dead = true;
          this.explosions.push(new Explosion(inv.x + inv.w/2, inv.y + inv.h/2));
          this.score += 10 * (this.level);
          this.audio.playExplosion();
          this.checkHighScore?.();
          // Chance auf Power‑up Drop
          if (Math.random() < this.powerupSpawnChance) {
            this.powerups.push(new PowerUp(inv.x + inv.w/2 - 10, inv.y + inv.h/2 - 10, 'triple'));
          }
        }
      }
    }
    this.wave = this.wave.filter(i => !i.dead);

    // Enemy bullets vs player
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

    // Gegner am unteren Rand verschwinden lassen und Leben abziehen
    for (const inv of this.wave) {
      if (!inv.dead && inv.y > this.canvas.height) {
        inv.dead = true;
        this.lives -= 1;
        this.audio?.playHit();
        if (this.lives <= 0) this.state = 'gameover';
      }
    }

    // Power‑ups einsammeln
    for (const p of this.powerups) {
      if (!p.dead && aabb(p, this.player)) {
        p.dead = true;
        this.player.powerTimer = 8.0; // 8 Sekunden Triple‑Schuss
        this.toast = 'Triple‑Schuss aktiviert'; this.toastTime = 1.6;
        this.audio.playPowerUp();
      }
    }

    // Cleanup bullets/explosions/powerups
    this.playerBullets = this.playerBullets.filter(b => !b.dead && b.y > -20);
    this.enemyBullets = this.enemyBullets.filter(b => !b.dead && b.y < this.canvas.height + 20);
    this.explosions = this.explosions.filter(e => !e.dead);
    this.powerups = this.powerups.filter(p => !p.dead && p.y < this.canvas.height + 24);

    // Wave cleared -> next level
    if (!this.wave.length) {
      // Applaus für Levelabschluss und 1 Leben als Belohnung
      this.audio?.playLevelComplete();
      this.lives += 1;
      this.toast = '+1 Leben'; this.toastTime = 1.5;

      this.level += 1;
      // Vorbereitete (aber aktuell ungenutzte) alte Parameter leicht anheben
      this.invaderSpeed += 6;
      this.dropStep += 2;
      this.wave = this.createWave();
      // Kurzer Startjingle für neues Level
      this.audio?.playLevelStart();
    }
  }

  getFrontInvaders() {
    // Nicht mehr benötigt (Formation ist zufällig), aber Rückwärtskompatibilität:
    return this.wave.slice();
  }

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

    // Player
    this.player.render(c);

    // Invaders
    for (const inv of this.wave) inv.render(c);

    // Bullets
    c.fillStyle = '#ffd65a';
    for (const b of this.playerBullets) b.render(c);
    c.fillStyle = '#ff6a6a';
    for (const b of this.enemyBullets) b.render(c);

    // Explosions
    for (const e of this.explosions) e.render(c);
    // Powerups
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

    // Toast (UI Hinweis unten rechts)
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

// Kleine Hilfsroutine zur Gegner-Separation, um Überlappungen zu vermeiden
Game.prototype.separateInvaders = function() {
  const items = this.wave;
  const margin = 2; // minimaler Puffer
  const maxIterations = 2;
  const leftBound = 20, rightBound = this.canvas.width - 20;
  for (let iter = 0; iter < maxIterations; iter++) {
    for (let i = 0; i < items.length; i++) {
      const a = items[i]; if (a.dead) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]; if (b.dead) continue;
        if (overlapsWithMargin(a, b, margin)) {
          // berechne minimale Verschiebung entlang der kleineren Achse
          const dx1 = (b.x + b.w + margin) - a.x;        // b rechts überlappt links von a
          const dx2 = (a.x + a.w + margin) - b.x;        // a rechts überlappt links von b
          const dy1 = (b.y + b.h + margin) - a.y;
          const dy2 = (a.y + a.h + margin) - b.y;
          const penX = Math.min(dx1, dx2);
          const penY = Math.min(dy1, dy2);
          if (penX < penY) {
            // horizontal auseinander schieben
            const push = penX / 2;
            if (a.x < b.x) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
          } else {
            // vertikal minimal auseinander (kleiner Wert, damit Fallgeschwindigkeit kaum beeinflusst)
            const push = Math.min(2, penY / 2);
            if (a.y < b.y) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
          }
          // Grenzen einhalten
          a.x = Math.max(leftBound, Math.min(rightBound - a.w, a.x));
          b.x = Math.max(leftBound, Math.min(rightBound - b.w, b.x));
        }
      }
    }
  }
};

// Highscore speichern/anzeigen
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

class Player {
  constructor(game) {
    this.game = game;
    this.w = 42; this.h = 20;
    this.x = game.canvas.width/2 - this.w/2;
    this.y = game.canvas.height - 70;
    this.speed = 260;
    this.cooldown = 0;
    this.invuln = 0;
    this.powerTimer = 0; // Triple‑Schuss aktiv für >0
  }
  update(dt) {
    const g = this.game;
    let dir = 0;
    if (g.input.down('ArrowLeft') || g.input.down('KeyA')) dir -= 1;
    if (g.input.down('ArrowRight') || g.input.down('KeyD')) dir += 1;
    this.x += dir * this.speed * dt;
    this.x = Math.max(20, Math.min(g.canvas.width - this.w - 20, this.x));
    if (this.invuln > 0) this.invuln -= dt;
  }
  render(c) {
    c.save();
    if (this.invuln > 0) c.globalAlpha = 0.5 + 0.5*Math.sin(this.game.time*20);

    const cx = this.x + this.w/2;
    const cy = this.y + this.h/2 + 2;

    // Saucer (Untertassensektion)
    c.fillStyle = '#bfe3ff';
    c.strokeStyle = '#6aa9d8';
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(cx, cy, this.w*0.38, this.h*0.55, 0, 0, Math.PI*2);
    c.fill();
    c.stroke();

    // Brückendom
    c.beginPath();
    c.fillStyle = '#e9f6ff';
    c.arc(cx, cy - this.h*0.25, 3.5, 0, Math.PI*2);
    c.fill();

    // Pylone zu den Gondeln
    c.fillStyle = '#a9d5f5';
    c.fillRect(cx - this.w*0.42, cy + 1, this.w*0.22, 2);
    c.fillRect(cx + this.w*0.20, cy + 1, this.w*0.22, 2);

    // Warp-Gondeln links/rechts
    c.fillStyle = '#9fd0f3';
    const gondelW = this.w*0.25, gondelH = 6;
    // links
    c.fillRect(cx - this.w*0.62, cy - gondelH/2, gondelW, gondelH);
    c.fillStyle = '#ff6a6a';
    c.fillRect(cx - this.w*0.62 - 3, cy - gondelH/2, 3, gondelH); // roter Tipp
    // rechts
    c.fillStyle = '#9fd0f3';
    c.fillRect(cx + this.w*0.37, cy - gondelH/2, gondelW, gondelH);
    c.fillStyle = '#ff6a6a';
    c.fillRect(cx + this.w*0.37 + gondelW, cy - gondelH/2, 3, gondelH);

    // Deflektor-Dish vorne (unter Saucer)
    c.fillStyle = '#ffd65a';
    c.beginPath();
    c.arc(cx, cy + this.h*0.35, 3, 0, Math.PI*2);
    c.fill();

    c.restore();
  }
}

class Invader {
  constructor(game, x, y, row) {
    this.game = game;
    this.x = x; this.y = y;
    this.w = 28; this.h = 18;
    this.row = row;
    this.dead = false;
    // Visuelle Varianz: 0=Fighter, 1=Cruiser, 2=Scout
    this.kind = Math.floor(Math.random() * 3);
  }
  render(c) {
    const t = this.game.time;
    const flicker = 0.6 + 0.4 * Math.sin(t * 20 + (this.x + this.y) * 0.05);
    const schemes = [
      { body: '#ff7979', accent: '#ffd1a1', engine: '#ffb74d' }, // Fighter – rot/orange
      { body: '#b47cff', accent: '#e3c7ff', engine: '#c59eff' }, // Cruiser – violett
      { body: '#6ee7ff', accent: '#c7f8ff', engine: '#86efff' }, // Scout – cyan
    ];
    const s = schemes[this.kind % schemes.length];

    const x = this.x, y = this.y, w = this.w, h = this.h;
    c.save();
    // Körper
    c.fillStyle = s.body;

    if (this.kind === 0) {
      // Fighter: spitze Nase, kurze Flügel, zwei Triebwerke
      c.beginPath();
      c.moveTo(x + w*0.5, y);            // Nase
      c.lineTo(x + w*0.9, y + h*0.45);   // rechter Rumpf
      c.lineTo(x + w*0.7, y + h*0.55);
      c.lineTo(x + w*0.7, y + h*0.8);
      c.lineTo(x + w*0.3, y + h*0.8);
      c.lineTo(x + w*0.3, y + h*0.55);
      c.lineTo(x + w*0.1, y + h*0.45);   // linker Rumpf
      c.closePath();
      c.fill();

      // Flügel
      c.fillRect(x + w*0.05, y + h*0.5, w*0.25, 3);
      c.fillRect(x + w*0.70, y + h*0.5, w*0.25, 3);

      // Cockpit
      c.fillStyle = s.accent;
      c.fillRect(x + w*0.45, y + h*0.2, w*0.10, h*0.18);

      // Triebwerksglut
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.34, y + h*0.80, 4, 4);
      c.fillRect(x + w*0.62, y + h*0.80, 4, 4);
    } else if (this.kind === 1) {
      // Cruiser: breiter Rumpf, seitliche Kanzeln, drei Triebwerke
      c.fillRect(x + w*0.18, y + h*0.15, w*0.64, h*0.55);
      // Nase/Cockpit-Kuppel
      c.fillStyle = s.accent;
      c.beginPath();
      c.arc(x + w*0.5, y + h*0.18, 3, 0, Math.PI*2);
      c.fill();
      // Seitenflügel
      c.fillStyle = s.body;
      c.fillRect(x,           y + h*0.40, w*0.2, 3);
      c.fillRect(x + w*0.80,  y + h*0.40, w*0.2, 3);
      // Triebwerke
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.30, y + h*0.70, 4, 4);
      c.fillRect(x + w*0.48, y + h*0.70, 4, 4);
      c.fillRect(x + w*0.66, y + h*0.70, 4, 4);
    } else {
      // Scout: kleine Untertasse mit Zinken
      c.beginPath();
      c.ellipse(x + w*0.5, y + h*0.45, w*0.32, h*0.28, 0, 0, Math.PI*2);
      c.fill();
      // Zinken / Spikes
      c.fillRect(x + w*0.1, y + h*0.45, 3, 3);
      c.fillRect(x + w*0.87, y + h*0.45, 3, 3);
      // Kanzel
      c.fillStyle = s.accent;
      c.fillRect(x + w*0.47, y + h*0.3, 4, 4);
      // Triebwerk unten
      c.globalAlpha = flicker;
      c.fillStyle = s.engine;
      c.fillRect(x + w*0.48, y + h*0.70, 5, 4);
    }

    c.restore();
  }
}

class Bullet {
  constructor(x, y, vx, vy, kind) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.w = 4; this.h = 8;
    this.kind = kind; // 'player' | 'enemy'
    this.dead = false;
  }
  update(dt) { this.x += this.vx*dt; this.y += this.vy*dt; }
  render(c) { c.fillRect(this.x, this.y, this.w, this.h); }
}

class Explosion {
  constructor(x, y) {
    this.x = x; this.y = y; this.t = 0; this.dead = false;
  }
  update(dt) { this.t += dt; if (this.t > 0.35) this.dead = true; }
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

class PowerUp {
  constructor(x, y, type) {
    this.x = x; this.y = y; this.type = type;
    this.w = 20; this.h = 20;
    this.vy = 90 + Math.random()*20;
    this.dead = false;
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    this.y += this.vy * dt;
  }
  render(c) {
    c.save();
    // sanftes Pulsieren
    const a = 0.8 + 0.2 * Math.sin(this.t*6);
    c.globalAlpha = a;
    // Kachel-Icon (Diamant) in Cyan
    c.translate(this.x + this.w/2, this.y + this.h/2);
    c.rotate(Math.PI/4);
    c.fillStyle = '#5af0ff';
    c.strokeStyle = '#1aa7c4';
    c.lineWidth = 2;
    c.fillRect(-10, -10, 20, 20);
    c.strokeRect(-10, -10, 20, 20);
    c.rotate(-Math.PI/4);
    // kleines Blitzsymbol in der Mitte
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

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Erweiterte Überlappungsprüfung mit zusätzlichem Rand
function overlapsWithMargin(a, b, margin = 0) {
  return a.x < b.x + b.w + margin && a.x + a.w + margin > b.x && a.y < b.y + b.h + margin && a.y + a.h + margin > b.y;
}

function loadInt(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : (parseInt(v, 10) || 0); } catch { return def; }
}
function saveInt(key, val) {
  try { localStorage.setItem(key, String(val)); } catch {}
}
