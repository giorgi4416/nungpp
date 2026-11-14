import * as THREE from 'three';

/**
 * Procedural CanvasTextures. Nothing is downloaded, so the game is fully
 * self-contained and works offline. Textures are cached and shared.
 */

const cache = new Map();
let maxAniso = 8;

export function setMaxAnisotropy(a) {
  maxAniso = a;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = true, srgb = true, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (aniso) t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

// deterministic random for repeatable textures
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function speckle(ctx, w, h, count, colors, sizeMin, sizeMax, seed) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = sizeMin + r() * (sizeMax - sizeMin);
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/** Asphalt with baked white edge lines. u across width (0..1), v along track. */
export function asphaltTexture() {
  return cached('asphalt', () => {
    const W = 1024, H = 1024;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#3a3a3c';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 70000, ['#353537', '#404042', '#323234', '#444446', '#3c3c3e'], 1, 3, 7);
    speckle(g, W, H, 1800, ['#4c4c4f', '#2c2c2e'], 1, 3, 11);
    // rubbered-in racing line darkening (centre-ish band, varies across)
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0.0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.3, 'rgba(10,10,12,0.18)');
    grd.addColorStop(0.5, 'rgba(10,10,12,0.26)');
    grd.addColorStop(0.7, 'rgba(10,10,12,0.18)');
    grd.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // subtle longitudinal streaks
    const r = rng(3);
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,20,22' : '80,80,86'},${0.04 + r() * 0.05})`;
      g.fillRect(r() * W, 0, 1 + r() * 3, H);
    }
    // patch repairs
    for (let i = 0; i < 3; i++) {
      g.fillStyle = 'rgba(30,30,32,0.16)';
      g.fillRect(150 + r() * 700, r() * H, 60 + r() * 120, 40 + r() * 160);
    }
    // edge lines
    g.fillStyle = '#eeeeea';
    g.fillRect(W * 0.006, 0, W * 0.016, H);
    g.fillRect(W * (1 - 0.022), 0, W * 0.016, H);
    // worn line grain
    speckle(g, W * 0.03, H, 1500, ['rgba(60,60,64,0.6)'], 1, 3, 21);
    g.save();
    g.translate(W * 0.97, 0);
    speckle(g, W * 0.03, H, 1500, ['rgba(60,60,64,0.6)'], 1, 3, 22);
    g.restore();
    return finish(c);
  });
}

/** Height/bump detail for asphalt. */
export function asphaltBump() {
  return cached('asphaltBump', () => {
    const W = 512, H = 512;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#808080';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 40000, ['#6a6a6a', '#9a9a9a', '#5a5a5a', '#a8a8a8'], 1, 2, 5);
    return finish(c, { srgb: false });
  });
}

export function grassTexture() {
  return cached('grass', () => {
    const W = 512, H = 512;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#4f7a2c';
    g.fillRect(0, 0, W, H);
    const r = rng(9);
    for (let i = 0; i < 26000; i++) {
      const x = r() * W, y = r() * H;
      const l = 30 + r() * 24;
      g.strokeStyle = `hsla(${88 + r() * 22}, ${45 + r() * 20}%, ${l}%, 0.55)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 5);
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '40,60,20' : '110,140,60'},0.08)`;
      g.beginPath();
      g.arc(r() * W, r() * H, 20 + r() * 50, 0, Math.PI * 2);
      g.fill();
    }
    return finish(c);
  });
}

export function gravelTexture() {
  return cached('gravel', () => {
    const W = 512, H = 512;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#b4a382';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 50000, ['#9c8b6b', '#c8b896', '#8a7a5d', '#d6c8a8', '#a59474', '#7b6d55'], 1, 4, 13);
    return finish(c);
  });
}

/** Red/white kerb stripes along v. */
export function kerbTexture() {
  return cached('kerb', () => {
    const W = 64, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    for (let i = 0; i < 2; i++) {
      g.fillStyle = i ? '#f2f2f0' : '#d4141a';
      g.fillRect(0, i * H / 2, W, H / 2);
    }
    // ridges
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(x, 0, 2, H);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(W - 4, 0, 4, H);
    return finish(c);
  });
}

