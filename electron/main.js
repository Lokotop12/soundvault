const path = require('path');
const { app, BrowserWindow, shell, screen } = require('electron');

app.commandLine.appendSwitch('no-sandbox');

const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(tries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      fetch(`${BASE}/api/status`)
        .then(() => resolve())
        .catch(() => (n > 0 ? setTimeout(() => attempt(n - 1), 250) : reject(new Error('server did not start'))));
    };
    attempt(tries);
  });
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1360, Math.round(area.width * 0.88));
  const height = Math.min(880, Math.round(area.height * 0.9));

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 820,
    minHeight: 520,
    center: true,
    title: 'SoundVault',
    icon: path.join(__dirname, '..', 'public', 'icon-512.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0b0b10',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(BASE)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  win.loadURL(BASE);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.lokotop12.soundvault');
  const alreadyUp = await fetch(`${BASE}/api/status`).then(() => true).catch(() => false);
  if (!alreadyUp) {
    process.env.SV_CONFIG_DIR = app.getPath('userData');
    try {
      require(path.join(__dirname, '..', 'server.js'));
    } catch (e) {
      console.error('server require failed:', e);
    }
    try {
      await waitForServer();
    } catch (e) {
      console.error(e);
      app.quit();
      return;
    }
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
