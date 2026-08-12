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
  hourlySource: document.querySelector('#weather-hourly-source'),
  hourlyList: document.querySelector('#weather-hourly-list'),
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
  syncSequence: 0,
  completedSyncSequence: 0,
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
  const selectedForecast = state.mode === 'auto'
    ? state.weather?.hourly?.find(item => Number(item.hour) === Number(selected.hour))
    : null;
  const rainText = selectedForecast?.precipitationEstimated
    ? `${selectedForecast.weatherText}趋势（气象局）`
    : selected.value > 0
      ? `${formatRainfall(selected.value)} mm/h`
      : '暂无降雨';
  elements.selectionText.textContent = `预计 ${String(selected.hour).padStart(2, '0')}:00 · ${rainText}`;
  elements.selectionText.hidden = false;
}

function weatherStatusText(weather) {
  const city = displayCity(weather);
  const currentRain = Number(weather.current?.precipitation) || 0;
  const visualRain = Number(weather.current?.visualPrecipitation ?? currentRain) || 0;
  const estimated = Boolean(weather.current?.precipitationEstimated);
  const dayHasRain = weather.rainfall.some(value => Number(value) > 0);
  const condition = weather.current?.weatherText || '实时天气';
  const temperature = Math.round(Number(weather.current?.temperature) || 0);
  const alertText = weather.alert?.label ? ` · ${weather.alert.label}` : '';
  if (currentRain > 0) {
    return `${city} · 正在降雨 ${formatRainfall(currentRain)} mm/h · ${condition} ${temperature}°C${alertText}`;
  }
  if (visualRain > 0 && estimated) {
    return `${city} · 正在${condition.includes('雨') ? condition : '降雨'} · ${temperature}°C${alertText}`;
  }
  if (dayHasRain) {
    return `${city} · 当前无雨，今日有降雨预报 · ${condition} ${temperature}°C${alertText}`;
  }
  return `${city} · 暂无降雨 · ${condition} ${temperature}°C${alertText}`;
}

function providerLabel(weather) {
  if (weather.provider === 'cma') {
    return weather.forecastProvider === 'cma-trend+open-meteo'
      ? '中国气象局实况 + 气象局日夜趋势'
      : '中国气象局实况';
  }
  if (weather.provider === 'open-meteo') return 'Open-Meteo（国内实况不可用）';
  if (weather.forecastProvider === 'open-meteo') return '墨迹天气实况 + Open-Meteo逐小时';
  return '墨迹天气';
}

