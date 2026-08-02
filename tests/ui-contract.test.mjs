import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, main, controller, electronMain, packageJsonText] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('src/main.js', 'utf8'),
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
});

test('weather status is independent and duplicate rainfall readouts are absent', () => {
  const statusPosition = html.indexOf('id="weather-status"');
  const editorStart = html.indexOf('id="rainfall-editor"');
  const editorEnd = html.indexOf('</aside>', editorStart);
  assert.ok(statusPosition > 0 && (statusPosition < editorStart || statusPosition > editorEnd));
  assert.doesNotMatch(html, /rainfall-chart-readout/);
  assert.match(html, /id="weather-selection-text"/);
  assert.match(controller, /if \(raw === '当前位置'\) return raw/);
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
  assert.doesNotMatch(controller, /MOJI_WEATHER_(?:TOKEN|PASSWORD)|process\.env/);
  assert.match(controller, /desktop\.fetchWeather/);
  assert.match(html, /connect-src 'none'/);
});
