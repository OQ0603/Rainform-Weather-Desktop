const { contextBridge, ipcRenderer } = require('electron');

function testGeolocation() {
  if (process.env.RAINFORM_E2E !== '1') return null;
  const [latitude, longitude] = String(process.env.RAINFORM_E2E_GEO || '')
    .split(',')
    .map(Number);
  const city = String(process.env.RAINFORM_E2E_CITY || '').trim();
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, accuracy: 10, city }
    : null;
}

contextBridge.exposeInMainWorld('rainformDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  searchCities: query => ipcRenderer.invoke('weather:search-cities', query),
  fetchWeather: request => ipcRenderer.invoke('weather:fetch', request),
  loadRainAudio: () => ipcRenderer.invoke('asset:rain-audio'),
  getTestGeolocation: () => testGeolocation()
}));