function sourceUpdateLabel(weather) {
  const raw = String(weather.updatedAt || '');
  const match = raw.match(/(?:T|\s)(\d{1,2}:\d{2})/);
  return match ? match[1] : new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function hourlySourceLabel(weather) {
  if (weather?.forecastProvider === 'moji') return '墨迹天气逐小时预报';
  if (weather?.forecastProvider === 'cma-trend+open-meteo') return '中国气象局趋势 · Open-Meteo小时刻度';
  if (weather?.forecastProvider === 'open-meteo') return 'Open-Meteo 逐小时预报';
  return '后续预报暂不可用';
}

function renderHourlyForecast(weather, phase = 'success', message = '') {
  elements.hourlyList.replaceChildren();
  elements.hourlyList.dataset.state = phase;
  if (phase !== 'success' || !weather || weather.forecastProvider === 'cma-current-only') {
    elements.hourlySource.textContent = phase === 'loading' ? '正在同步' : '后续预报暂不可用';
    const empty = document.createElement('p');
    empty.className = 'weather-hourly-empty';
    empty.textContent = message || (phase === 'loading' ? '正在获取后续逐小时天气…' : '当前实况仍可使用，可稍后重新同步');
    elements.hourlyList.append(empty);
    return;
  }

  const currentHour = Number.isInteger(Number(weather.currentHour))
    ? Number(weather.currentHour)
    : new Date().getHours();
  const day = (Array.isArray(weather.hourly) ? weather.hourly : [])
    .filter(item => Number(item.hour) >= 0 && Number(item.hour) <= 24);
  elements.hourlySource.textContent = hourlySourceLabel(weather);
  if (!day.length) {
    const empty = document.createElement('p');
    empty.className = 'weather-hourly-empty';
    empty.textContent = '全天时段数据暂不可用';
    elements.hourlyList.append(empty);
    return;
  }

  let currentRow = null;
  for (const item of day) {
    const hour = Number(item.hour);
    const period = hour < currentHour ? 'past' : hour === currentHour ? 'current' : 'future';
    const row = document.createElement('div');
    row.className = `weather-hourly-row is-${period}`;
    row.dataset.period = period;
    row.setAttribute('role', 'listitem');

    const time = document.createElement('time');
    time.textContent = item.label || `${String(item.hour).padStart(2, '0')}:00`;
    if (item.time) time.dateTime = item.time;
    const periodLabel = document.createElement('em');
    periodLabel.textContent = period === 'past' ? '较早' : period === 'current' ? '实况' : '未来';
    const condition = document.createElement('strong');
    condition.textContent = period === 'current'
      ? weather.current?.weatherText || item.weatherText || '实时天气'
      : item.weatherText || '天气';
    const rain = document.createElement('span');
    const amount = period === 'current'
      ? Number(weather.current?.precipitation) || 0
      : Number(item.precipitation) || 0;
    rain.className = amount > 0 ? 'has-rain' : '';
    rain.textContent = period === 'future' && item.precipitationEstimated
      ? '气象局趋势'
      : amount > 0
        ? `${formatRainfall(amount)} mm/h`
        : '无雨';
    const temperature = document.createElement('span');
    const temperatureValue = period === 'current'
      ? Number(weather.current?.temperature)
      : Number(item.temperature);
    temperature.textContent = `${Math.round(temperatureValue || 0)}°C`;

    row.append(time, periodLabel, condition, rain, temperature);
    elements.hourlyList.append(row);
    if (period === 'current') currentRow = row;
  }

  if (currentRow) {
    requestAnimationFrame(() => {
      const listRect = elements.hourlyList.getBoundingClientRect();
      const rowRect = currentRow.getBoundingClientRect();
      const offset = rowRect.top
        - listRect.top
        - (listRect.height - rowRect.height) / 2;
      elements.hourlyList.scrollTop = Math.max(0, elements.hourlyList.scrollTop + offset);
    });
  }
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
  const syncSequence = ++state.syncSequence;
  setMode('auto', { reapply: false });
  setPhase('loading');
  elements.statusText.textContent = loadingMessage;
  setEditorStatus(loadingMessage, 'loading');
  renderHourlyForecast(null, 'loading');
  elements.relocate.disabled = true;
  state.error = '';
  try {
    const response = await desktop.fetchWeather(request);
    if (!response?.ok) throw new Error(response?.error || '天气服务暂时不可用。');
    if (syncSequence !== state.syncSequence) return null;
    state.weather = response.weather;
    if (state.mode === 'auto') rainform.applyRainfallData(response.weather.rainfall, 'auto');
    setPhase('success');
    elements.root.dataset.weatherProvider = response.weather.provider;
    elements.root.dataset.weatherCity = displayCity(response.weather);
    elements.root.dataset.currentPrecipitation = String(response.weather.current.precipitation);
    elements.root.dataset.currentVisualPrecipitation = String(
      response.weather.current.visualPrecipitation ?? response.weather.current.precipitation
    );
    elements.root.dataset.weatherForecastProvider = response.weather.forecastProvider || response.weather.provider;
    elements.root.dataset.weatherStation = response.weather.station?.id || '';
    elements.root.dataset.weatherAlert = response.weather.alert?.label || '';
    elements.editorLocation.textContent = displayCity(response.weather);
    elements.editorSummary.textContent = `${response.weather.current.weatherText} · ${Math.round(response.weather.current.temperature)}°C · ${providerLabel(response.weather)}`;
    renderHourlyForecast(response.weather);
    const stationText = response.weather.station
      ? ` · ${response.weather.station.name}站 ${response.weather.station.distanceKm.toFixed(1)} km`
      : '';
    const alertText = response.weather.alert?.label ? ` · ${response.weather.alert.label}` : '';
    const forecastFallbackText = response.weather.forecastFallback
      ? ' · 逐小时预报暂不可用，已保留当前实况'
      : '';
    setEditorStatus(
      `同步成功 · ${providerLabel(response.weather)}${stationText}${alertText} · 实况 ${sourceUpdateLabel(response.weather)}${forecastFallbackText}`,
      'success'
    );
    state.completedSyncSequence = syncSequence;
    renderStatus();
    showStatus();
    return response.weather;
  } catch (error) {
    if (syncSequence !== state.syncSequence) return null;
    state.error = `天气同步失败 · ${error instanceof Error ? error.message : '请稍后重试'} · 可使用手动模式`;
    state.completedSyncSequence = syncSequence;
    setPhase('error');
    elements.statusText.textContent = state.error;
    setEditorStatus(state.error, 'error');
    renderHourlyForecast(null, 'error');
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
  renderHourlyForecast(null, 'loading', '定位后显示后续逐小时天气…');
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
    renderHourlyForecast(null, 'error');
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
    forecastProvider: state.weather?.forecastProvider || '',
    station: state.weather?.station || null,
    alert: state.weather?.alert || null,
    current: state.weather?.current || null,
    statusHidden: state.statusHidden,
    syncSequence: state.syncSequence,
    completedSyncSequence: state.completedSyncSequence,
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
