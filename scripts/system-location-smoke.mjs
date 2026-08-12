import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const resultDirectory = path.join(root, 'test-results');
const executablePath = process.env.RAINFORM_SYSTEM_LOCATION_EXECUTABLE
  ? path.resolve(process.env.RAINFORM_SYSTEM_LOCATION_EXECUTABLE)
  : '';
assert.ok(executablePath, 'RAINFORM_SYSTEM_LOCATION_EXECUTABLE is required');
await mkdir(resultDirectory, { recursive: true });

let application;
try {
  application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(resultDirectory, 'system-location-profile')}`],
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      RAINFORM_E2E: '',
      RAINFORM_E2E_GEO: '',
      RAINFORM_E2E_CITY: '',
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
    }
  });
  const page = await application.firstWindow();
  await page.waitForFunction(
    () => ['success', 'error'].includes(window.__rainformWeatherDebug?.getState().phase),
    null,
    { timeout: 45_000 }
  );
  const evidence = await page.evaluate(() => ({
    weather: window.__rainformWeatherDebug.getState(),
    status: document.querySelector('#weather-status-text')?.textContent || '',
    syncStatus: document.querySelector('#weather-editor-status')?.textContent || ''
  }));
  await writeFile(
    path.join(resultDirectory, 'system-location-smoke.json'),
    JSON.stringify({ checkedAt: new Date().toISOString(), ...evidence }, null, 2)
  );
  console.log(JSON.stringify(evidence, null, 2));
  assert.equal(evidence.weather.phase, 'success', evidence.status);
  assert.ok(evidence.weather.city);
  assert.ok(evidence.weather.provider);
  console.log('Packaged Windows system-location smoke passed.');
} finally {
  await application?.close();
}
