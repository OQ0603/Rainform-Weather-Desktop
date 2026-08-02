// Renderer-side weather UI. Provider requests cross the isolated preload bridge;
// credentials never enter this module or the packaged renderer bundle.
const desktop = window.rainformDesktop;
const rainform = window.rainform;

const elements = {
  dashboard: document.querySelector('.rainfall-dashboard'),
  root: document.querySelector('#scene-root'),
  toolbar: document.querySelector('#scene-toolbar'),
  status: document.querySelector('#weather-status'),
  statusText: document.querySelector('#weather-status-text'),
  selectionText: document.querySelector('#weather-selection-text'),
  statusClose: document.querySelector('#weather-status-close'),
  editor: document.querySelector('#rainfall-editor'),
  autoTab: document.querySelector('#rainfall-mode-auto'),
  manualTab: document.querySelector('#rainfall-mode-manual'),
  autoPanel: document.querySelector('#rainfall-auto-panel'),
  manualPanel: document.querySelector('#rainfall-manual-panel'),
  relocate: document.querySelector('#weather-relocate'),
  editorLocation: document.querySelector('#weather-editor-location'),
  editorSummary: document.querySelector('#weather-editor-summary'),
  editorStatus: document.querySelector('#weather-editor-status'),
  searchInput: document.querySelector('#city-search-input'),
  searchResults: document.querySelector('#city-search-results'),
  searchSpinner: document.querySelector('#city-search-spinner')
};

const state = {
  mode: 'auto',
  phase: 'loading',
  weather: null,
  error: '',
  statusHidden: false,
  searchSequence: 0,
  searchTimer: null,
  selected: null
};

function setPhase(phase) {
  state.phase = phase;
  elements.status.dataset.state = phase;
  elements.root.dataset.weatherStatus = phase;
}

function setEditorStatus(message, phase = 'idle') {
  elements.editorStatus.textContent = message;
  elements.editorStatus.dataset.state = phase;
}

function displayCity(weather) {
  const raw = String(weather?.city || '当前位置').trim();
  const country = String(weather?.country || '');
  if (raw === '当前位置') return raw;
  if ((country.includes('中国') || /[\u3400-\u9fff]/.test(raw)) && !/[市区县州盟]$/.test(raw)) {
    return `${raw}市`;
  }
  return raw;
}

function formatRainfall(value) {
  const number = Number(value) || 0;
  return number >= 10 ? number.toFixed(0) : number.toFixed(1);
}

function renderSelection() {
  const selected = state.selected;
  if (!selected?.active) {
    elements.selectionText.hidden = true;
    elements.selectionText.textContent = '';
    return;
  }
  const rainText = selected.value > 0
    ? `${formatRainfall(selected.value)} mm/h`
    : '暂无降雨';
  elements.selectionText.textContent = `预计 ${String(selected.hour).padStart(2, '0')}:00 · ${rainText}`;
  elements.selectionText.hidden = false;
}

function weatherStatusText(weather) {
  const city = displayCity(weather);
  const currentRain = Number(weather.current?.precipitation) || 0;
  const dayHasRain = weather.rainfall.some(value => Number(value) > 0);
  const condition = weather.current?.weatherText || '实时天气';
  const temperature = Math.round(Number(weather.current?.temperature) || 0);
  if (currentRain > 0) {
    return `${city} · 正在降雨 ${formatRainfall(currentRain)} mm/h · ${condition} ${temperature}°C`;
  }
  if (dayHasRain) {
    return `${city} · 当前无雨，今日有降雨预报 · ${condition} ${temperature}°C`;
  }
  return `${city} · 暂无降雨 · ${condition} ${temperature}°C`;
}

function renderStatus() {
  if (state.mode === 'manual') {
    const rainfall = rainform.getRainfallData();
    const maximum = Math.max(...rainfall);
    elements.statusText.textContent = maximum > 0
      ? `手动模式 · 全天降雨数据已应用 · 峰值 ${formatRainfall(maximum)} mm/h`
      : '手动模式 · 暂无降雨';
    setPhase('success');
    return;
  }
  if (state.phase === 'loading') return;
  if (state.weather) {
    elements.statusText.textContent = weatherStatusText(state.weather);
    return;
  }
  if (state.error) elements.statusText.textContent = state.error;
}

