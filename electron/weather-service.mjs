// Weather providers run only in Electron's main process. Never import this file
// from renderer code: Moji credentials are read here and never cross the IPC bridge.

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const MOJI_API_BASE_URL = 'https://finaljwd.market.alicloudapi.com';
const MOJI_CONDITION_PATH = '/whapi/json/aliweather/condition';
const MOJI_FORECAST_PATH = '/whapi/json/aliweather/forecast24hours';

const WEATHER_CODE_TEXT = Object.freeze({
  0: '晴',
  1: '大部晴朗',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '较强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '米雪',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷雨',
  96: '雷雨伴小冰雹',
  99: '雷雨伴强冰雹'
});

export class WeatherServiceError extends Error {
  constructor(message, code = 'WEATHER_UNAVAILABLE', cause) {
    super(message, { cause });
    this.name = 'WeatherServiceError';
    this.code = code;
  }
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function precipitation(value) {
  return Math.max(0, Math.round(finiteNumber(value) * 10) / 10);
}

function cleanLocationName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : '';
}

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new WeatherServiceError('定位坐标无效，请重新定位或搜索城市。', 'INVALID_COORDINATES');
  }
  return { latitude: lat, longitude: lon };
}

async function fetchJson(url, {
  fetchImpl = fetch,
  timeoutMs = 8000,
  headers = {},
  method = 'GET',
  body
} = {}) {
  let response;
  let lastNetworkError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok || response.status < 500 || attempt === 1) break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt === 1) {
        throw new WeatherServiceError('网络连接失败或请求超时。', 'NETWORK_ERROR', error);
      }
    }
  }
  if (!response) throw new WeatherServiceError('网络连接失败或请求超时。', 'NETWORK_ERROR', lastNetworkError);
  if (!response.ok) {
    throw new WeatherServiceError(`天气服务返回 ${response.status}。`, 'HTTP_ERROR');
  }
  try {
    return await response.json();
  } catch (error) {
    throw new WeatherServiceError('天气服务返回了无法读取的数据。', 'INVALID_RESPONSE', error);
  }
}

export async function searchCities(query, options = {}) {
  const normalized = String(query || '').trim().slice(0, 80);
  if (normalized.length < 2) return [];
  const params = new URLSearchParams({
    name: normalized,
    count: '10',
    language: 'zh',
    format: 'json'
  });
  const payload = await fetchJson(`${OPEN_METEO_GEOCODING_URL}?${params}`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 6000
  });
  return (payload.results || [])
    .filter(item => item?.name && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
    .map(item => {
      const name = cleanLocationName(item.name);
      const region = cleanLocationName(item.admin1);
      const district = cleanLocationName(item.admin2 || item.admin3);
      const country = cleanLocationName(item.country);
      const parts = [region, district, name].filter((part, index, all) => part && all.indexOf(part) === index);
      return {
        id: String(item.id ?? `${item.latitude},${item.longitude}`),
        name,
        label: parts.join(' · ') || name,
        region,
        country,
        latitude: Number(item.latitude),
        longitude: Number(item.longitude),
        timezone: item.timezone || ''
      };
    });
}

export async function reverseGeocode(latitude, longitude, options = {}) {
  const coordinates = validateCoordinates(latitude, longitude);
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
    localityLanguage: 'zh'
  });
  try {
    const payload = await fetchJson(`${REVERSE_GEOCODING_URL}?${params}`, {
      ...options,
      timeoutMs: options.timeoutMs ?? 5000
    });
    const locality = cleanLocationName(payload.city || payload.locality || payload.localityInfo?.administrative?.at(-1)?.name);
    return {
      city: locality,
      region: cleanLocationName(payload.principalSubdivision),
      country: cleanLocationName(payload.countryName)
    };
  } catch {
    return { city: '', region: '', country: '' };
  }
}

