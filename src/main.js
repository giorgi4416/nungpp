import '@fontsource/titillium-web/400.css';
import '@fontsource/titillium-web/600.css';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/900.css';
import '@fontsource/titillium-web/700-italic.css';
import '../styles/main.css';
import { Game } from './core/Game.js';

const loading = document.getElementById('loading-screen');
const fill = document.getElementById('loading-fill');
const status = document.getElementById('loading-status');

function progress(p, text) {
  fill.style.width = `${Math.round(p * 100)}%`;
  if (text) status.textContent = text;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function boot() {
  if (!webglAvailable()) {
    status.textContent = 'WebGL 2 is not available in this browser. Please use a recent Chrome, Edge or Firefox.';
    return;
  }
  const game = new Game(document.getElementById('game-canvas'), document.getElementById('ui-root'));
  // expose for debugging in the console
  window.__HGP__ = game;
  try {
    await game.init(progress);
    loading.classList.remove('visible');
  } catch (err) {
    console.error(err);
    status.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
    fill.style.background = '#e10600';
  }
}

boot();