function showStatus() {
  state.statusHidden = false;
  elements.status.classList.remove('is-hidden');
  elements.status.setAttribute('aria-hidden', 'false');
}

function hideStatus() {
  state.statusHidden = true;
  elements.status.classList.add('is-hidden');
  elements.status.setAttribute('aria-hidden', 'true');
}

function setMode(mode, { reapply = true } = {}) {
  state.mode = mode === 'manual' ? 'manual' : 'auto';
  const automatic = state.mode === 'auto';
  elements.autoTab.setAttribute('aria-selected', String(automatic));
  elements.manualTab.setAttribute('aria-selected', String(!automatic));
  elements.autoTab.tabIndex = automatic ? 0 : -1;
  elements.manualTab.tabIndex = automatic ? -1 : 0;
  elements.autoPanel.hidden = !automatic;
  elements.manualPanel.hidden = automatic;
  elements.editor.dataset.mode = state.mode;
  elements.root.dataset.rainfallMode = state.mode;
  if (automatic && reapply && state.weather) {
    rainform.applyRainfallData(state.weather.rainfall, 'auto');
  }
  renderStatus();
  showStatus();
}

function geolocationErrorMessage(error) {
  if (error?.code === 1) return '系统定位权限未开启，请在 Windows 设置中允许位置访问。';
  if (error?.code === 2) return '系统暂时无法确定位置，请搜索城市或稍后重试。';
  if (error?.code === 3) return '系统定位超时，请重新定位或搜索城市。';
  return '无法获取系统位置，请搜索城市或使用手动模式。';
}

