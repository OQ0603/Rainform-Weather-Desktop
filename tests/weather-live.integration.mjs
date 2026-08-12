import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWeather, searchCities } from '../electron/weather-service.mjs';

test('live Shanghai search with China Weather observations and forecast', { timeout: 45_000 }, async () => {
  const results = await searchCities('上海', { timeoutMs: 12_000 });
  const shanghai = results.find(item => item.name.includes('上海'));
  assert.ok(shanghai, '上海 must appear in Open-Meteo city candidates');
  const weather = await fetchWeather({
    latitude: shanghai.latitude,
    longitude: shanghai.longitude,
    city: shanghai.name,
    region: shanghai.region,
    source: 'search'
  }, {
    timeoutMs: 12_000,
    mojiToken: '',
    mojiPassword: ''
  });
  assert.equal(weather.provider, 'weather-china');
  assert.equal(weather.forecastProvider, 'weather-china');
  assert.match(weather.station?.id || '', /^\d{9}$/, 'a China Weather city code must be selected');
  assert.ok(weather.sourceUrl?.startsWith('https://www.weather.com.cn/weather/'));
  assert.equal(weather.city, '上海');
  assert.equal(weather.rainfall.length, 25);
  assert.ok(weather.rainfall.every(value => Number.isFinite(value) && value >= 0));
});
