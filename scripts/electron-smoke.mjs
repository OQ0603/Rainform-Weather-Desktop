import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const resultDirectory = path.join(root, 'test-results');
await mkdir(resultDirectory, { recursive: true });
const startedAt = new Date().toISOString();
const checks = [];
const record = (name, details = '') => checks.push({ name, status: 'passed', details });
const packagedExecutable = process.env.RAINFORM_SMOKE_EXECUTABLE
  ? path.resolve(process.env.RAINFORM_SMOKE_EXECUTABLE)
  : '';
let application;
let page;

try {
  application = await electron.launch({
    ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
    args: packagedExecutable ? [] : ['.'],
    cwd: packagedExecutable ? path.dirname(packagedExecutable) : root,
    env: {
      ...process.env,
      RAINFORM_E2E: '1',
      RAINFORM_E2E_GEO: '31.2304,121.4737',
      RAINFORM_E2E_CITY: '上海',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });
  page = await application.firstWindow();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.waitForFunction(() => window.__rainformWeatherDebug?.getState().phase === 'success', null, { timeout: 30_000 });
  await page.waitForSelector('#scene-root[data-webgl-status="ready"]', { timeout: 20_000 });
  const located = await page.evaluate(() => window.__rainformWeatherDebug.getState());
  assert.equal(located.mode, 'auto');
  assert.match(located.city, /上海/);
  assert.equal(located.rainfall.length, 25);
  record(
    'automatic geolocation and weather sync',
    `${located.city} via ${located.provider}${packagedExecutable ? ' (packaged executable)' : ''}`
  );

  assert.equal(await page.locator('#scene-toolbar > button').count(), 2);
  record('toolbar contains two primary controls');

  await page.locator('#rainfall-editor-toggle').click();
  await page.locator('#weather-relocate').click();
  await page.waitForFunction(() => window.__rainformWeatherDebug?.getState().phase === 'success', null, { timeout: 30_000 });
  record('relocate and sync button');

  await page.locator('#city-search-input').fill('上海');
  await page.waitForSelector('.city-search-result[data-city*="上海"]', { timeout: 20_000 });
  const candidateCount = await page.locator('.city-search-result').count();
  assert.ok(candidateCount > 0);
  const citySyncSequence = (await page.evaluate(() => window.__rainformWeatherDebug.getState())).syncSequence;
  await page.locator('.city-search-result[data-city*="上海"]').first().click();
  await page.waitForFunction(previousSequence => {
    const current = window.__rainformWeatherDebug?.getState();
    return current?.phase === 'success'
      && current.completedSyncSequence > previousSequence
      && /上海/.test(current.city);
  }, citySyncSequence, { timeout: 30_000 });
  record('Shanghai city search and immediate switch', `${candidateCount} candidates`);
  await page.screenshot({ path: path.join(resultDirectory, 'desktop-auto-panel.png') });

  await page.locator('#rainfall-mode-manual').click();
  assert.equal((await page.evaluate(() => window.__rainformWeatherDebug.getState())).mode, 'manual');
  record('automatic to manual mode switch');

  await page.locator('#rainfall-precise-editor > summary').click();
  await page.locator('#rainfall-hour-0').fill('1.1');
  await page.locator('#rainfall-hour-0').press('Tab');
  await page.waitForFunction(() => window.rainform.getRainfallData()[0] === 1.1);
  await page.locator('.rainfall-chart-point[data-hour="6"]').focus();
  await page.locator('.rainfall-chart-point[data-hour="6"]').press('ArrowUp');
  await page.locator('#weather-selection-text').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.rainfall-chart-readout').count(), 0);
  record('manual input and single status-bar forecast readout');

  await page.evaluate(() => window.rainform.applyRainfallData(Array(25).fill(0), 'manual'));
  const dry = await page.evaluate(() => window.rainform.getDebugState());
  assert.equal(dry.dry, true);
  assert.equal(dry.chainCount, 0);
  assert.equal(dry.pearlCount, 0);
  assert.equal(dry.waterfallFilamentCount, 0);
  assert.equal(dry.activeStormParticles, 0);
  assert.equal(dry.soundGain, 0);
  await page.locator('#rainfall-dry-state').waitFor({ state: 'visible' });
  record('dry state stops rain particles, waterfall and audio');
  await page.screenshot({ path: path.join(resultDirectory, 'desktop-dry-state.png') });

  await page.evaluate(() => window.rainform.applyRainfallData(Array(25).fill(0.5), 'manual'));
  const light = await page.evaluate(() => window.rainform.getDebugState());
  await page.evaluate(() => window.rainform.applyRainfallData(Array(25).fill(15), 'manual'));
  const heavy = await page.evaluate(() => window.rainform.getDebugState());
  assert.ok(light.chainCount > 0);
  assert.ok(heavy.chainCount > light.chainCount);
  assert.ok(heavy.pearlCount > light.pearlCount);
  record('light and heavy rain scale density', `${light.chainCount} -> ${heavy.chainCount} chains`);

  const sound = page.locator('#rain-sound-toggle');
  if (await sound.getAttribute('aria-pressed') === 'true') await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.equal((await page.evaluate(() => window.rainform.getDebugState())).soundGain, 0);
  await sound.click();
  await page.waitForFunction(() => document.querySelector('#scene-root')?.dataset.rainSoundLoaded === 'true' && window.rainform.getDebugState().soundGain > 0, null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  assert.ok((await page.evaluate(() => window.rainform.getDebugState())).soundGain > 0);
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.equal((await page.evaluate(() => window.rainform.getDebugState())).soundGain, 0);
  record('mute and restore sound');

  await page.locator('#weather-status-close').click();
  await page.waitForFunction(() => window.__rainformWeatherDebug.getState().statusHidden === true);
  await page.locator('#scene-toolbar').hover();
  await page.waitForFunction(() => window.__rainformWeatherDebug.getState().statusHidden === false);
  record('status bar closes and wakes from toolbar hover');

  await page.locator('#rainfall-mode-auto').click();
  assert.equal((await page.evaluate(() => window.__rainformWeatherDebug.getState())).mode, 'auto');
  // The close handler immediately starts the panel exit transition; dispatch the
  // semantic click directly so Playwright does not retry after the button hides.
  await page.locator('#rainfall-editor-close').evaluate(button => button.click());
  await page.locator('#weather-status').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#rainfall-editor').getAttribute('aria-hidden'), 'true');
  record('manual to automatic switch and editor-independent status');

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(resultDirectory, 'desktop-smoke.png') });

  const browserWindow = await application.browserWindow(page);
  await browserWindow.evaluate(window => window.setSize(900, 500));
  await page.waitForTimeout(500);
  await page.locator('#rainfall-editor-toggle').click();
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#rainfall-editor').getBoundingClientRect();
    const toolbar = document.querySelector('#scene-toolbar').getBoundingClientRect();
    const status = document.querySelector('#weather-status').getBoundingClientRect();
    const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return {
      panelToolbar: overlap(panel, toolbar),
      panelStatus: overlap(panel, status),
      toolbarStatus: overlap(toolbar, status),
      axisVisibility: document.querySelector('#scene-root').dataset.axisVisibility
    };
  });
  assert.deepEqual(layout, {
    panelToolbar: false,
    panelStatus: false,
    toolbarStatus: false,
    axisVisibility: 'hidden'
  });
  await page.screenshot({ path: path.join(resultDirectory, 'desktop-landscape-900x500.png') });
  record('900x500 landscape panel avoids toolbar and status overlap');

  const relevantErrors = consoleErrors.filter(message => !/favicon|DevTools/.test(message));
  assert.deepEqual(relevantErrors, []);
  record('desktop renderer has no console errors');

  await writeFile(path.join(resultDirectory, 'desktop-smoke.json'), JSON.stringify({
    status: 'passed',
    startedAt,
    finishedAt: new Date().toISOString(),
    checks
  }, null, 2));
  console.log(`Electron desktop smoke passed (${checks.length} checks).`);
} catch (error) {
  const diagnostics = await page?.evaluate(() => ({
    weather: window.__rainformWeatherDebug?.getState?.() || null,
    status: document.querySelector('#weather-status-text')?.textContent || '',
    editorStatus: document.querySelector('#weather-editor-status')?.textContent || '',
    webglStatus: document.querySelector('#scene-root')?.dataset.webglStatus || ''
  })).catch(() => null);
  await writeFile(path.join(resultDirectory, 'desktop-smoke.json'), JSON.stringify({
    status: 'failed',
    startedAt,
    finishedAt: new Date().toISOString(),
    checks,
    diagnostics,
    error: error instanceof Error ? error.stack : String(error)
  }, null, 2));
  throw error;
} finally {
  await application?.close();
}
