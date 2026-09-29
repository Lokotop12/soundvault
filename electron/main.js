// SoundVault desktop — Electron main process.
// Поднимает локальный сервер (обход блокировок + проксирование аудио)
// и показывает его в обычном окне приложения.
const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

// Нет root для setuid-sandbox — локальному приложению он не нужен.
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
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 480,
    title: 'SoundVault',
    icon: path.join(__dirname, '..', 'public', 'icon-512.png'),
    autoHideMenuBar: true,
    backgroundColor: '#0e0e12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  // Внешние ссылки — в системный браузер, не в нашем окне.
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
  // Если сервер уже запущен (например, через npm run serve) — просто подключаемся.
  const alreadyUp = await fetch(`${BASE}/api/status`).then(() => true).catch(() => false);
  if (!alreadyUp) {
    // Сервер слушает порт сразу при require.
    require(path.join(__dirname, '..', 'server.js'));
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
