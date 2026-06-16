const cat = document.getElementById('cat');
const bubble = document.getElementById('bubble');
const messages = ['喵，Token 消化中...', '+1 摸摸', '双击我进入游戏', '今天也要好好喂猫'];
let clickTimer;
let messageIndex = 0;

function showInteraction() {
  window.tokenPet.interact();
  cat.classList.remove('is-happy');
  void cat.offsetWidth;
  cat.classList.add('is-happy');
  bubble.textContent = messages[messageIndex % messages.length];
  messageIndex += 1;
  bubble.classList.add('is-visible');
  window.setTimeout(() => {
    bubble.classList.remove('is-visible');
  }, 1400);
}

cat.addEventListener('click', () => {
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
