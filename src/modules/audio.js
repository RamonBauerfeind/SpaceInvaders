/**
 * Central audio controller that wraps Web Audio for effects and an <audio> element for music.
 * Persists the user's toggles in localStorage so preferences survive reloads.
 */
export class AudioManager {
  constructor() {
    this.enabledSfx = loadBool('sfxEnabled', true);
    this.enabledMusic = loadBool('musicEnabled', false);

    this.ctx = null; // Lazy init on first user gesture
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;

    this.music = null; // HTMLAudioElement for compatibility
    this._userInteracted = false;

    // Listen for the first pointer/keyboard interaction to unlock autoplay-restricted contexts.
    const unlock = () => { this._userInteracted = true; this._ensureContext(); document.removeEventListener('pointerdown', unlock); document.removeEventListener('keydown', unlock); };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }

  /** Ensures the Web Audio graph exists so sound can be played. */
  _ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this._applyGains();
  }

  /** Applies persisted volume settings to the gain nodes. */
  _applyGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sfxVol = this.enabledSfx ? 1.0 : 0.0;
    const musicVol = this.enabledMusic ? 0.6 : 0.0;
    this.sfxGain.gain.setTargetAtTime(sfxVol, t, 0.02);
    this.musicGain.gain.setTargetAtTime(musicVol, t, 0.1);
  }

  /** Toggles sound effects and returns the new enabled state. */
  toggleSfx() {
    this.enabledSfx = !this.enabledSfx;
    saveBool('sfxEnabled', this.enabledSfx);
    this._ensureContext();
    this._applyGains();
    return this.enabledSfx;
  }

  /** Toggles background music playback and returns the new enabled state. */
  toggleMusic() {
    this.enabledMusic = !this.enabledMusic;
    saveBool('musicEnabled', this.enabledMusic);
    this._ensureContext();
    this._applyGains();
    if (this.enabledMusic) this._startMusic(); else this._stopMusic();
    return this.enabledMusic;
  }

  // --- SFX ---

  /** Plays the retro-inspired player laser shot. */
  playShoot() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 520;
    o.connect(g); g.connect(this.sfxGain);
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.10);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.start(); o.stop(t + 0.15);
  }

  /** Emits a noisy burst for destroyed invaders. */
  playExplosion() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const bufferSize = 0.25 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = this.ctx.createBufferSource(); noise.buffer = buffer; noise.loop = false;
    const filter = this.ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 800;
    const g = this.ctx.createGain();
    noise.connect(filter); filter.connect(g); g.connect(this.sfxGain);
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    noise.start(); noise.stop(t + 0.35);
  }

  /** Subtle hit cue when the player loses a life. */
  playHit() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.connect(g); g.connect(this.sfxGain);
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.12);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.start(); o.stop(t + 0.15);
  }

  /** Cheerful arpeggio that plays after collecting a power-up. */
  playPowerUp() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // Short ascending arpeggio to emphasize the reward.
    const seq = [659.25, 880.0, 987.77]; // E5, A5, B5
    seq.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(g); g.connect(this.sfxGain);
      const t = t0 + i * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
  }

  /** Quick triad fanfare when a new level begins. */
  playLevelStart() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    const t0 = this.ctx.currentTime;
    notes.forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.connect(g); g.connect(this.sfxGain);
      const t = t0 + i * 0.12;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.start(t); o.stop(t + 0.24);
    });
  }

  /** Crowd-like celebration when an entire wave has been cleared. */
  playLevelComplete() {
    if (!this.enabledSfx) return;
    this._ensureContext();
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    // Base crowd noise tail for ambiance.
    const tail = this._makeNoiseSource(0.9);
    const tailFilter = this.ctx.createBiquadFilter();
    tailFilter.type = 'bandpass';
    tailFilter.frequency.value = 1200;
    tailFilter.Q.value = 0.7;
    const tailGain = this.ctx.createGain();
    tail.connect(tailFilter); tailFilter.connect(tailGain); tailGain.connect(this.sfxGain);
    tailGain.gain.setValueAtTime(0.0001, t0);
    tailGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.06);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    tail.start(t0); tail.stop(t0 + 0.95);
    // Discrete claps (short noise bursts).
    const bursts = 22;
    for (let i = 0; i < bursts; i++) {
      const start = t0 + Math.random() * 0.7;
      const src = this._makeNoiseSource(0.12);
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
      const g = this.ctx.createGain();
      src.connect(hp); hp.connect(g); g.connect(this.sfxGain);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.5 + Math.random()*0.3, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.10 + Math.random()*0.05);
      src.start(start); src.stop(start + 0.15);
    }
  }

  /** Convenience helper for generating random noise buffers. */
  _makeNoiseSource(seconds) {
    const len = Math.max(1, Math.floor(seconds * this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random()*2-1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer; src.loop = false;
    return src;
  }

  // --- MUSIC ---

  /** Lazily creates the <audio> element used for looping background music. */
  _ensureMusicElement() {
    if (this.music) return;
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    // Try multiple common formats; user must provide file(s).
    // Place your file in assets/imperial_march.mp3 or .ogg
    el.src = pickFirstAvailable([
      'assets/imperial_march.mp3',
      'assets/imperial_march.ogg'
    ]);
    // Route through WebAudio so we can control volume consistently.
    try {
      this._ensureContext();
      if (this.ctx && this.ctx.createMediaElementSource) {
        const src = this.ctx.createMediaElementSource(el);
        src.connect(this.musicGain);
      }
    } catch (e) {
      // Creating a second MediaElementSource throws; ignore and continue.
    }
    this.music = el;
  }

  /** Attempts to start music playback, respecting autoplay restrictions. */
  async _startMusic() {
    this._ensureMusicElement();
    if (!this.music) return;
    try {
      await this.music.play();
    } catch (err) {
      // Autoplay was blocked or no file is available.
      console.warn('Music playback failed. Ensure an audio file exists in assets/ and that a user gesture has occurred.', err);
    }
  }

  /** Stops background music playback without destroying the element. */
  _stopMusic() {
    if (this.music) {
      this.music.pause();
    }
  }
}

function loadBool(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; } catch { return def; }
}
function saveBool(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch {}
}
/** Returns the first candidate path. Swap in availability checks if desired. */
function pickFirstAvailable(list) { return list[0]; }
