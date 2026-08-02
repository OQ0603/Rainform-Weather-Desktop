// Weather providers run only in Electron's main process. Never import this file
// from renderer code: MOJI_WEATHER_TOKEN and MOJI_WEATHER_PASSWORD are read here.
import { createHash } from 'node:crypto';

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const MOJI_WEATHER_URL = 'https://coapi.moji.com/whapi/v2/weather';

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

async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 8000, headers = {} } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new WeatherServiceError('网络连接失败或请求超时。', 'NETWORK_ERROR', error);
  }
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
      temperature: Math.round(finiteNumber(payload.current.temperature_2m)),
      humidity: Math.round(finiteNumber(payload.current.relative_humidity_2m)),
      weatherCode,
      weatherText: WEATHER_CODE_TEXT[weatherCode] || '实时天气'
    },
    hourly,
    rainfall: hourly.map(item => item.precipitation)
  };
}

function normalizeMojiHourly(items, current) {
  const result = Array.from({ length: 25 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    time: '',
    precipitation: 0,
    temperature: finiteNumber(current?.temp),
    weatherCode: finiteNumber(current?.weather_id)
  }));
  for (const item of Array.isArray(items) ? items : []) {
    const time = String(item.predict_time || item.time || '');
    const match = time.match(/(?:T|\s)(\d{1,2}):/);
    const hour = match ? Number(match[1]) : Number(item.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    result[hour] = {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      time,
      precipitation: precipitation(item.qpf ?? item.precipitation),
      temperature: finiteNumber(item.temp ?? item.temperature, finiteNumber(current?.temp)),
      weatherCode: finiteNumber(item.weather_id ?? item.weatherCode, finiteNumber(current?.weather_id))
    };
  }
  result[24] = { ...result[0], hour: 24, label: '24:00' };
  return result;
}

async function fetchMoji(latitude, longitude, options = {}) {
  const token = options.mojiToken ?? process.env.MOJI_WEATHER_TOKEN;
  const password = options.mojiPassword ?? process.env.MOJI_WEATHER_PASSWORD;
  if (!token || !password) return null;
  const timestamp = Date.now().toString();
  const lat = Number(latitude).toFixed(3);
  const lon = Number(longitude).toFixed(3);
  const key = createHash('md5').update(`${password}${timestamp}${lat}${lon}`).digest('hex');
  const params = new URLSearchParams({ timestamp, token, key, lat, lon, language: 'zh-CN' });
  const payload = await fetchJson(`${MOJI_WEATHER_URL}?${params}`, options);
  if (Number(payload.code) !== 0 || !payload.data?.current) {
    throw new WeatherServiceError(payload.msg || '墨迹天气暂时不可用。', 'MOJI_ERROR');
  }
  const current = payload.data.current;
  const hourly = normalizeMojiHourly(payload.data.hourly, current);
  return {
    provider: 'moji',
    city: cleanLocationName(payload.data.city?.name),
    region: cleanLocationName(payload.data.city?.parent_names),
    updatedAt: current.obs_time || new Date().toISOString(),
    timezone: '',
    current: {
      precipitation: precipitation(current.precip_1h),
      temperature: Math.round(finiteNumber(current.temp)),
      humidity: Math.round(finiteNumber(current.humidity)),
      weatherCode: finiteNumber(current.weather_id),
      weatherText: current.weather || '实时天气'
    },
    hourly,
    rainfall: hourly.map(item => item.precipitation)
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
  precipitation,
  WEATHER_CODE_TEXT
});
