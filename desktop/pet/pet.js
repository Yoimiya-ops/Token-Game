const pet = document.getElementById('pet');
const cat = document.getElementById('cat');
const bubble = document.getElementById('bubble');
const petImage = document.getElementById('pet-image');
const messages = ['喵，Token 消化中...', '+1 摸摸', '双击我进入游戏', '今天也要好好喂猫'];
let clickTimer;
let messageIndex = 0;

function applyAsset(asset) {
  const isImage = asset?.kind === 'image';
  pet.dataset.petKind = isImage ? 'image' : 'css';
  pet.dataset.petId = asset?.id ?? 'default-cat';
  petImage.src = isImage ? asset.src : '';
  petImage.alt = asset?.label ?? '桌宠';
}

window.tokenPet.getAsset().then(applyAsset);
window.tokenPet.onAssetChanged(applyAsset);

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

window.addEventListener('mouseup', () => {
  window.tokenPet.saveBounds();
});
