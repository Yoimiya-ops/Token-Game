const pet = document.getElementById('pet');
const cat = document.getElementById('cat');
const bubble = document.getElementById('bubble');
const petImage = document.getElementById('pet-image');
const messages = ['喵，Token 消化中...', '+1 摸摸', '双击我进入游戏', '今天也要好好喂猫'];
const DRAG_THRESHOLD_PX = 4;
let clickTimer;
let messageIndex = 0;
let dragOrigin = null;
let justDragged = false;

function applyAsset(asset) {
  const isImage = asset?.kind === 'image';
  pet.dataset.petKind = isImage ? 'image' : 'css';
  pet.dataset.petId = asset?.id ?? 'default-cat';
  petImage.src = isImage ? asset.src : '';
  petImage.alt = asset?.label ?? '桌宠';
}

window.tokenPet.getAsset().then(applyAsset);
window.tokenPet.onAssetChanged(applyAsset);

// React to "立刻入账" results emitted by the main process. We
// hijack the existing #bubble for the feedback so we don't have
// to add a new DOM node.
window.tokenPet.onTokenRefreshed((result) => {
  if (!result) return;
  let text;
  if (result.ok) {
    const qi = result.qiGained ?? 0;
    const tokens = result.totalTokens ?? 0;
    text = `已入账 +${qi} 灵气 · 共 ${tokens.toLocaleString()} token`;
  } else if (result.reason === 'rate_limited') {
    const retry = Math.ceil((result.retryAfterMs ?? 5000) / 1000);
    text = `手太快了，${retry} 秒后再点`;
  } else {
    text = result.message || '刷新失败';
  }
  bubble.textContent = text;
  bubble.classList.add('is-visible');
  window.setTimeout(() => {
    bubble.classList.remove('is-visible');
  }, 2400);
});

function showInteraction() {
  window.tokenPet.interact();
  const activePet = pet.dataset.petKind === 'image' ? petImage : cat;
  activePet.classList.remove('is-happy');
  void activePet.offsetWidth;
  activePet.classList.add('is-happy');
  bubble.textContent = messages[messageIndex % messages.length];
  messageIndex += 1;
  bubble.classList.add('is-visible');
  window.setTimeout(() => {
    bubble.classList.remove('is-visible');
  }, 1400);
}

pet.addEventListener('click', () => {
  if (justDragged) {
    justDragged = false;
    return;
  }
  if (clickTimer) {
    window.clearTimeout(clickTimer);
    clickTimer = undefined;
    window.tokenPet.openGame();
    return;
  }

  clickTimer = window.setTimeout(() => {
    clickTimer = undefined;
    showInteraction();
  }, 220);
});

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.tokenPet.showContextMenu();
});

function endDrag(event) {
  if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
    return;
  }
  if (dragOrigin.dragging) {
    justDragged = true;
    window.tokenPet.endDrag();
  }
  dragOrigin = null;
  window.tokenPet.saveBounds();
}

pet.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }
  pet.setPointerCapture(event.pointerId);
  dragOrigin = {
    pointerId: event.pointerId,
    mouseScreenX: event.screenX,
    mouseScreenY: event.screenY,
    windowStartX: window.screenX,
    windowStartY: window.screenY,
    dragging: false
  };
});

pet.addEventListener('pointermove', (event) => {
  if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
    return;
  }
  if (!dragOrigin.dragging) {
    const dx = event.screenX - dragOrigin.mouseScreenX;
    const dy = event.screenY - dragOrigin.mouseScreenY;
    if (dx * dx + dy * dy <= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      return;
    }
    dragOrigin.dragging = true;
  }
  const dx = event.screenX - dragOrigin.mouseScreenX;
  const dy = event.screenY - dragOrigin.mouseScreenY;
  window.tokenPet.dragTo(dragOrigin.windowStartX + dx, dragOrigin.windowStartY + dy);
});

pet.addEventListener('pointerup', endDrag);
pet.addEventListener('pointercancel', endDrag);
