/**
 * Tracks keyboard state, exposing helper methods for pressed/down/released queries.
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    // Prevent the browser from scrolling when the primary movement keys are used.
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    }, { passive: false });
    // Remember when a key is released so one-frame transitions can be queried.
    window.addEventListener('keyup', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      this.keys.delete(code);
      this.released.add(code);
    });
  }
  /** Clears per-frame pressed/released sets; call once per tick. */
  update() {
    this.pressed.clear();
    this.released.clear();
  }
  /** Returns true while the key is held down. */
  down(code) { return this.keys.has(code); }
  /** Returns true only on the frame the key became pressed. */
  justPressed(code) { return this.pressed.has(code); }
  /** Returns true only on the frame the key was released. */
  justReleased(code) { return this.released.has(code); }
}
