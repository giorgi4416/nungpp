/**
 * Live minimap rendered on a 2D canvas from the circuit centreline.
 * The static track image is drawn once to an offscreen canvas; each frame
 * only the car markers are drawn on top.
 */
export class TrackMap {
  constructor(canvas, track, sectorEnds) {
    this.canvas = canvas;
    this.track = track;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.sectorEnds = sectorEnds;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 210;
    const px = Math.round(w * dpr);
    if (px === this.size) return;
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.dpr = dpr;
    const T = this.track;
    const b = T.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const pad = 14 * dpr;
    this.scale = (px - pad * 2) / span;
    this.ox = pad + ((px - pad * 2) - (b.maxX - b.minX) * this.scale) / 2 - b.minX * this.scale;
    this.oz = pad + ((px - pad * 2) - (b.maxZ - b.minZ) * this.scale) / 2 - b.minZ * this.scale;
    // static layer
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = px;
    const g = this.base.getContext('2d');
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= T.count; i += 2) {
        const k = i % T.count;
        const x = this.ox + T.pos[k * 3] * this.scale, y = this.oz + T.pos[k * 3 + 2] * this.scale;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    path();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 9 * dpr;
    g.stroke();
    path();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 4 * dpr;
    g.stroke();
    // sector boundary ticks
    const tick = (s, color, len = 7) => {
      const i = Math.round(T.wrapS(s) / T.ds) % T.count;
      const x = this.ox + T.pos[i * 3] * this.scale, y = this.oz + T.pos[i * 3 + 2] * this.scale;
      const rx = T.right[i * 3], rz = T.right[i * 3 + 2];
      g.strokeStyle = color;
      g.lineWidth = 3 * dpr;
      g.beginPath();
      g.moveTo(x - rx * len * dpr, y - rz * len * dpr);
      g.lineTo(x + rx * len * dpr, y + rz * len * dpr);
      g.stroke();
    };
    for (const s of this.sectorEnds) tick(s, '#ffd21f', 6);
    tick(0, '#e10600', 9);
  }

  /** markers: [{x, z, color, isPlayer}] */
  draw(markers) {
    const g = this.ctx;
    const px = this.size;
    g.clearRect(0, 0, px, px);
    g.drawImage(this.base, 0, 0);
    const dpr = this.dpr;
    // draw AI first, player on top
    for (let pass = 0; pass < 2; pass++) {
      for (const m of markers) {
        if ((pass === 1) !== !!m.isPlayer) continue;
        const x = this.ox + m.x * this.scale, y = this.oz + m.z * this.scale;
        g.beginPath();
        g.arc(x, y, (m.isPlayer ? 6 : 4.5) * dpr, 0, Math.PI * 2);
        g.fillStyle = m.color;
        g.fill();
        g.lineWidth = (m.isPlayer ? 2.5 : 1.5) * dpr;
        g.strokeStyle = m.isPlayer ? '#ffffff' : 'rgba(0,0,0,0.8)';
        g.stroke();
      }
    }
  }
}
