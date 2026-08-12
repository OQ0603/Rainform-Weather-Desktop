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

test('Moji severe-rain condition drives the current visual even when hourly qpf is light', async () => {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    requests.push({ href, init });
    if (href.endsWith('/condition')) {
      return jsonResponse({
        code: 0,
        data: {
          city: { name: '上海市', pname: '上海市', ianatimezone: 'Asia/Shanghai' },
          condition: {
            condition: '大暴雨',
            conditionId: '56',
            temp: '26',
            humidity: '88',
            updatetime: '2026-08-01 14:10:00'
          }
        },
        msg: 'success'
      });
    }
    if (href.endsWith('/forecast24hours')) {
      return jsonResponse({
        code: 0,
        data: {
          hourly: [
            { date: '2026-08-01', hour: '14', qpf: '0.2', temp: '26', condition: '小雨', conditionId: '51' },
            { date: '2026-08-02', hour: '0', qpf: '0', temp: '25', condition: '阴', conditionId: '13' }
          ]
        },
        msg: 'success'
      });
    }
    throw new Error(`Unexpected URL ${href}`);
  };

  const weather = await fetchWeather({
    latitude: 31.2304,
    longitude: 121.4737,
    city: '上海',
    source: 'search'
  }, {
    fetchImpl,
    mojiAppCode: 'test-appcode-secret',
    mojiConditionToken: 'test-condition-secret',
    mojiForecastToken: 'test-forecast-secret'
  });

  assert.equal(weather.provider, 'moji');
  assert.equal(weather.current.weatherText, '大暴雨');
  assert.equal(weather.current.precipitation, 0, 'do not invent a measured mm/h value');
  assert.equal(weather.current.visualPrecipitation, 50);
  assert.equal(weather.current.precipitationEstimated, true);
  assert.equal(weather.rainfall[14], 50, 'current Moji condition must override a light hourly qpf visually');
  assert.equal(weather.rainfall[24], 0);

  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.init.method === 'POST'));
  assert.ok(requests.every(request => request.init.headers.Authorization === 'APPCODE test-appcode-secret'));
  assert.equal(requests[0].init.body.get('lat'), '31.23040000');
  assert.equal(requests[0].init.body.get('lon'), '121.47370000');
  assert.equal(requests[0].init.body.get('token'), 'test-condition-secret');
  assert.equal(requests[1].init.body.get('token'), 'test-forecast-secret');
  assert.doesNotMatch(JSON.stringify(weather), /test-(?:appcode|condition|forecast)-secret/);
});

test('Moji condition severity follows official rain levels', () => {
  assert.equal(weatherInternals.mojiRainFloor('毛毛细雨', 0), 0.5);
  assert.equal(weatherInternals.mojiRainFloor('小雨', 51), 1);
  assert.equal(weatherInternals.mojiRainFloor('大雨', 54), 10);
  assert.equal(weatherInternals.mojiRainFloor('暴雨', 55), 25);
  assert.equal(weatherInternals.mojiRainFloor('大暴雨', 56), 50);
  assert.equal(weatherInternals.mojiRainFloor('特大暴雨', 57), 80);
  assert.equal(weatherInternals.mojiRainFloor('阴', 13), 0);
});

test('CMA nearest live station overrides a stale light-rain forecast during a rain alert', async () => {
  const requests = [];
  const fetchImpl = async url => {
    const href = String(url);
    requests.push(href);
    if (href.startsWith('https://weather.cma.cn/api/map/weather/1')) {
      return jsonResponse({
        msg: 'success',
        code: 0,
        data: {
          city: [
            ['54900', '濮阳', '中国', 3, 35.7, 115.03, 26, '大雨', 9, '北风', '微风', 22, '中雨', 8, '北风', '微风', 'AHA', '410900'],
            ['58367', '上海', '中国', 2, 31.4, 121.45, 32, '多云', 1, '东风', '微风', 26, '阴', 2, '东风', '微风', 'ASH', '310000']
          ]
        }
      });
    }
    if (href.startsWith('https://weather.cma.cn/api/weather/view?stationid=54900')) {
      return jsonResponse({
        msg: 'success',
        code: 0,
        data: {
          location: { id: '54900', name: '濮阳', path: '中国, 河南, 濮阳' },
          daily: [{ dayText: '大雨', dayCode: 9, nightText: '中雨', nightCode: 8 }],
          now: { precipitation: 2.6, temperature: 23.1, humidity: 94 },
          alarm: [{ title: '濮阳市气象台发布暴雨蓝色预警', signaltype: '暴雨', signallevel: '蓝色', severity: 'BLUE' }],
          lastUpdate: '2026/08/12 10:05'
        }
      });
    }
    if (href.startsWith('https://api.open-meteo.com/')) return jsonResponse(openMeteoPayload());
    throw new Error(`Unexpected URL ${href}`);
  };

  const weather = await fetchWeather({
    latitude: 35.7619,
    longitude: 115.0293,
    city: '濮阳',
    source: 'system'
  }, {
    fetchImpl,
    mojiToken: '',
    mojiPassword: ''
  });

  assert.equal(weather.provider, 'cma');
  assert.equal(weather.forecastProvider, 'cma-trend+open-meteo');
  assert.equal(weather.station.id, '54900');
  assert.ok(weather.station.distanceKm < 10);
  assert.equal(weather.current.precipitation, 2.6);
  assert.equal(weather.current.visualPrecipitation, 25, 'rain alert must drive a visibly heavy scene');
  assert.equal(weather.current.precipitationEstimated, true);
  assert.equal(weather.current.weatherText, '大雨');
  assert.equal(weather.alert.label, '暴雨蓝色预警');
  assert.equal(weather.rainfall[10], 25);
  assert.equal(weather.rainfall[14], 10, 'CMA daytime heavy-rain trend must prevent a drizzle forecast');
  assert.equal(weather.rainfall[20], 4, 'CMA nighttime moderate-rain trend must remain visible');
  assert.equal(weather.hourly[14].weatherText, '大雨');
  assert.equal(weather.hourly[14].rawPrecipitation, 0);
  assert.equal(weather.hourly[14].precipitationEstimated, true);
  assert.equal(weather.forecastTrend.dayText, '大雨');
  assert.equal(weather.forecastTrend.nightText, '中雨');
  assert.ok(requests.some(href => href.includes('/api/map/weather/1')));
  assert.ok(requests.some(href => href.includes('stationid=54900')));
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
