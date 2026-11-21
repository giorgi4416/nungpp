/**
 * Mouse camera controls on the 3D view: hold & drag (left or right button) to
 * orbit the external cameras or turn your head in the cockpit, scroll to zoom,
 * double-click to reset. Only the canvas listens, so the HUD and menus and the
 * keyboard driving controls are never affected.
 */
export class CameraInput {
  constructor(canvas, cams, getSensitivity) {
    this.canvas = canvas;
    this.cams = cams;
    this.getSensitivity = getSensitivity;
    this.dragging = false;
    this.last = { x: 0, y: 0 };
    this._down = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this.last.x = e.clientX;
      this.last.y = e.clientY;
      canvas.setPointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    this._move = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last.x = e.clientX;
      this.last.y = e.clientY;
      this.cams.sensitivity = this.getSensitivity();
      this.cams.lookInput(dx, dy);
    };
    this._up = (e) => {
      this.dragging = false;
      canvas.releasePointerCapture?.(e.pointerId);
      canvas.style.cursor = 'grab';
    };
    this._wheel = (e) => {
      e.preventDefault();
      this.cams.zoomInput(e.deltaY);
    };
    this._dbl = () => this.cams.resetLook();
    this._ctx = (e) => e.preventDefault();
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', this._down);
    canvas.addEventListener('pointermove', this._move);
    canvas.addEventListener('pointerup', this._up);
    canvas.addEventListener('pointercancel', this._up);
    canvas.addEventListener('wheel', this._wheel, { passive: false });
    canvas.addEventListener('dblclick', this._dbl);
    canvas.addEventListener('contextmenu', this._ctx);
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down);
    c.removeEventListener('pointermove', this._move);
    c.removeEventListener('pointerup', this._up);
    c.removeEventListener('pointercancel', this._up);
    c.removeEventListener('wheel', this._wheel);
    c.removeEventListener('dblclick', this._dbl);
    c.removeEventListener('contextmenu', this._ctx);
  }
}