function openMeteoTimeline(payload) {
  const times = Array.isArray(payload.hourly?.time) ? payload.hourly.time : [];
  if (!times.length) throw new WeatherServiceError('逐小时天气数据不完整。', 'INVALID_RESPONSE');
  const currentTime = String(payload.current?.time || times[0]);
  const localDate = currentTime.slice(0, 10);
  let startIndex = times.findIndex(time => String(time).startsWith(`${localDate}T00:`));
  if (startIndex < 0) startIndex = 0;
  const hourly = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    const index = startIndex + hour;
    hourly.push({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      time: times[index] || '',
      precipitation: precipitation(payload.hourly?.precipitation?.[index]),
      temperature: finiteNumber(payload.hourly?.temperature_2m?.[index], finiteNumber(payload.current?.temperature_2m)),
      weatherCode: finiteNumber(payload.hourly?.weather_code?.[index], finiteNumber(payload.current?.weather_code))
    });
  }
  const currentHour = Number(currentTime.slice(11, 13));
  if (Number.isInteger(currentHour) && currentHour >= 0 && currentHour <= 23) {
    hourly[currentHour].precipitation = precipitation(Math.max(
      hourly[currentHour].precipitation,
      finiteNumber(payload.current?.precipitation),
      finiteNumber(payload.current?.rain),
      finiteNumber(payload.current?.showers)
    ));
  }
  return hourly;
}

async function fetchOpenMeteo(latitude, longitude, options = {}) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code',
    hourly: 'precipitation,temperature_2m,weather_code',
    forecast_days: '2',
    timezone: 'auto',
    precipitation_unit: 'mm'
  });
  const payload = await fetchJson(`${OPEN_METEO_FORECAST_URL}?${params}`, options);
  if (!payload.current || !payload.hourly) {
    throw new WeatherServiceError('实时天气数据不完整。', 'INVALID_RESPONSE');
  }
  const weatherCode = finiteNumber(payload.current.weather_code);
  const hourly = openMeteoTimeline(payload);
  return {
    provider: 'open-meteo',
    updatedAt: new Date().toISOString(),
    timezone: payload.timezone || '',
    current: {
      precipitation: precipitation(Math.max(
        finiteNumber(payload.current.precipitation),
        finiteNumber(payload.current.rain),
        finiteNumber(payload.current.showers)
      )),
      visualPrecipitation: precipitation(Math.max(
        finiteNumber(payload.current.precipitation),
        finiteNumber(payload.current.rain),
        finiteNumber(payload.current.showers)
      )),
      precipitationEstimated: false,
      temperature: Math.round(finiteNumber(payload.current.temperature_2m)),
      humidity: Math.round(finiteNumber(payload.current.relative_humidity_2m)),
      weatherCode,
      weatherText: WEATHER_CODE_TEXT[weatherCode] || '实时天气'
    },
    hourly,
    rainfall: hourly.map(item => item.precipitation)
  };
}

function mojiRainFloor(conditionText, conditionId) {
  const text = String(conditionText || '');
  const id = Number(conditionId);
  const textFloors = [
    ['特大暴雨', 80],
    ['大暴雨', 50],
    ['大到暴雨', 25],
    ['暴雨', 25],
    ['强阵雨', 15],
    ['中到大雨', 8],
    ['大雨', 10],
    ['雷阵雨', 6],
    ['中雨', 4],
    ['小到中雨', 2],
    ['阵雨', 2],
    ['小雨', 1],
    ['毛毛', 0.5],
    ['细雨', 0.5],
    ['雨', 2]
  ];
  const byText = textFloors.find(([label]) => text.includes(label));
  if (byText) return byText[1];

  if (id === 57) return 80;
  if ([56, 69, 70].includes(id)) return 50;
  if ([55, 93].includes(id)) return 25;
  if (id === 23) return 15;
  if ([54, 68, 92].includes(id)) return 10;
  if ([37, 38, 39, 40, 41, 44, 45, 87, 88, 89, 90].includes(id)) return 6;
  if ([53, 67].includes(id)) return 4;
  if ([15, 16, 17, 18, 19, 20, 21, 22, 78, 86].includes(id)) return 2;
  if ([51, 52, 66, 91].includes(id)) return 1;
  return 0;
}

function mojiCurrentRain(current) {
  const measured = precipitation(Math.max(
    finiteNumber(current?.precip_1h),
    finiteNumber(current?.precipitation),
    finiteNumber(current?.rainfall),
    finiteNumber(current?.rain)
  ));
  const visual = precipitation(Math.max(
    measured,
    mojiRainFloor(current?.condition ?? current?.weather, current?.conditionId ?? current?.weather_id)
  ));
  return {
    measured,
    visual,
    estimated: visual > measured
  };
}

