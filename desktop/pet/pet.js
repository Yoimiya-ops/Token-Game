const pet = document.getElementById('pet');
const scene = document.getElementById('scene');
const bubble = document.getElementById('bubble');
const pendingLabel = document.getElementById('pending-label');
const DRAG_THRESHOLD_PX = 4;
const CLICK_DELAY_MS = 500;
let previousState = null;
let animationTimer;
let bubbleTimer;
let clickTimer;
let collecting = false;
let dragOrigin = null;
let justDragged = false;

function burst(empty) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < (empty ? 12 : 26); i++) {
    const particle = document.createElement('span');
    particle.className = 'loot-spark' + (empty ? ' is-empty' : '');
    scene.append(particle);
    const angle = (i / (empty ? 12 : 26)) * Math.PI * 2;
    const distance = 44 + (i % 5) * 14;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance * .65 - 30;
    const effect = particle.animate([
      { transform: 'translate(0,0) scale(0)', opacity: 0 },
      { transform: 'translate(' + x * .4 + 'px,' + y * .4 + 'px) scale(1.2)', opacity: 1, offset: .22 },
      { transform: 'translate(' + x + 'px,' + (y + 30) + 'px) scale(.2) rotate(160deg)', opacity: 0 }
    ], { duration: 1050 + (i % 4) * 80, delay: (i % 3) * 30, easing: 'cubic-bezier(.12,.7,.3,1)' });
    effect.finished.finally(() => particle.remove());
  }
}
function animate(kind, title, subtitle = '') {
  clearTimeout(animationTimer);
  clearTimeout(bubbleTimer);
  scene.classList.remove('is-absorbing', 'is-celebrating', 'is-empty', 'is-tapping');
  void scene.offsetWidth;
  scene.classList.add(kind);
  animationTimer = setTimeout(() => scene.classList.remove(kind), 1800);
  const amount = document.createElement('strong');
  amount.textContent = title;
  const note = document.createElement('small');
  note.textContent = subtitle;
  bubble.replaceChildren(amount, note);
  bubble.className = 'bubble is-visible' + (title.length > 17 ? ' is-long' : '') + (kind === 'is-empty' ? ' is-empty' : '');
  bubbleTimer = setTimeout(() => bubble.classList.remove('is-visible'), 2400);
  if (kind === 'is-celebrating' || kind === 'is-empty') burst(kind === 'is-empty');
}
function celebrate(tokens) {
  animate(tokens ? 'is-celebrating' : 'is-empty', '+' + tokens.toLocaleString() + ' Token', tokens ? '灵气入藏' : '盆中暂无积累');
}
function applyState(state) {
  if (!state) return;
  if (previousState && (state.totalTokens < previousState.totalTokens || state.acknowledgedTokens < previousState.acknowledgedTokens || state.forge.revision < previousState.forge.revision)) return;
  scene.dataset.pending = String(state.pendingTokens > 0);
  pendingLabel.textContent = state.pendingTokens ? state.pendingTokens.toLocaleString() + ' Token 待收取' : '';
  pet.setAttribute('aria-label', '聚宝盆，收取 ' + state.pendingTokens.toLocaleString() + ' Token');
  if (previousState && !collecting) {
    if (state.receipt.revision > previousState.receipt.revision) celebrate(state.receipt.tokens);
    else if (state.totalTokens > previousState.totalTokens && !scene.classList.contains('is-celebrating')) {
      animate('is-absorbing', '灵气汇聚', '+' + (state.totalTokens - previousState.totalTokens).toLocaleString() + ' Token 待收取');
    }
  }
  previousState = state;
}
async function harvest() {
  if (collecting) return;
  collecting = true;
  try {
    const current = await window.tokenPet.getState();
    const result = await window.tokenPet.collect(current.totalTokens);
    applyState(result.state);
    celebrate(result.collectedTokens);
  } catch {
    animate('is-empty', '暂未收取', '请稍后再试');
  } finally { collecting = false; }
}
function openReceipt() {
  clearTimeout(clickTimer);
  scene.classList.remove('is-tapping');
  window.tokenPet.openGame();
}
window.tokenPet.onState(applyState);
window.tokenPet.getState().then(applyState).catch(() => {});
pet.addEventListener('click', event => {
  if (justDragged) { justDragged = false; return; }
  clearTimeout(clickTimer);
  if (event.detail > 1) return;
  scene.classList.remove('is-tapping');
  void scene.offsetWidth;
  scene.classList.add('is-tapping');
  // Give the native double-click gesture time to cancel a single-click harvest.
  clickTimer = setTimeout(() => { void harvest(); }, CLICK_DELAY_MS);
});
pet.addEventListener('dblclick', event => { event.preventDefault(); openReceipt(); });
pet.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); clearTimeout(clickTimer); void harvest(); }
});
window.addEventListener('contextmenu', event => { event.preventDefault(); openReceipt(); });
function endDrag(event) {
  if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) return;
  if (dragOrigin.dragging) {
    justDragged = true;
    window.tokenPet.endDrag();
  }
  dragOrigin = null;
  window.tokenPet.saveBounds();
}
pet.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  justDragged = false;
  pet.setPointerCapture(event.pointerId);
  dragOrigin = {
    pointerId: event.pointerId, mouseScreenX: event.screenX, mouseScreenY: event.screenY,
    windowStartX: window.screenX, windowStartY: window.screenY, dragging: false
  };
});
pet.addEventListener('pointermove', event => {
  if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) return;
  const dx = event.screenX - dragOrigin.mouseScreenX;
  const dy = event.screenY - dragOrigin.mouseScreenY;
  if (!dragOrigin.dragging && dx * dx + dy * dy <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
  clearTimeout(clickTimer);
  scene.classList.remove('is-tapping');
  dragOrigin.dragging = true;
  window.tokenPet.dragTo(dragOrigin.windowStartX + dx, dragOrigin.windowStartY + dy);
});
pet.addEventListener('pointerup', endDrag);
pet.addEventListener('pointercancel', endDrag);