export function carbonTexture() {
  return cached('carbon', () => {
    const W = 128, H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#16171a';
    g.fillRect(0, 0, W, H);
    const s = 8;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      const odd = ((x + y) / s) % 2 === 0;
      const grd = odd ? g.createLinearGradient(x, y, x + s, y) : g.createLinearGradient(x, y, x, y + s);
      grd.addColorStop(0, '#111215');
      grd.addColorStop(0.5, '#2b2d33');
      grd.addColorStop(1, '#111215');
      g.fillStyle = grd;
      g.fillRect(x, y, s - 1, s - 1);
    }
    const t = finish(c);
    t.repeat.set(6, 6);
    return t;
  });
}

/** Barrier band: alternating sponsor-style blocks (fictional brands). */
export function barrierTexture() {
  return cached('barrier', () => {
    const W = 1024, H = 64;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const blocks = [
      ['#e10600', '#ffffff', 'APEX OIL'],
      ['#ffffff', '#e10600', ''],
      ['#0f2a5f', '#ffffff', 'NORDLINE'],
      ['#ffffff', '#0f2a5f', ''],
    ];
    const bw = W / blocks.length;
    blocks.forEach(([bg, fg, txt], i) => {
      g.fillStyle = bg;
      g.fillRect(i * bw, 0, bw, H);
      if (txt) {
        g.fillStyle = fg;
        g.font = 'italic 900 34px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(txt, i * bw + bw / 2, H / 2 + 2);
      }
    });
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, H - 6, W, 6);
    return finish(c);
  });
}

export function concreteTexture() {
  return cached('concrete', () => {
    const W = 256, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#b9bab6';
    g.fillRect(0, 0, W, H);
    speckle(g, W, H, 9000, ['#a9aaa6', '#c7c8c4', '#9c9d99'], 1, 3, 31);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 0, 3, H);
    return finish(c);
  });
}

/** Catch fence (alpha). */
export function fenceTexture() {
  return cached('fence', () => {
    const W = 128, H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(200,205,210,0.9)';
    g.lineWidth = 2;
    for (let i = -W; i < W * 2; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + H, H); g.stroke();
      g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.stroke();
    }
    g.fillStyle = 'rgba(120,125,130,1)';
    g.fillRect(0, 0, 6, H);
    g.fillRect(0, 0, W, 4);
    return finish(c, { srgb: true });
  });
}

/** Chequered start/finish strip. */
export function checkerTexture() {
  return cached('checker', () => {
    const W = 256, H = 64;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const s = 16;
    for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) {
      g.fillStyle = ((x + y) / s) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x, y, s, s);
    }
    return finish(c);
  });
}

/** Billboard / sign texture with text. */
export function signTexture(text, { bg = '#e10600', fg = '#ffffff', sub = '', w = 512, h = 128, italic = true, border = null } = {}) {
  return cached(`sign:${text}:${bg}:${fg}:${sub}:${w}:${h}`, () => {
    const c = canvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = h * 0.06;
      g.strokeRect(0, 0, w, h);
    }
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = sub ? h * 0.46 : h * 0.62;
    g.font = `${italic ? 'italic ' : ''}900 ${size}px Arial, sans-serif`;
    let tw = g.measureText(text).width;
    if (tw > w * 0.9) g.font = `${italic ? 'italic ' : ''}900 ${(size * w * 0.9) / tw}px Arial, sans-serif`;
    g.fillText(text, w / 2, sub ? h * 0.4 : h / 2 + h * 0.03);
    if (sub) {
      g.font = `700 ${h * 0.2}px Arial, sans-serif`;
      g.globalAlpha = 0.85;
      g.fillText(sub, w / 2, h * 0.78);
    }
    return finish(c, { repeat: false });
  });
}

