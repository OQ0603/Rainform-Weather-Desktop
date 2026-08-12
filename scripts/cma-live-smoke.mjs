import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const resultDirectory = path.join(root, 'test-results');
await mkdir(resultDirectory, { recursive: true });
const latitude = process.env.RAINFORM_CMA_LATITUDE || '35.7619';
const longitude = process.env.RAINFORM_CMA_LONGITUDE || '115.0293';
const city = process.env.RAINFORM_CMA_CITY || '濮阳';
let application;

try {
  application = await electron.launch({
    args: ['.'],
    cwd: root,
    env: {
      ...process.env,
      RAINFORM_E2E: '1',
      RAINFORM_E2E_GEO: `${latitude},${longitude}`,
      RAINFORM_E2E_CITY: city,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });
  const page = await application.firstWindow();
  await page.waitForFunction(() => window.__rainformWeatherDebug?.getState().phase === 'success', null, { timeout: 30_000 });
  await page.waitForSelector('#scene-root[data-webgl-status="ready"]', { timeout: 20_000 });
  await page.locator('#rainfall-editor-toggle').click();
  await page.locator('#weather-hourly-list .weather-hourly-row[data-period="current"]').waitFor({ state: 'visible' });
  const evidence = await page.evaluate(() => ({
    weather: window.__rainformWeatherDebug.getState(),
    status: document.querySelector('#weather-status-text')?.textContent || '',
    summary: document.querySelector('#weather-editor-summary')?.textContent || '',
    syncStatus: document.querySelector('#weather-editor-status')?.textContent || '',
    hourlySource: document.querySelector('#weather-hourly-source')?.textContent || '',
    allDayHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row').length,
    pastHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="past"]').length,
    currentHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="current"]').length,
    futureHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="future"]').length,
    futurePreview: [...document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="future"]')]
      .slice(0, 4)
      .map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    provider: document.querySelector('#scene-root')?.dataset.weatherProvider || '',
    visualPrecipitation: Number(document.querySelector('#scene-root')?.dataset.currentVisualPrecipitation || 0)
  }));

  assert.equal(evidence.provider, 'cma');
  assert.equal(evidence.weather.provider, 'cma');
  assert.ok(evidence.weather.city.includes(city));
  assert.ok(evidence.weather.station?.id);
  assert.match(evidence.summary, /中国气象局实况/);
  assert.match(evidence.syncStatus, /实况/);
  assert.match(evidence.hourlySource, /中国气象局趋势/);
  assert.equal(evidence.allDayHours, 25);
  assert.ok(evidence.pastHours > 0);
  assert.equal(evidence.currentHours, 1);
  assert.ok(evidence.futureHours > 0);
  assert.ok(evidence.futurePreview.every(item => /\d{2}:00/.test(item)));
  assert.ok(evidence.futurePreview.some(item => /大雨/.test(item)));
  assert.doesNotMatch(evidence.futurePreview.join(' '), /毛毛雨/);
  assert.ok(evidence.visualPrecipitation >= Number(evidence.weather.current?.precipitation || 0));
  assert.doesNotMatch(evidence.status, /毛毛雨/);

  await page.screenshot({ path: path.join(resultDirectory, 'cma-puyang-live.png') });
  await writeFile(
    path.join(resultDirectory, 'cma-puyang-live.json'),
    JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), ...evidence }, null, 2)
  );
  console.log(JSON.stringify(evidence, null, 2));
  console.log('CMA Puyang live desktop smoke passed.');
} finally {
  await application?.close();
}