function mojiCurrentHour(current) {
  const value = String(current?.updatetime || current?.obs_time || '');
  const match = value.match(/(?:T|\s)(\d{1,2}):/);
  if (match) return Number(match[1]);
  return new Date().getHours();
}

function normalizeMojiHourly(items, current) {
  const result = Array.from({ length: 25 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    time: '',
    precipitation: 0,
    temperature: finiteNumber(current?.temp),
    weatherCode: finiteNumber(current?.conditionId ?? current?.weather_id),
    weatherText: String(current?.condition ?? current?.weather ?? '')
  }));
  const source = Array.isArray(items) ? items : [];
  const currentDate = String(current?.updatetime || current?.obs_time || '').slice(0, 10);
  const firstDate = String(source.find(item => item?.date)?.date || '');
  const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(currentDate) ? currentDate : firstDate;
  const nextDayMidnight = source.find(item => String(item?.date || '') !== targetDate && Number(item?.hour) === 0);
  for (const item of source) {
    if (targetDate && item?.date && String(item.date) !== targetDate) continue;
    const time = String(item.predict_time || item.time || (item.date ? `${item.date} ${String(item.hour).padStart(2, '0')}:00` : ''));
    const match = time.match(/(?:T|\s)(\d{1,2}):/);
    const hour = match ? Number(match[1]) : Number(item.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    result[hour] = {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      time,
      precipitation: precipitation(item.qpf ?? item.precipitation),
      temperature: finiteNumber(item.temp ?? item.temperature, finiteNumber(current?.temp)),
      weatherCode: finiteNumber(item.conditionId ?? item.weather_id ?? item.weatherCode, finiteNumber(current?.conditionId ?? current?.weather_id)),
      weatherText: String(item.condition ?? item.weather ?? current?.condition ?? current?.weather ?? '')
    };
  }
  result[24] = nextDayMidnight
    ? {
        hour: 24,
        label: '24:00',
        time: `${nextDayMidnight.date} 00:00`,
        precipitation: precipitation(nextDayMidnight.qpf ?? nextDayMidnight.precipitation),
        temperature: finiteNumber(nextDayMidnight.temp ?? nextDayMidnight.temperature, finiteNumber(current?.temp)),
        weatherCode: finiteNumber(nextDayMidnight.conditionId ?? nextDayMidnight.weather_id ?? nextDayMidnight.weatherCode),
        weatherText: String(nextDayMidnight.condition ?? nextDayMidnight.weather ?? '')
      }
    : { ...result[0], hour: 24, label: '24:00' };
  return result;
}

