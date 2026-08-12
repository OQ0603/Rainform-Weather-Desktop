import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const resultDirectory = path.join(root, 'test-results');
await mkdir(resultDirectory, { recursive: true });
const latitude = process.env.RAINFORM_WEATHER_CHINA_LATITUDE || '35.7619';
const longitude = process.env.RAINFORM_WEATHER_CHINA_LONGITUDE || '115.0293';
const city = process.env.RAINFORM_WEATHER_CHINA_CITY || '濮阳';
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
  await page.waitForFunction(() => window.__rainformWeatherDebug?.getState().phase === 'success', null, { timeout: 40_000 });
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
    pastRainRows: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="past"] .has-rain').length,
    currentHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="current"]').length,
    futureHours: document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="future"]').length,
    currentRow: document.querySelector('#weather-hourly-list .weather-hourly-row[data-period="current"]')?.textContent.replace(/\s+/g, ' ').trim() || '',
    pastPreview: [...document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="past"]')]
      .filter(row => row.querySelector('.has-rain'))
      .slice(-4)
      .map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    futurePreview: [...document.querySelectorAll('#weather-hourly-list .weather-hourly-row[data-period="future"]')]
      .slice(0, 4)
      .map(row => row.textContent.replace(/\s+/g, ' ').trim()),
    provider: document.querySelector('#scene-root')?.dataset.weatherProvider || '',
    visualPrecipitation: Number(document.querySelector('#scene-root')?.dataset.currentVisualPrecipitation || 0)
  }));

  assert.equal(evidence.provider, 'weather-china');
  assert.equal(evidence.weather.provider, 'weather-china');
  assert.equal(evidence.weather.forecastProvider, 'weather-china');
  assert.match(evidence.weather.city, /华龙/);
  assert.equal(evidence.weather.station?.id, '101181306');
  assert.equal(evidence.weather.sourceUrl, 'https://www.weather.com.cn/weather/101181306.shtml');
  assert.match(evidence.summary, /中国天气网实况/);
  assert.match(evidence.syncStatus, /中国天气网实况/);
  assert.match(evidence.hourlySource, /中国天气网/);
  assert.equal(evidence.allDayHours, 25);
  assert.ok(evidence.pastHours > 0);
  assert.ok(evidence.pastRainRows > 0, 'the live page must contribute observed past rainfall rows');
  assert.equal(evidence.currentHours, 1);
  assert.ok(evidence.futureHours > 0);
  assert.ok(evidence.pastPreview.every(item => /mm\/h/.test(item)));
  assert.ok(evidence.futurePreview.every(item => /中国天气网预报/.test(item)));
  assert.doesNotMatch(`${evidence.hourlySource} ${evidence.futurePreview.join(' ')}`, /Open-Meteo|气象局趋势/);
  assert.equal(evidence.visualPrecipitation, Number(evidence.weather.current?.precipitation || 0));
  if (Number(evidence.weather.current?.precipitation || 0) === 0) {
    const soundButton = page.locator('#rain-sound-toggle');
    if (await soundButton.getAttribute('aria-pressed') !== 'true') await soundButton.click();
    await page.waitForFunction(() => document.querySelector('#scene-root')?.dataset.rainSoundLoaded === 'true', null, { timeout: 10_000 });
    const audioState = await page.evaluate(() => window.rainform.getDebugState());
    assert.equal(audioState.liveRainfall, 0);
    assert.equal(audioState.soundGain, 0, 'current observed no-rain must silence audio even when future rain is forecast');
    await soundButton.click();
  }

  await page.screenshot({ path: path.join(resultDirectory, 'weather-china-hualong-live.png') });
  await writeFile(
    path.join(resultDirectory, 'weather-china-hualong-live.json'),
    JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), ...evidence }, null, 2)
  );
  console.log(JSON.stringify(evidence, null, 2));
  console.log('China Weather Hualong live desktop smoke passed.');
} finally {
  await application?.close();
}
