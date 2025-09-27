import { Game } from './modules/game.js';

// Entry point that wires the canvas, UI, and animation loop together.
function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('Canvas #game nicht gefunden. Stelle sicher, dass index.html das <canvas>-Element enthält.');
    return;
  }
  // Acquire the 2D drawing context and instantiate the core game object.
  const ctx = canvas.getContext('2d');
  const game = new Game(canvas, ctx);

  // Hook up the sound toggles so the user can control audio preferences.
  const btnSfx = document.getElementById('btn-sfx');
  const btnMusic = document.getElementById('btn-music');
  const updateButtons = () => {
    if (btnSfx) btnSfx.textContent = `SFX: ${game.audio.enabledSfx ? 'an' : 'aus'}`;
    if (btnMusic) btnMusic.textContent = `Musik: ${game.audio.enabledMusic ? 'an' : 'aus'}`;
  };
  updateButtons();
  btnSfx?.addEventListener('click', () => { game.audio.toggleSfx(); updateButtons(); });
  btnMusic?.addEventListener('click', () => { game.audio.toggleMusic(); updateButtons(); });

  // A first user gesture unlocks audio on many browsers; pre-arm music if enabled.
  if (game.audio.enabledMusic) {
    const tryStart = () => { game.audio.toggleMusic(); game.audio.toggleMusic(); document.removeEventListener('pointerdown', tryStart); document.removeEventListener('keydown', tryStart); };
    document.addEventListener('pointerdown', tryStart, { once: true });
    document.addEventListener('keydown', tryStart, { once: true });
  }

  // Main fixed-timestep animation loop with delta time clamping.
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    game.update(dt);
    game.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// Defer bootstrapping until the DOM is ready so all elements exist.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