async function fetchMojiEndpoint(path, token, latitude, longitude, appCode, options) {
  const body = new URLSearchParams({
    lat: Number(latitude).toFixed(8),
    lon: Number(longitude).toFixed(8),
    token
  });
  return await fetchJson(`${MOJI_API_BASE_URL}${path}`, {
    ...options,
    method: 'POST',
    body,
    headers: {
      ...options.headers,
      Authorization: `APPCODE ${appCode}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
    }
  });
}

async function fetchMoji(latitude, longitude, options = {}) {
  // MOJI_WEATHER_PASSWORD remains a compatibility alias for existing installs.
  // In Alibaba Cloud Marketplace terminology it must contain the APPCode.
  const appCode = options.mojiAppCode
    ?? process.env.MOJI_WEATHER_APPCODE
    ?? options.mojiPassword
    ?? process.env.MOJI_WEATHER_PASSWORD;
  const sharedToken = options.mojiToken ?? process.env.MOJI_WEATHER_TOKEN;
  const conditionToken = options.mojiConditionToken ?? process.env.MOJI_WEATHER_CONDITION_TOKEN ?? sharedToken;
  const forecastToken = options.mojiForecastToken ?? process.env.MOJI_WEATHER_FORECAST_TOKEN ?? sharedToken;
  if (!appCode || !conditionToken) return null;

  const conditionPayload = await fetchMojiEndpoint(
    MOJI_CONDITION_PATH,
    conditionToken,
    latitude,
    longitude,
    appCode,
    options
  );
  if (Number(conditionPayload.code) !== 0 || !conditionPayload.data?.condition) {
    throw new WeatherServiceError(conditionPayload.msg || '墨迹天气实况暂时不可用。', 'MOJI_ERROR');
  }

  const current = conditionPayload.data.condition;
  let hourly;
  let forecastProvider = 'moji';
  let forecastFallbackReason = '';
  if (forecastToken) {
    try {
      const forecastPayload = await fetchMojiEndpoint(
        MOJI_FORECAST_PATH,
        forecastToken,
        latitude,
        longitude,
        appCode,
        options
      );
      if (Number(forecastPayload.code) !== 0 || !Array.isArray(forecastPayload.data?.hourly)) {
        throw new WeatherServiceError(forecastPayload.msg || '墨迹天气逐小时预报暂时不可用。', 'MOJI_ERROR');
      }
      hourly = normalizeMojiHourly(forecastPayload.data.hourly, current);
    } catch (error) {
      forecastFallbackReason = error instanceof Error ? error.message : '墨迹天气逐小时预报请求失败';
    }
  } else {
    forecastFallbackReason = '未配置墨迹天气逐小时预报 token';
  }

  if (!hourly) {
    const openMeteo = await fetchOpenMeteo(latitude, longitude, options);
    hourly = openMeteo.hourly;
    forecastProvider = 'open-meteo';
  }

  const rain = mojiCurrentRain(current);
  const currentHour = mojiCurrentHour(current);
  if (Number.isInteger(currentHour) && currentHour >= 0 && currentHour <= 23) {
    hourly[currentHour].precipitation = precipitation(Math.max(
      hourly[currentHour].precipitation,
      rain.visual
    ));
    hourly[currentHour].weatherCode = finiteNumber(current.conditionId);
    hourly[currentHour].weatherText = String(current.condition || '');
  }
  const city = conditionPayload.data.city || {};
  return {
    provider: 'moji',
    forecastProvider,
    city: cleanLocationName(city.name || city.pname),
    region: cleanLocationName(city.pname || city.secondaryname),
    updatedAt: current.updatetime || current.obs_time || new Date().toISOString(),
    timezone: city.ianatimezone || '',
    current: {
      precipitation: rain.measured,
      visualPrecipitation: rain.visual,
      precipitationEstimated: rain.estimated,
      temperature: Math.round(finiteNumber(current.temp)),
      humidity: Math.round(finiteNumber(current.humidity)),
      weatherCode: finiteNumber(current.conditionId ?? current.weather_id),
      weatherText: current.condition || current.weather || '实时天气'
    },
    hourly,
    rainfall: hourly.map(item => item.precipitation),
    forecastFallback: forecastProvider === 'open-meteo'
      ? { from: 'moji', reason: forecastFallbackReason }
      : null
  };
}

export async function fetchWeather(request, options = {}) {
  const { latitude, longitude } = validateCoordinates(request?.latitude, request?.longitude);
  const requestedCity = cleanLocationName(request?.city);
  const requestedRegion = cleanLocationName(request?.region);
  let weather;
  let mojiFallbackReason = '';
  try {
    weather = await fetchMoji(latitude, longitude, options);
  } catch (error) {
    mojiFallbackReason = error instanceof Error ? error.message : '墨迹天气请求失败';
  }
  if (!weather && !mojiFallbackReason) mojiFallbackReason = '未配置墨迹天气凭据';
  if (!weather) weather = await fetchOpenMeteo(latitude, longitude, options);

  const reverse = requestedCity || weather.city
    ? { city: '', region: '', country: '' }
    : await reverseGeocode(latitude, longitude, options);
  const city = requestedCity || cleanLocationName(weather.city) || reverse.city || '当前位置';
  const region = requestedRegion || cleanLocationName(weather.region) || reverse.region;

  return {
    ...weather,
    city,
    region,
    country: reverse.country,
    latitude,
    longitude,
    locationSource: request?.source === 'search' ? 'search' : 'system',
    fallback: weather.provider === 'open-meteo' && Boolean(mojiFallbackReason)
      ? { from: 'moji', reason: mojiFallbackReason }
      : null
  };
}

export const weatherInternals = Object.freeze({
  openMeteoTimeline,
  normalizeMojiHourly,
  mojiRainFloor,
  mojiCurrentRain,
  precipitation,
  WEATHER_CODE_TEXT
});
