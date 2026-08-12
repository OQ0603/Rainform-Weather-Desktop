import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, main, styles, controller, electronMain, packageJsonText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/styles.css', 'utf8'),
  readFile('src/weather-controller.js', 'utf8'),
  readFile('electron/main.mjs', 'utf8'),
  readFile('package.json', 'utf8')
]);
const packageJson = JSON.parse(packageJsonText);

test('toolbar has exactly the editor and sound controls', () => {
  const toolbar = html.match(/<nav id="scene-toolbar"[\s\S]*?<\/nav>/)?.[0] || '';
  const buttons = [...toolbar.matchAll(/<button\b/g)];
  assert.equal(buttons.length, 2);
  assert.match(toolbar, /id="rainfall-editor-toggle"/);
  assert.match(toolbar, /id="rain-sound-toggle"/);
  assert.doesNotMatch(toolbar, /relocate|定位/);
  assert.doesNotMatch(main, /tuning-(?:toggle|panel)|效果控制台|rf-tuning/);
});

test('weather status is independent and duplicate rainfall readouts are absent', () => {
  const statusPosition = html.indexOf('id="weather-status"');
  const editorStart = html.indexOf('id="rainfall-editor"');
  const editorEnd = html.indexOf('</aside>', editorStart);
  assert.ok(statusPosition > 0 && (statusPosition < editorStart || statusPosition > editorEnd));
  assert.doesNotMatch(html, /rainfall-chart-readout/);
  assert.match(html, /id="weather-selection-text"/);
  assert.match(controller, /if \(raw === '当前位置'\) return raw/);
  assert.match(controller, /visualPrecipitation/);
  assert.match(controller, /正在\$\{condition\.includes\('雨'\)/);
});

test('duplicate world-space readout is removed and drag-only hiding remains', () => {
  assert.doesNotMatch(main, /pulseSceneInteraction|is-scene-interacting/);
  assert.doesNotMatch(main, /createAxisReadoutPanel|drawAxisReadout|axis-dynamic-readout|readoutVisibility/);
  assert.match(main, /Math\.hypot\(dx, dy\) > AXIS_CONFIG\.dragThreshold[\s\S]*?hideAxisForDrag\(\)/);
  assert.match(styles, /\.rainfall-dashboard\.is-dragged \.scene-toolbar/);
});

test('dry data rebuilds zero rain systems and forces sound gain to zero', () => {
  assert.match(main, /dry \? 0 : Math\.max\(1, Math\.round\(QUALITY\.chains/);
  assert.match(main, /dry \|\| !hasPeaks \? 0 : QUALITY\.waterfallFilaments/);
  assert.match(main, /if \(dry\) \{[\s\S]*setRainSoundVolumeImmediately\(0\)/);
  assert.match(main, /rainfallDryState\.hidden = !dry/);
});

test('desktop security and NSIS install choices are configured', () => {
  assert.match(electronMain, /contextIsolation: true/);
  assert.match(electronMain, /nodeIntegration: false/);
  assert.match(electronMain, /permission === 'geolocation'/);
  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
});

test('renderer uses IPC and never reads Moji environment secrets', () => {
  assert.doesNotMatch(controller, /MOJI_WEATHER_|process\.env/);
  assert.match(controller, /desktop\.fetchWeather/);
  assert.match(html, /connect-src 'none'/);
  assert.match(controller, /中国气象局实况 \+ 气象局日夜趋势/);
  assert.match(controller, /weather\.alert\?\.label/);
});

test('automatic mode shows the full day and separates past, current and future hours', () => {
  assert.match(html, /id="weather-hourly-title">全天 00:00–24:00/);
  assert.match(html, /id="weather-hourly-list"/);
  assert.match(controller, /period = hour < currentHour \? 'past' : hour === currentHour \? 'current' : 'future'/);
  assert.match(controller, /period === 'past' \? '较早' : period === 'current' \? '实况' : '未来'/);
  assert.match(controller, /elements\.hourlyList\.scrollTop = Math\.max\(0, elements\.hourlyList\.scrollTop \+ offset\)/);
  assert.match(controller, /Open-Meteo 逐小时预报/);
  assert.match(controller, /中国气象局趋势 · Open-Meteo小时刻度/);
  assert.match(controller, /selectedForecast\?\.precipitationEstimated/);
  assert.match(controller, /rain\.textContent = period === 'future' && item\.precipitationEstimated/);
  assert.match(styles, /\.weather-hourly-row/);
  assert.match(styles, /\.weather-hourly-row\.is-current/);
});

test('a packaged executable has a non-injected Windows location smoke command', () => {
  assert.equal(packageJson.scripts['test:system-location'], 'node scripts/system-location-smoke.mjs');
});
