import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchWeather,
  searchCities,
  weatherInternals
} from '../electron/weather-service.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function openMeteoPayload() {
  const time = [];
  const precipitation = [];
  const temperature = [];
  const weatherCode = [];
  for (let day = 1; day <= 2; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      time.push(`2026-08-0${day}T${String(hour).padStart(2, '0')}:00`);
      precipitation.push(hour === 13 && day === 1 ? 0.2 : 0);
      temperature.push(26);
      weatherCode.push(3);
    }
  }
  return {
    timezone: 'Asia/Shanghai',
    current: {
      time: '2026-08-01T13:30',
      temperature_2m: 26.2,
      relative_humidity_2m: 71,
      precipitation: 0.4,
      rain: 0.4,
      showers: 0,
      weather_code: 61
    },
    hourly: {
      time,
      precipitation,
      temperature_2m: temperature,
      weather_code: weatherCode
    }
  };
}

test('Open-Meteo data becomes exactly 25 points from 00:00 through 24:00', () => {
  const timeline = weatherInternals.openMeteoTimeline(openMeteoPayload());
  assert.equal(timeline.length, 25);
  assert.equal(timeline[0].label, '00:00');
  assert.equal(timeline[24].label, '24:00');
  assert.equal(timeline[13].precipitation, 0.4, 'current rain must be represented visually');
});

test('Moji hourly values are normalized without exposing credentials', () => {
  const timeline = weatherInternals.normalizeMojiHourly([
    { predict_time: '2026-08-01 06:00', qpf: 1.24, temp: 22, weather_id: 61 }
  ], { temp: 21, weather_id: 3 });
  assert.equal(timeline.length, 25);
  assert.equal(timeline[6].precipitation, 1.2);
  assert.equal(timeline[24].label, '24:00');
});

test('weather falls back to Open-Meteo and reverse resolves the city', async () => {
  const fetchImpl = async url => {
    const href = String(url);
    if (href.startsWith('https://api.open-meteo.com/')) return jsonResponse(openMeteoPayload());
    if (href.startsWith('https://api.bigdatacloud.net/')) {
      return jsonResponse({ city: '上海', principalSubdivision: '上海市', countryName: '中国' });
    }
    throw new Error(`Unexpected URL ${href}`);
  };
  const weather = await fetchWeather({ latitude: 31.2304, longitude: 121.4737 }, {
    fetchImpl,
    mojiToken: '',
    mojiPassword: ''
  });
  assert.equal(weather.provider, 'open-meteo');
  assert.equal(weather.city, '上海');
  assert.equal(weather.rainfall.length, 25);
  assert.equal(weather.current.weatherText, '小雨');
});

test('city search returns safe structured candidates', async () => {
  const fetchImpl = async () => jsonResponse({
    results: [{
      id: 1796236,
      name: '上海',
      latitude: 31.22222,
      longitude: 121.45806,
      admin1: '上海市',
      country: '中国',
      timezone: 'Asia/Shanghai'
    }]
  });
  const results = await searchCities('上海', { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].name, '上海');
  assert.equal(results[0].country, '中国');
});
