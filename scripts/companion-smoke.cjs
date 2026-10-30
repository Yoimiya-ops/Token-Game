const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const reportDir = path.join(root, 'outputs', 'verification');
fs.mkdirSync(reportDir, { recursive: true });
const testRoot = fs.mkdtempSync(path.join(reportDir, 'smoke-'));
const codexHome = path.join(testRoot, 'codex');
fs.mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
const rollout = path.join(codexHome, 'sessions', 'rollout-smoke.jsonl');
const record = (type, payload, timestamp = new Date().toISOString()) => JSON.stringify({ type, payload, timestamp }) + '\n';
const usage = total => record('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: total, input_tokens: total - 10, output_tokens: 10, reasoning_output_tokens: 8 } } });
fs.writeFileSync(rollout, record('session_meta', { id: 'smoke-session' }) + record('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 1000 } } }, new Date(Date.now() - 60_000).toISOString()));
const errors = [];
const networkRequests = [];
const executable = process.env.TOKEN_GAME_EXECUTABLE || require('electron');
const packaged = Boolean(process.env.TOKEN_GAME_EXECUTABLE);
const creditedTokens = 110_000_000;
const drawCost = 100_000;
const legendaryPity = 1000;
let application;
let exited = false;

async function launch() {
  const environment = { ...process.env, TOKEN_GAME_USER_DATA_DIR: path.join(testRoot, 'user'), TOKEN_GAME_DATA_DIR: path.join(testRoot, 'data'), CODEX_HOME: codexHome };
  if (process.env.TOKEN_GAME_ISOLATED_RUNTIME) {
    for (const key of Object.keys(environment)) if (['path', 'node_path', 'electron_run_as_node'].includes(key.toLowerCase())) delete environment[key];
    const windows = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
    environment.Path = path.join(windows, 'System32') + ';' + windows;
    environment.NODE_PATH = '';
  }
  const instance = await electron.launch({
    executablePath: executable, args: [...JSON.parse(process.env.TOKEN_GAME_ELECTRON_ARGS || '[]'), ...(packaged ? [] : [root])], timeout: 30_000,
    env: environment
  });
  instance.on('window', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) networkRequests.push(request.url()); });
  });
  return instance;
}
async function receipt(instance) {
  const deadline = Date.now() + 20_000;
  let requested = false;
  while (Date.now() < deadline) {
    const existing = instance.windows().find(page => page.url().startsWith('file:') && !page.url().includes('/pet/'));
    if (existing) return existing;
    const pet = instance.windows().find(page => page.url().includes('/pet/'));
    if (!requested && pet && await pet.locator('#pet').isVisible()) {
      requested = true;
      await pet.locator('#pet').click({ button: 'right' });
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Receipt window did not open');
}
async function state(page) { return page.evaluate(() => window.tokenPet.getState()); }
async function waitForState(page, predicate) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await state(page);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Timed out waiting for companion state');
}

async function closeReceipt(instance) {
  await instance.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('/pet/'))?.close();
  });
}
async function fits(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Default window must not require scrolling');
  for (const selector of ['.collect-button', '.app-footer', '.draw-controls', '.forge-actions']) {
    const element = page.locator(selector);
    if (await element.count()) {
      const box = await element.boundingBox();
      const height = await page.evaluate(() => innerHeight);
      assert.ok(box && box.y >= 0 && box.y + box.height <= height + 1, selector + ' must remain visible');
    }
  }
}
(async () => {
  try {
    application = await launch();
    let page = await receipt(application);
    await page.waitForSelector('.mode-tabs');
    await waitForState(page, s => Boolean(s.connection.lastCheckedAt));
    const pet = application.windows().find(window => window.url().includes('/pet/'));
    assert.ok(pet);
    assert.equal((await state(page)).totalTokens, 0);
    assert.ok(application.windows().every(window => window.url().startsWith('file:')));
    await fits(page);
    await page.screenshot({ path: path.join(reportDir, 'receipt-waiting.png') });
    const idleA = await pet.screenshot({ omitBackground: true });
    await pet.waitForTimeout(450);
    const idleB = await pet.screenshot({ path: path.join(reportDir, 'pet-idle.png'), omitBackground: true });
    assert.ok(!idleA.equals(idleB), 'Idle basin must visibly move');
    const { data, info } = await require('sharp')(idleB).raw().toBuffer({ resolveWithObject: true });
    let transparent = 0, painted = 0;
    for (let i = info.channels - 1; i < data.length; i += info.channels) {
      if (data[i] === 0) transparent++;
      if (data[i] > 200) painted++;
    }
    assert.ok(info.channels === 4 && transparent > 1000 && painted > 1000);
    await closeReceipt(application);
    await pet.locator('#pet').click();
    await pet.waitForFunction(() => document.querySelector('#bubble').textContent.includes('+0 Token'));
    assert.equal(application.windows().length, 1);
    await pet.screenshot({ path: path.join(reportDir, 'pet-empty-harvest.png'), omitBackground: true });
    console.log('PASS: idle movement, alpha, empty harvest');

    fs.appendFileSync(rollout, usage(creditedTokens + 1000));
    await waitForState(pet, s => s.pendingTokens === creditedTokens);
    await pet.locator('#pet').dblclick({ delay: 100 });
    page = await receipt(application);
    await page.waitForSelector('.mode-tabs');
    await pet.waitForTimeout(750);
    assert.equal((await state(pet)).pendingTokens, creditedTokens, 'Double click must not harvest');
    assert.equal(application.windows().length, 2);
    await closeReceipt(application);
    await pet.locator('#pet').click({ button: 'right' });
    page = await receipt(application);
    await page.waitForSelector('.mode-tabs');
    assert.equal((await state(page)).pendingTokens, creditedTokens);
    await page.screenshot({ path: path.join(reportDir, 'receipt-ready.png') });
    await closeReceipt(application);
    await pet.locator('#pet').click();
    await waitForState(pet, s => s.pendingTokens === 0);
    await pet.waitForFunction(() => document.querySelector('#bubble').textContent.includes('+110,000,000 Token'));
    assert.equal((await state(pet)).forge.balance, creditedTokens);
    assert.equal(application.windows().length, 1, 'Single click must not open the receipt');
    await pet.waitForTimeout(220);
    await pet.screenshot({ path: path.join(reportDir, 'pet-harvest.png'), omitBackground: true });
    await pet.waitForTimeout(2500);
    const beforeDrag = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    const revision = (await state(pet)).receipt.revision;
    await pet.mouse.move(140, 180); await pet.mouse.down(); await pet.mouse.move(166, 197); await pet.mouse.up();
    await pet.waitForTimeout(750);
    const afterDrag = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
    assert.notEqual(afterDrag.x, beforeDrag.x);
    assert.equal((await state(pet)).receipt.revision, revision);
    assert.equal(application.windows().length, 1);
    console.log('PASS: click, double click, right click and drag');

    await pet.locator('#pet').click({ button: 'right' });
    page = await receipt(application);
    await page.waitForSelector('.mode-tabs');
    await fits(page);
    assert.equal(await page.getByTestId('balance').innerText(), '110M');
    assert.equal(await page.getByRole('button', { name: /祈器一次/ }).getAttribute('class'), 'secondary-button');
    assert.ok((await page.getByRole('button', { name: /祈器十次/ }).getAttribute('class')).includes('primary-button'));
    assert.ok((await page.getByRole('button', { name: /祈器一次/ }).innerText()).includes('100K Token'));
    assert.ok((await page.getByRole('button', { name: /祈器十次/ }).innerText()).includes('1M Token'));
    for (let i = 1; i <= legendaryPity / 10; i++) {
      await page.getByRole('button', { name: /祈器十次/ }).click();
      await waitForState(page, s => s.forge.draws === i * 10);
      if (i === 1) {
        await page.waitForTimeout(1600);
        await page.screenshot({ path: path.join(reportDir, 'weapon-draw.png') });
      }
    }
    const drawn = await state(page);
    assert.equal(drawn.forge.balance, creditedTokens - legendaryPity * drawCost);
    assert.ok(Object.keys(drawn.forge.inventory).some(id => id.startsWith('w5-')));
    assert.equal(await page.locator('.recent-weapon').count(), 10);
    await page.getByRole('tab', { name: '分解 · 兑换' }).click();
    await fits(page);
    assert.equal(await page.locator('.weapon-cell').count(), 15);
    assert.ok(await page.locator('.weapon-cell img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)));
    await page.screenshot({ path: path.join(reportDir, 'weapon-forge.png') });
    const beforeBatch = await state(page);
    assert.equal(await page.getByTestId('balance').innerText(), '10M');
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.getByRole('combobox', { name: '品质快捷选择' }).count(), 0);
    await page.getByRole('button', { name: '批量分解', exact: true }).click();
    assert.equal(await page.getByRole('checkbox').count(), 15);
    assert.equal(await page.locator('input[type="checkbox"]').count(), 0, 'Selection must not use white checkbox inputs');
    assert.ok(await page.getByRole('button', { name: /分解所选/ }).isDisabled());
    const checked = page.locator('.weapon-inspect[aria-checked="true"]');
    await page.getByRole('button', { name: '全选', exact: true }).click();
    assert.equal(await checked.count(), Object.keys(beforeBatch.forge.inventory).length);
    await page.getByRole('button', { name: /分解所选/ }).click();
    assert.ok((await page.locator('.confirm-dismantle').innerText()).includes('含仙品'));
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual((await state(page)).forge, beforeBatch.forge, 'Cancel must preserve every item');
    await page.getByRole('button', { name: '取消全选', exact: true }).click();
    const individual = page.locator('.weapon-inspect[role="checkbox"]:enabled').first();
    await individual.click();
    assert.equal(await checked.count(), 1);
    assert.equal(await page.locator('.selection-mark').count(), 1);
    await individual.click();
    assert.equal(await checked.count(), 0);
    await individual.focus();
    await individual.press('Space');
    assert.equal(await checked.count(), 1);
    await individual.press('Enter');
    assert.equal(await checked.count(), 0);

    const center = async id => {
      const box = await page.locator('[data-weapon-id="' + id + '"]').boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const first = await center('w1-sword');
    const third = await center('w3-sword');
    const bottom = await center('w1-spear');
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    await page.mouse.move(third.x, third.y); await page.mouse.up();
    assert.equal(await checked.count(), 0, 'A short swipe must not arm the long-press selection');
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.waitForTimeout(450);
    await page.mouse.move(third.x, third.y, { steps: 1 });
    assert.equal(await checked.count(), 3, 'Fast long-drag must also select the middle card');
    await page.mouse.move(first.x, first.y, { steps: 1 });
    assert.equal(await checked.count(), 3, 'Retracing must not toggle already visited cards');
    await page.mouse.up();
    assert.equal(await checked.count(), 3, 'Pointer release must not toggle the last card');
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.waitForTimeout(450);
    await page.mouse.move(third.x, third.y, { steps: 1 }); await page.mouse.up();
    assert.equal(await checked.count(), 0, 'Starting from a selected card paints deselection');
    await page.mouse.move(first.x, first.y); await page.mouse.down(); await page.waitForTimeout(450);
    await page.mouse.move(bottom.x, bottom.y, { steps: 1 }); await page.mouse.up();
    assert.equal(await checked.count(), 3, 'Long-drag must select across rows');
    await page.screenshot({ path: path.join(reportDir, 'weapon-drag-selection.png') });

    // Loss of capture must not leave a pending hold or turn a cancel into a click.
    await page.mouse.move(third.x, third.y); await page.mouse.down();
    await page.locator('.weapon-grid').evaluate(grid => {
      for (let id = 1; id <= 10; id++) if (grid.hasPointerCapture(id)) grid.releasePointerCapture(id);
    });
    await page.waitForTimeout(450); await page.mouse.up();
    assert.equal(await checked.count(), 3);
    await page.getByRole('button', { name: '退出选择', exact: true }).click();
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.deepEqual((await state(page)).forge, beforeBatch.forge);
    await page.getByRole('button', { name: '批量分解', exact: true }).click();
    assert.equal(await checked.count(), 0);
    await page.getByRole('combobox', { name: '品质快捷选择' }).selectOption('1');
    assert.equal(await checked.count(), Object.keys(beforeBatch.forge.inventory).filter(id => id.startsWith('w1-')).length);
    await page.getByRole('combobox', { name: '品质快捷选择' }).selectOption('3');
    assert.equal(await checked.count(), Object.keys(beforeBatch.forge.inventory).filter(id => /^w[123]-/.test(id)).length);
    await page.getByRole('combobox', { name: '品质快捷选择' }).selectOption('2');
    const selectedIds = Object.keys(beforeBatch.forge.inventory).filter(id => /^w[12]-/.test(id));
    const batchQuantity = selectedIds.reduce((sum, id) => sum + beforeBatch.forge.inventory[id], 0);
    const batchShards = selectedIds.reduce((sum, id) => sum + beforeBatch.forge.inventory[id] * (id.startsWith('w1-') ? 1 : 3), 0);
    assert.equal(await checked.count(), selectedIds.length);
    assert.ok((await page.getByRole('button', { name: /分解所选/ }).innerText()).includes(batchQuantity.toLocaleString()));
    await page.screenshot({ path: path.join(reportDir, 'weapon-batch-selection.png') });
    await page.getByRole('button', { name: /分解所选/ }).click();
    assert.ok((await page.locator('.confirm-dismantle').innerText()).includes(batchShards.toLocaleString()));
    await fits(page);
    await page.getByRole('button', { name: '确认分解', exact: true }).click();
    const current = await waitForState(page, s => s.forge.revision > beforeBatch.forge.revision);
    assert.equal(current.forge.revision, beforeBatch.forge.revision + 1);
    assert.equal(current.forge.shards, beforeBatch.forge.shards + batchShards);
    assert.equal(current.forge.balance, beforeBatch.forge.balance);
    assert.equal(current.forge.sinceLegendary, beforeBatch.forge.sinceLegendary);
    for (const [id, count] of Object.entries(beforeBatch.forge.inventory)) {
      assert.equal(current.forge.inventory[id], selectedIds.includes(id) ? undefined : count);
    }
    assert.equal(await page.getByRole('checkbox').count(), 0, 'Successful dismantle returns to the clean browsing mode');
    await page.getByRole('button', { name: '批量分解', exact: true }).click();
    assert.ok(await page.getByRole('checkbox', { name: /^分解全部青锋剑，/ }).isDisabled());
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('checkbox').count(), 0);
    await page.screenshot({ path: path.join(reportDir, 'weapon-dismantle.png') });
    await page.getByRole('button', { name: /^青锋剑，/ }).click();
    const beforeExchange = await state(page);
    await page.getByRole('button', { name: /兑换此武器/ }).click();
    const exchanged = await waitForState(page, s => s.forge.revision > beforeExchange.forge.revision);
    assert.equal(exchanged.forge.shards, beforeExchange.forge.shards - 12);
    assert.equal(exchanged.forge.inventory['w1-sword'], (beforeExchange.forge.inventory['w1-sword'] ?? 0) + 1);
    assert.equal(exchanged.forge.balance, beforeExchange.forge.balance);
    assert.equal(exchanged.forge.sinceLegendary, beforeExchange.forge.sinceLegendary);
    await page.screenshot({ path: path.join(reportDir, 'weapon-exchange.png') });
    console.log('PASS: ten-draw emphasis, K/M/B, 1000 draws, modal selection, long-drag, batch commit and exchange');

    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('/pet/')).setSize(820, 640));
    await page.waitForTimeout(300);
    await fits(page);
    await page.screenshot({ path: path.join(reportDir, 'receipt-compact.png') });
    await page.getByRole('button', { name: '批量分解', exact: true }).click();
    await page.getByRole('button', { name: '全选', exact: true }).click();
    await fits(page);
    await page.screenshot({ path: path.join(reportDir, 'receipt-compact-selection.png') });
    await page.getByRole('button', { name: /分解所选/ }).click();
    await fits(page);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.confirm-dismantle').count(), 0);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('checkbox').count(), 0);
    await page.getByRole('tab', { name: '祈器', exact: true }).click();
    await fits(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('.basin-image').evaluate(element => element.getAnimations().length), 0);
    const savedForge = (await state(page)).forge;
    await application.close();
    fs.appendFileSync(rollout, usage(creditedTokens + 21000));
    application = await launch();
    page = await receipt(application);
    await waitForState(page, s => s.totalTokens === creditedTokens + 20000);
    assert.equal((await state(page)).pendingTokens, 20000);
    assert.deepEqual((await state(page)).forge, savedForge);
    await page.getByRole('button', { name: '收取灵气', exact: true }).click();
    await waitForState(page, s => s.pendingTokens === 0 && s.forge.balance === savedForge.balance + 20000);
    const quit = application.waitForEvent('close');
    await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 50); });
    await quit;
    exited = true;
    assert.deepEqual(errors, []);
    assert.deepEqual(networkRequests, []);
    fs.writeFileSync(path.join(reportDir, packaged ? 'package-smoke.json' : 'source-smoke.json'), JSON.stringify({
      ok: true, packaged, isolatedRuntime: Boolean(process.env.TOKEN_GAME_ISOLATED_RUNTIME), testRoot,
      checks: ['two-local-windows', 'no-network', 'default-no-scroll', 'idle-moving-transparent-art', 'empty-harvest-feedback', 'single-click-harvest', 'double-right-click-open-only', 'drag-no-harvest', 'ten-draw-primary', 'compact-english-tokens', 'thousand-draw-pity', 'weapon-assets', 'batch-mode-entry-exit', 'dark-card-check-selection', 'keyboard-selection', 'long-drag-select-and-deselect', 'fast-stroke-no-skips', 'capture-cancel-no-click', 'three-quality-presets', 'batch-preview-cancel-confirm', 'unselected-inventory-preserved', 'targeted-exchange', 'compact-no-scroll', 'reduced-motion', 'restart-economy-and-catchup', 'clean-quit'], errors
    }, null, 2));
    console.log('PASS: basin and weapons end-to-end' + (packaged ? ' (packaged runtime)' : ' (source runtime)'));
  } finally { if (application && !exited) await application.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