async function systemPosition() {
  const testPosition = desktop?.getTestGeolocation?.();
  if (testPosition) return testPosition;
  if (!navigator.geolocation) throw new Error('当前系统不支持定位。');
  return await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      reject,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

async function syncWeather(request, loadingMessage) {
  setMode('auto', { reapply: false });
  setPhase('loading');
  elements.statusText.textContent = loadingMessage;
  setEditorStatus(loadingMessage, 'loading');
  elements.relocate.disabled = true;
  state.error = '';
  try {
    const response = await desktop.fetchWeather(request);
    if (!response?.ok) throw new Error(response?.error || '天气服务暂时不可用。');
    state.weather = response.weather;
    rainform.applyRainfallData(response.weather.rainfall, 'auto');
    setPhase('success');
    elements.root.dataset.weatherProvider = response.weather.provider;
    elements.root.dataset.weatherCity = displayCity(response.weather);
    elements.root.dataset.currentPrecipitation = String(response.weather.current.precipitation);
    elements.editorLocation.textContent = displayCity(response.weather);
    elements.editorSummary.textContent = `${response.weather.current.weatherText} · ${Math.round(response.weather.current.temperature)}°C · ${response.weather.provider === 'moji' ? '墨迹天气' : 'Open-Meteo'}`;
    const fallbackText = response.weather.fallback ? '，墨迹不可用，已自动回退 Open-Meteo' : '';
    setEditorStatus(`同步成功${fallbackText} · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`, 'success');
    renderStatus();
    showStatus();
    return response.weather;
  } catch (error) {
    state.error = `天气同步失败 · ${error instanceof Error ? error.message : '请稍后重试'} · 可使用手动模式`;
    setPhase('error');
    elements.statusText.textContent = state.error;
    setEditorStatus(state.error, 'error');
    showStatus();
    return null;
  } finally {
    elements.relocate.disabled = false;
  }
}

async function locateAndSync() {
  setMode('auto', { reapply: false });
  setPhase('loading');
  elements.statusText.textContent = '正在请求系统定位…';
  setEditorStatus('正在请求 Windows 定位权限…', 'loading');
  elements.relocate.disabled = true;
  try {
    const position = await systemPosition();
    return await syncWeather({
      latitude: position.latitude,
      longitude: position.longitude,
      city: position.city || '',
      source: 'system'
    }, '已定位，正在同步天气…');
  } catch (error) {
    const message = geolocationErrorMessage(error);
    state.error = `${message} 可继续搜索城市或使用手动模式。`;
    setPhase('error');
    elements.statusText.textContent = state.error;
    setEditorStatus(state.error, 'error');
    showStatus();
    return null;
  } finally {
    elements.relocate.disabled = false;
  }
}

function clearSearchResults() {
  elements.searchResults.replaceChildren();
  elements.searchResults.classList.remove('has-results');
}

function renderSearchResults(results, sequence) {
  if (sequence !== state.searchSequence) return;
  clearSearchResults();
  for (const city of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'city-search-result';
    button.setAttribute('role', 'option');
    button.dataset.city = city.name;
    button.innerHTML = `<strong></strong><span></span>`;
    button.querySelector('strong').textContent = city.name;
    button.querySelector('span').textContent = [city.label, city.country].filter(Boolean).join(' · ');
    button.addEventListener('click', async () => {
      elements.searchInput.value = city.name;
      clearSearchResults();
      await syncWeather({
        latitude: city.latitude,
        longitude: city.longitude,
        city: city.name,
        region: city.region,
        source: 'search'
      }, `正在同步${city.name}天气…`);
    });
    elements.searchResults.appendChild(button);
  }
  elements.searchResults.classList.toggle('has-results', results.length > 0);
  if (!results.length) setEditorStatus('没有找到匹配城市，请换一个名称。', 'error');
}

async function search(query) {
  const sequence = ++state.searchSequence;
  elements.searchSpinner.classList.add('is-active');
  setEditorStatus('正在搜索城市…', 'loading');
  try {
    const response = await desktop.searchCities(query);
    if (!response?.ok) throw new Error(response?.error || '城市搜索失败');
    renderSearchResults(response.results, sequence);
    if (response.results.length) setEditorStatus(`找到 ${response.results.length} 个候选城市`, 'success');
  } catch (error) {
    if (sequence !== state.searchSequence) return;
    clearSearchResults();
    setEditorStatus(`城市搜索失败 · ${error instanceof Error ? error.message : '请稍后重试'}`, 'error');
  } finally {
    if (sequence === state.searchSequence) elements.searchSpinner.classList.remove('is-active');
  }
}

elements.autoTab.addEventListener('click', () => setMode('auto'));
elements.manualTab.addEventListener('click', () => setMode('manual'));
elements.relocate.addEventListener('click', locateAndSync);
elements.statusClose.addEventListener('click', hideStatus);
elements.toolbar.addEventListener('pointerenter', showStatus);
elements.toolbar.addEventListener('focusin', showStatus);
elements.searchInput.addEventListener('input', () => {
  if (state.searchTimer !== null) window.clearTimeout(state.searchTimer);
  const query = elements.searchInput.value.trim();
  if (query.length < 2) {
    state.searchSequence += 1;
    elements.searchSpinner.classList.remove('is-active');
    clearSearchResults();
    if (query) setEditorStatus('请至少输入两个字符。');
    return;
  }
  state.searchTimer = window.setTimeout(() => search(query), 320);
});

window.addEventListener('rainform:selection-change', event => {
  state.selected = event.detail;
  renderSelection();
});

window.addEventListener('rainform:rainfall-applied', event => {
  if (event.detail?.source === 'manual') {
    state.mode = 'manual';
    renderStatus();
  }
});

window.__rainformWeatherDebug = Object.freeze({
  getState: () => ({
    mode: state.mode,
    phase: state.phase,
    city: state.weather ? displayCity(state.weather) : '',
    provider: state.weather?.provider || '',
    statusHidden: state.statusHidden,
    rainfall: rainform.getRainfallData()
  }),
  locateAndSync,
  setMode
});

if (!desktop?.isDesktop) {
  state.error = '此构建需要通过 Rainform Windows 桌面软件运行；仍可使用手动模式。';
  setPhase('error');
  renderStatus();
  setEditorStatus(state.error, 'error');
} else {
  locateAndSync();
}
