import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchWeather, searchCities, WeatherServiceError } from './weather-service.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(moduleDirectory, '..');
let mainWindow = null;

function serializeError(error) {
  return {
    ok: false,
    error: error instanceof Error ? error.message : '天气服务暂时不可用，请使用手动模式。',
    code: error instanceof WeatherServiceError ? error.code : 'WEATHER_UNAVAILABLE'
  };
}

function installWeatherIpc() {
  ipcMain.handle('weather:search-cities', async (_event, query) => {
    try {
      return { ok: true, results: await searchCities(query) };
    } catch (error) {
      return serializeError(error);
    }
  });
  ipcMain.handle('weather:fetch', async (_event, request) => {
    try {
      return { ok: true, weather: await fetchWeather(request || {}) };
    } catch (error) {
      return serializeError(error);
    }
  });
  ipcMain.handle('asset:rain-audio', async event => {
    if (!isTrustedWindow(event.sender)) throw new Error('Untrusted renderer');
    const bytes = await readFile(path.join(applicationRoot, 'dist', 'audio', 'rain-loop.wav'));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
}

function isTrustedWindow(webContents) {
  return Boolean(mainWindow && webContents && webContents.id === mainWindow.webContents.id);
}

function configurePermissions() {
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'geolocation' && isTrustedWindow(webContents);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'geolocation' && isTrustedWindow(webContents));
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 900,
    minHeight: 520,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    title: 'Rainform Weather Desktop',
    icon: path.join(applicationRoot, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(moduleDirectory, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith('file:')) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadFile(path.join(applicationRoot, 'dist', 'index.html'));
}

app.setAppUserModelId('io.local.rainform.weatherdesktop');
app.whenReady().then(async () => {
  configurePermissions();
  installWeatherIpc();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
