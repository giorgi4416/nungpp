/** Tiny DOM helpers shared by the UI modules. */
export function el(tag, className = '', html = '') {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Wire hover/click sounds and the callback for a button. */
export function button(btn, audio, onClick) {
  btn.addEventListener('mouseenter', () => audio && audio.uiHover());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    audio && audio.uiClick();
    onClick && onClick(e);
  });
  return btn;
}

export function setVisible(node, v) {
  node.classList.toggle('visible', v);
  node.setAttribute('aria-hidden', v ? 'false' : 'true');
}
