const { BrowserWindow, ipcMain } = require('electron');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function promptForText({ parent, title, label, value = '' }) {
  return new Promise((resolve) => {
    const channel = `prompt:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const promptWindow = new BrowserWindow({
      width: 360,
      height: 170,
      parent,
      modal: Boolean(parent),
      resizable: false,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      title,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    let settled = false;
    function finish(result) {
      if (settled) {
        return;
      }

      settled = true;
      ipcMain.removeAllListeners(channel);
      if (!promptWindow.isDestroyed()) {
        promptWindow.close();
      }
      resolve(result);
    }

    ipcMain.once(channel, (_event, result) => finish(typeof result === 'string' ? result : undefined));
    promptWindow.on('closed', () => finish(undefined));
    promptWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { margin: 0; padding: 18px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101419; color: #f7fafc; }
              label { display: block; font-size: 13px; color: #aeb8c5; margin-bottom: 8px; }
              input { box-sizing: border-box; width: 100%; height: 34px; border-radius: 6px; border: 1px solid #344051; background: #161d27; color: #fff; padding: 0 10px; font-size: 14px; }
              footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
              button { height: 32px; border-radius: 6px; border: 0; padding: 0 14px; font-size: 13px; cursor: pointer; }
              .secondary { background: #2a3442; color: #d9e2ef; }
              .primary { background: #f6c65b; color: #1b1403; font-weight: 700; }
            </style>
          </head>
          <body>
            <label for="name">${escapeHtml(label)}</label>
            <input id="name" value="${escapeHtml(value)}" autofocus />
            <footer>
              <button class="secondary" id="cancel">取消</button>
              <button class="primary" id="ok">确定</button>
            </footer>
            <script>
              const { ipcRenderer } = require('electron');
              const input = document.getElementById('name');
              function submit() { ipcRenderer.send('${channel}', input.value); }
              document.getElementById('ok').addEventListener('click', submit);
              document.getElementById('cancel').addEventListener('click', () => ipcRenderer.send('${channel}'));
              input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') submit();
                if (event.key === 'Escape') ipcRenderer.send('${channel}');
              });
              input.select();
            </script>
          </body>
        </html>
      `)}`
    );
  });
}

module.exports = {
  promptForText
};