/** Car racing number decal (transparent background). */
export function numberTexture(num, color = '#ffffff', outline = '#000000') {
  return cached(`num:${num}:${color}:${outline}`, () => {
    const c = canvas(256, 256);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.font = 'italic 900 190px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 14;
    g.strokeStyle = outline;
    g.strokeText(String(num), 128, 136);
    g.fillStyle = color;
    g.fillText(String(num), 128, 136);
    return finish(c, { repeat: false });
  });
}

/** Livery decal on sidepod/engine cover: team name. */
export function liveryTextTexture(text, color = '#ffffff') {
  return cached(`liv:${text}:${color}`, () => {
    const c = canvas(512, 128);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 512, 128);
    let size = 78;
    g.font = `italic 900 ${size}px Arial, sans-serif`;
    const w = g.measureText(text).width;
    if (w > 480) { size = Math.floor((size * 480) / w); g.font = `italic 900 ${size}px Arial, sans-serif`; }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(text, 256, 68);
    return finish(c, { repeat: false });
  });
}

/** Garage frontage: doors + team boards. */
export function garageTexture() {
  return cached('garage', () => {
    const W = 1024, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#e8e9eb';
    g.fillRect(0, 0, W, H);
    const n = 4;
    const colors = ['#e10600', '#0e8f8a', '#ff7a00', '#3a3d9f'];
    for (let i = 0; i < n; i++) {
      const x = i * (W / n) + 18, w = W / n - 36;
      g.fillStyle = '#1b1c20';
      g.fillRect(x, 70, w, H - 70);
      // interior glow
      const grd = g.createLinearGradient(0, 70, 0, H);
      grd.addColorStop(0, 'rgba(255,255,255,0.18)');
      grd.addColorStop(1, 'rgba(255,255,255,0.02)');
      g.fillStyle = grd;
      g.fillRect(x, 70, w, H - 70);
      g.fillStyle = colors[i % colors.length];
      g.fillRect(x, 26, w, 34);
    }
    g.fillStyle = '#9a9ca1';
    g.fillRect(0, 0, W, 12);
    return finish(c);
  });
}

/** Building windows facade. */
export function facadeTexture() {
  return cached('facade', () => {
    const W = 512, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#d9dade';
    g.fillRect(0, 0, W, H);
    for (let y = 20; y < H - 20; y += 60) {
      const grd = g.createLinearGradient(0, y, 0, y + 40);
      grd.addColorStop(0, '#3d5671');
      grd.addColorStop(1, '#1b2735');
      g.fillStyle = grd;
      g.fillRect(0, y, W, 40);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let x = 0; x < W; x += 64) g.fillRect(x, y, 3, 40);
    }
    return finish(c);
  });
}

/** Grandstand seat rows (colored seats). */
export function seatsTexture() {
  return cached('seats', () => {
    const W = 256, H = 64;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#2a64b8';
    g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x, 0, 2, H);
    }
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(0, 0, W, 6);
    return finish(c);
  });
}

/** Soft round particle sprite. */
export function smokeSprite() {
  return cached('smoke', () => {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return finish(c, { repeat: false, srgb: false });
  });
}

/** Flag texture. */
export function flagTexture(colors) {
  return cached('flag:' + colors.join(), () => {
    const c = canvas(128, 80);
    const g = c.getContext('2d');
    colors.forEach((col, i) => {
      g.fillStyle = col;
      g.fillRect(0, (i * 80) / colors.length, 128, 80 / colors.length + 1);
    });
    return finish(c, { repeat: false });
  });
}

/** Tree crown leaf texture (subtle variation). */
export function foliageTexture() {
  return cached('foliage', () => {
    const W = 256, H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const r = rng(17);
    for (let i = 0; i < 3500; i++) {
      const l = 55 + r() * 45;
      g.fillStyle = `hsl(0,0%,${l}%)`;
      g.beginPath();
      g.arc(r() * W, r() * H, 2 + r() * 5, 0, Math.PI * 2);
      g.fill();
    }
    return finish(c, { srgb: true });
  });
}
