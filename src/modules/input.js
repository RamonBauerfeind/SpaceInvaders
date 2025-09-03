export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();
      const code = e.code === 'Space' ? 'Space' : e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    }, { passive: false });
    window.addEventListener('keyup', (e) => {
      const code = e.code === 'Space' ? 'Space' : e.code;
      this.keys.delete(code);
      this.released.add(code);
    });
  }
  update() {
    this.pressed.clear();
    this.released.clear();
  }
  down(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressed.has(code); }
  justReleased(code) { return this.released.has(code); }
}

