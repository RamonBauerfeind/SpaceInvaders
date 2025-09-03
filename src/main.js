import { Game } from './modules/game.js';

function boot() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('Canvas #game nicht gefunden. Stelle sicher, dass index.html das <canvas>-Element enthält.');
    return;
  }
  const ctx = canvas.getContext('2d');
  const game = new Game(canvas, ctx);

  // Wire UI buttons
  const btnSfx = document.getElementById('btn-sfx');
  const btnMusic = document.getElementById('btn-music');
  const updateButtons = () => {
    if (btnSfx) btnSfx.textContent = `SFX: ${game.audio.enabledSfx ? 'an' : 'aus'}`;
    if (btnMusic) btnMusic.textContent = `Musik: ${game.audio.enabledMusic ? 'an' : 'aus'}`;
  };
  updateButtons();
  btnSfx?.addEventListener('click', () => { game.audio.toggleSfx(); updateButtons(); });
  btnMusic?.addEventListener('click', () => { game.audio.toggleMusic(); updateButtons(); });

  // First user gesture will unlock audio automatically; if music is enabled from storage, try starting it
  if (game.audio.enabledMusic) {
    const tryStart = () => { game.audio.toggleMusic(); game.audio.toggleMusic(); document.removeEventListener('pointerdown', tryStart); document.removeEventListener('keydown', tryStart); };
    document.addEventListener('pointerdown', tryStart, { once: true });
    document.addEventListener('keydown', tryStart, { once: true });
  }

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

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
