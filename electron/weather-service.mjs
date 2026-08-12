// Weather providers run only in Electron's main process. Never import this file
// from renderer code: Moji credentials are read here and never cross the IPC bridge.

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEOCODING_URL = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const CMA_MAP_URL = 'https://weather.cma.cn/api/map/weather/1';
const CMA_WEATHER_URL = 'https://weather.cma.cn/api/weather/view';
const CMA_USER_AGENT = 'Rainform-Weather-Desktop/2.1 (+https://github.com/OQ0603/Rainform-Weather-Desktop)';
const WEATHER_CHINA_SEARCH_URL = 'https://toy1.weather.com.cn/search';
const WEATHER_CHINA_PAGE_URL = 'https://www.weather.com.cn/weather';
const WEATHER_CHINA_REFERER = 'https://www.weather.com.cn/';
const WEATHER_CHINA_USER_AGENT = CMA_USER_AGENT;
const MOJI_API_BASE_URL = 'https://finaljwd.market.alicloudapi.com';
const MOJI_CONDITION_PATH = '/whapi/json/aliweather/condition';
const MOJI_FORECAST_PATH = '/whapi/json/aliweather/forecast24hours';

const WEATHER_CHINA_LOCATION_OVERRIDES = Object.freeze([
  Object.freeze({
    code: '101181306',
    name: '华龙',
    region: '河南',
    latitude: 35.778,
    longitude: 115.074,
    radiusKm: 35
  }),
  Object.freeze({
    code: '101020100',
    name: '上海',
    region: '上海',
    latitude: 31.2304,
    longitude: 121.4737,
    radiusKm: 80
  })
]);

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

function rainConditionFloor(conditionText, conditionId) {
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

async function fetchText(url, {
  fetchImpl = fetch,
  timeoutMs = 8000,
  headers = {}
} = {}) {
  let response;
  let lastNetworkError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', ...headers },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.ok || response.status < 500 || attempt === 1) break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt === 1) {
        throw new WeatherServiceError('中国天气网连接失败或请求超时。', 'WEATHER_CHINA_NETWORK_ERROR', error);
      }
    }
  }
  if (!response) {
    throw new WeatherServiceError('中国天气网连接失败或请求超时。', 'WEATHER_CHINA_NETWORK_ERROR', lastNetworkError);
  }
  if (!response.ok) {
    throw new WeatherServiceError(`中国天气网返回 ${response.status}。`, 'WEATHER_CHINA_HTTP_ERROR');
  }
  try {
    return await response.text();
  } catch (error) {
    throw new WeatherServiceError('中国天气网页面无法读取。', 'WEATHER_CHINA_INVALID_RESPONSE', error);
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
    const administrative = Array.isArray(payload.localityInfo?.administrative)
      ? payload.localityInfo.administrative
      : [];
    const district = cleanLocationName(payload.locality || administrative.at(-1)?.name);
    return {
      city: locality,
      district,
      region: cleanLocationName(payload.principalSubdivision),
      country: cleanLocationName(payload.countryName)
    };
  } catch {
    return { city: '', district: '', region: '', country: '' };
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
    const weatherCode = finiteNumber(
      payload.hourly?.weather_code?.[index],
      finiteNumber(payload.current?.weather_code)
    );
    hourly.push({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      time: times[index] || '',
      precipitation: precipitation(payload.hourly?.precipitation?.[index]),
      temperature: finiteNumber(payload.hourly?.temperature_2m?.[index], finiteNumber(payload.current?.temperature_2m)),
      weatherCode,
      weatherText: WEATHER_CODE_TEXT[weatherCode] || '天气'
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
  const currentHour = Number(String(payload.current.time || '').slice(11, 13));
  return {
    provider: 'open-meteo',
    updatedAt: String(payload.current.time || new Date().toISOString()),
    currentHour: Number.isInteger(currentHour) ? currentHour : new Date().getHours(),
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

let cmaStationCache = null;

function haversineDistanceKm(latitudeA, longitudeA, latitudeB, longitudeB) {
  const radians = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = radians(latitudeB - latitudeA);
  const deltaLongitude = radians(longitudeB - longitudeA);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeWeatherChinaName(value) {
  return cleanLocationName(value)
    .replaceAll('華', '华')
    .replaceAll('龍', '龙')
    .replaceAll('臺', '台')
    .replace(/(?:特别行政区|自治州|自治县|市|区|县)$/u, '');
}

function knownWeatherChinaLocation(latitude, longitude, query = '') {
  const normalizedQuery = normalizeWeatherChinaName(query);
  for (const location of WEATHER_CHINA_LOCATION_OVERRIDES) {
    const distanceKm = haversineDistanceKm(
      latitude,
      longitude,
      location.latitude,
      location.longitude
    );
    if (distanceKm <= location.radiusKm || normalizeWeatherChinaName(location.name) === normalizedQuery) {
      return { ...location, distanceKm: Math.round(distanceKm * 10) / 10 };
    }
  }
  return null;
}

function parseWeatherChinaSearch(text) {
  const source = String(text || '').trim();
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) {
    throw new WeatherServiceError('中国天气网城市搜索结果无法读取。', 'WEATHER_CHINA_INVALID_RESPONSE');
  }
  let entries;
  try {
    entries = JSON.parse(source.slice(start, end + 1));
  } catch (error) {
    throw new WeatherServiceError('中国天气网城市搜索结果无法读取。', 'WEATHER_CHINA_INVALID_RESPONSE', error);
  }
  return (Array.isArray(entries) ? entries : [])
    .map(entry => String(entry?.ref || '').split('~'))
    .filter(parts => /^\d{9}$/.test(parts[0] || ''))
    .map(parts => ({
      code: parts[0],
      name: cleanLocationName(parts[2]),
      parent: cleanLocationName(parts[4]),
      region: cleanLocationName(parts[9])
    }))
    .filter(location => location.code && location.name);
}

async function resolveWeatherChinaLocation(latitude, longitude, query, options = {}) {
  const known = knownWeatherChinaLocation(latitude, longitude, query);
  if (known) return known;
  const normalizedQuery = normalizeWeatherChinaName(query);
  if (!normalizedQuery) {
    throw new WeatherServiceError('无法确定中国天气网城市代码。', 'WEATHER_CHINA_LOCATION_ERROR');
  }
  const params = new URLSearchParams({ cityname: normalizedQuery });
  const responseText = await fetchText(`${WEATHER_CHINA_SEARCH_URL}?${params}`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 8000,
    headers: {
      ...options.headers,
      Referer: WEATHER_CHINA_REFERER,
      'User-Agent': WEATHER_CHINA_USER_AGENT
    }
  });
  const locations = parseWeatherChinaSearch(responseText);
  const exact = locations.find(location => normalizeWeatherChinaName(location.name) === normalizedQuery)
    || locations.find(location => normalizeWeatherChinaName(location.parent) === normalizedQuery);
  const location = exact || locations[0];
  if (!location) {
    throw new WeatherServiceError('中国天气网没有找到匹配城市。', 'WEATHER_CHINA_LOCATION_ERROR');
  }
  return { ...location, distanceKm: null };
}

function extractWeatherChinaAssignment(html, variableName) {
  const source = String(html || '');
  const marker = new RegExp(`var\\s+${variableName}\\s*=\\s*`);
  const match = marker.exec(source);
  if (!match) {
    throw new WeatherServiceError(`中国天气网页面缺少 ${variableName}。`, 'WEATHER_CHINA_INVALID_RESPONSE');
  }
  const start = source.indexOf('{', match.index + match[0].length);
  if (start < 0) {
    throw new WeatherServiceError(`中国天气网页面缺少 ${variableName}。`, 'WEATHER_CHINA_INVALID_RESPONSE');
  }
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, index + 1));
        } catch (error) {
          throw new WeatherServiceError(`中国天气网 ${variableName} 无法解析。`, 'WEATHER_CHINA_INVALID_RESPONSE', error);
        }
      }
    }
  }
  throw new WeatherServiceError(`中国天气网 ${variableName} 数据不完整。`, 'WEATHER_CHINA_INVALID_RESPONSE');
}

function parseWeatherChinaObservationTime(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) {
    throw new WeatherServiceError('中国天气网实况更新时间无效。', 'WEATHER_CHINA_INVALID_RESPONSE');
  }
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  return {
    year,
    month,
    day,
    hour,
    minute,
    timestamp: Date.UTC(year, month - 1, day, hour, minute),
    dateKey: `${yearText}-${monthText}-${dayText}`,
    updatedAt: `${yearText}-${monthText}-${dayText} ${hourText}:${minuteText}`
  };
}

function utcDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function weatherChinaForecastTimestamp(observationTime, day, hour) {
  let timestamp = Date.UTC(observationTime.year, observationTime.month - 1, day, hour);
  if (timestamp < observationTime.timestamp - 12 * 60 * 60 * 1000) {
    timestamp = Date.UTC(observationTime.year, observationTime.month, day, hour);
  }
  return timestamp;
}

function parseWeatherChinaForecast(hour3data, observationTime) {
  const source = Array.isArray(hour3data?.['1d']) ? hour3data['1d'] : [];
  return source
    .map(value => {
      const fields = String(value || '').split(',');
      const timeMatch = fields[0]?.match(/(\d{1,2})日(\d{2})时/);
      if (!timeMatch) return null;
      const day = Number(timeMatch[1]);
      const hour = Number(timeMatch[2]);
      return {
        timestamp: weatherChinaForecastTimestamp(observationTime, day, hour),
        label: fields[0],
        hour,
        icon: String(fields[1] || ''),
        weatherText: String(fields[2] || '天气预报'),
        temperature: finiteNumber(String(fields[3] || '').replace('℃', ''), 0)
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.timestamp - right.timestamp);
}

function weatherChinaTimeline(observe24h, hour3data) {
  const observation = observe24h?.od;
  const observationTime = parseWeatherChinaObservationTime(observation?.od0);
  const observations = Array.isArray(observation?.od2) ? observation.od2 : [];
  if (!observations.length) {
    throw new WeatherServiceError('中国天气网整点降水实况为空。', 'WEATHER_CHINA_INVALID_RESPONSE');
  }
  const currentObservation = observations[0];
  const currentHour = observationTime.hour;
  const dayStart = Date.UTC(observationTime.year, observationTime.month - 1, observationTime.day);
  const currentTemperature = finiteNumber(currentObservation?.od22);
  const forecast = parseWeatherChinaForecast(hour3data, observationTime);
  const timeline = Array.from({ length: 25 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    time: `${observationTime.dateKey}T${String(hour % 24).padStart(2, '0')}:00+08:00`,
    precipitation: 0,
    temperature: currentTemperature,
    weatherCode: 0,
    weatherText: '无雨',
    observationSource: 'weather-china'
  }));

  observations.forEach((item, index) => {
    const timestamp = observationTime.timestamp - index * 60 * 60 * 1000;
    if (utcDateKey(timestamp) !== observationTime.dateKey) return;
    const hour = new Date(timestamp).getUTCHours();
    const amount = precipitation(item?.od26);
    timeline[hour] = {
      ...timeline[hour],
      time: `${observationTime.dateKey}T${String(hour).padStart(2, '0')}:00+08:00`,
      precipitation: amount,
      temperature: finiteNumber(item?.od22, currentTemperature),
      weatherText: amount > 0 ? '实测降雨' : '无雨',
      humidity: Math.round(finiteNumber(item?.od27)),
      observationSource: 'weather-china',
      precipitationEstimated: false
    };
  });

  for (let hour = currentHour + 1; hour <= 24; hour += 1) {
    const targetTimestamp = dayStart + hour * 60 * 60 * 1000;
    const forecastPoint = forecast.find(item => item.timestamp >= targetTimestamp) || forecast.at(-1);
    if (!forecastPoint) continue;
    timeline[hour] = {
      ...timeline[hour],
      time: new Date(targetTimestamp).toISOString(),
      precipitation: precipitation(rainConditionFloor(forecastPoint.weatherText)),
      temperature: forecastPoint.temperature || currentTemperature,
      weatherText: forecastPoint.weatherText,
      precipitationEstimated: true,
      forecastSource: 'weather-china',
      sourceForecastTime: forecastPoint.label
    };
  }

  timeline[currentHour].weatherText = timeline[currentHour].precipitation > 0 ? '正在降雨' : '暂无降雨';
  return { timeline, forecast, observationTime, currentObservation };
}

async function fetchWeatherChina(latitude, longitude, query, options = {}) {
  const location = options.weatherChinaCode
    ? {
        code: String(options.weatherChinaCode),
        name: cleanLocationName(options.weatherChinaName || query || '中国天气网城市'),
        region: cleanLocationName(options.weatherChinaRegion || ''),
        distanceKm: null
      }
    : await resolveWeatherChinaLocation(latitude, longitude, query, options);
  const pageUrl = `${WEATHER_CHINA_PAGE_URL}/${encodeURIComponent(location.code)}.shtml`;
  const html = await fetchText(`${pageUrl}?t=${Date.now()}`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10000,
    headers: {
      ...options.headers,
      Referer: WEATHER_CHINA_REFERER,
      'User-Agent': WEATHER_CHINA_USER_AGENT
    }
  });
  const observe24h = extractWeatherChinaAssignment(html, 'observe24h_data');
  const hour3data = extractWeatherChinaAssignment(html, 'hour3data');
  const { timeline, forecast, observationTime, currentObservation } = weatherChinaTimeline(observe24h, hour3data);
  const currentHour = observationTime.hour;
  const measured = precipitation(currentObservation?.od26);
  const currentWeatherText = measured > 0 ? '正在降雨' : '暂无降雨';
  const distanceKm = location.distanceKm !== null && location.distanceKm !== undefined
    && Number.isFinite(Number(location.distanceKm))
    ? Number(location.distanceKm)
    : null;

  return {
    provider: 'weather-china',
    forecastProvider: 'weather-china',
    city: location.code === '101181306' ? '华龙区' : cleanLocationName(location.name),
    region: cleanLocationName(location.region),
    country: '中国',
    updatedAt: observationTime.updatedAt,
    currentHour,
    timezone: 'Asia/Shanghai',
    station: {
      id: location.code,
      name: location.code === '101181306' ? '华龙' : cleanLocationName(location.name),
      distanceKm
    },
    sourceUrl: pageUrl,
    current: {
      precipitation: measured,
      visualPrecipitation: measured,
      precipitationEstimated: false,
      temperature: Math.round(finiteNumber(currentObservation?.od22)),
      humidity: Math.round(finiteNumber(currentObservation?.od27)),
      weatherCode: 0,
      weatherText: currentWeatherText
    },
    hourly: timeline,
    rainfall: timeline.map(item => item.precipitation)
  };
}

function normalizeCmaStations(payload) {
  if (Number(payload?.code) !== 0 || !Array.isArray(payload?.data?.city)) {
    throw new WeatherServiceError('中国气象局站点数据不完整。', 'CMA_ERROR');
  }
  return payload.data.city
    .map(item => ({
      id: String(item?.[0] || ''),
      city: cleanLocationName(item?.[1]),
      latitude: Number(item?.[4]),
      longitude: Number(item?.[5]),
      dayText: String(item?.[7] || ''),
      nightText: String(item?.[12] || ''),
      regionCode: String(item?.[16] || ''),
      adcode: String(item?.[17] || '')
    }))
    .filter(station => station.id && station.city
      && Number.isFinite(station.latitude) && Number.isFinite(station.longitude));
}

async function fetchCmaStations(options = {}) {
  const useSharedCache = !options.fetchImpl;
  if (useSharedCache && cmaStationCache && Date.now() - cmaStationCache.createdAt < 15 * 60 * 1000) {
    return cmaStationCache.stations;
  }
  const payload = await fetchJson(`${CMA_MAP_URL}?t=${Date.now()}`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 8000,
    headers: { ...options.headers, 'User-Agent': CMA_USER_AGENT }
  });
  const stations = normalizeCmaStations(payload);
  if (useSharedCache) cmaStationCache = { createdAt: Date.now(), stations };
  return stations;
}

function nearestCmaStation(stations, latitude, longitude) {
  let nearest = null;
  for (const station of stations) {
    const distanceKm = haversineDistanceKm(
      latitude,
      longitude,
      station.latitude,
      station.longitude
    );
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { ...station, distanceKm };
  }
  return nearest;
}

function cmaCurrentHour(lastUpdate) {
  const match = String(lastUpdate || '').match(/\s(\d{1,2}):/);
  if (match) return Number(match[1]);
  return new Date().getHours();
}

function cmaAlert(alarms) {
  const alarm = (Array.isArray(alarms) ? alarms : []).find(item =>
    /暴雨|强降雨|雷雨|雷暴|雨/.test(`${item?.signaltype || ''}${item?.title || ''}`)
  );
  if (!alarm) return null;
  const type = cleanLocationName(alarm.signaltype) || '降雨';
  const level = cleanLocationName(alarm.signallevel);
  return {
    type,
    level,
    label: `${type}${level}预警`,
    title: String(alarm.title || ''),
    effective: String(alarm.effective || ''),
    severity: String(alarm.severity || '')
  };
}

function currentOnlyTimeline(currentHour, temperature, weatherText, visualPrecipitation) {
  return Array.from({ length: 25 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    time: '',
    precipitation: hour === currentHour ? visualPrecipitation : 0,
    temperature,
    weatherCode: 0,
    weatherText
  }));
}

function applyCmaRainTrend(hourly, today, currentHour) {
  if (!today || !Array.isArray(hourly)) return hourly;
  return hourly.map(item => {
    const hour = Number(item.hour);
    if (!Number.isInteger(hour) || hour <= currentHour || hour > 24) return item;
    const daylight = hour >= 6 && hour < 18;
    const weatherText = String(daylight ? today.dayText || '' : today.nightText || '');
    const weatherCode = finiteNumber(daylight ? today.dayCode : today.nightCode);
    const trendFloor = rainConditionFloor(weatherText, weatherCode);
    const rawPrecipitation = precipitation(item.precipitation);
    const rawConditionFloor = rainConditionFloor(item.weatherText);
    if (trendFloor <= Math.max(rawPrecipitation, rawConditionFloor)) return item;
    return {
      ...item,
      weatherText,
      precipitation: trendFloor,
      rawPrecipitation,
      precipitationEstimated: true,
      forecastSource: 'cma-trend'
    };
  });
}

async function fetchCma(latitude, longitude, options = {}) {
  const stations = await fetchCmaStations(options);
  const station = nearestCmaStation(stations, latitude, longitude);
  if (!station || station.distanceKm > 180) {
    throw new WeatherServiceError('当前位置没有可匹配的中国气象局实况站。', 'CMA_OUT_OF_RANGE');
  }

  const payload = await fetchJson(`${CMA_WEATHER_URL}?stationid=${encodeURIComponent(station.id)}&t=${Date.now()}`, {
    ...options,
    timeoutMs: options.timeoutMs ?? 8000,
    headers: { ...options.headers, 'User-Agent': CMA_USER_AGENT }
  });
  if (Number(payload?.code) !== 0 || !payload?.data?.now) {
    throw new WeatherServiceError(payload?.msg || '中国气象局实况暂时不可用。', 'CMA_ERROR');
  }

  const data = payload.data;
  const now = data.now;
  const currentHour = cmaCurrentHour(data.lastUpdate);
  const today = Array.isArray(data.daily) ? data.daily[0] : null;
  const daylight = currentHour >= 6 && currentHour < 18;
  const weatherText = String(
    (daylight ? today?.dayText : today?.nightText)
    || station.dayText
    || station.nightText
    || '实时天气'
  );
  const alert = cmaAlert(data.alarm);
  const measured = precipitation(now.precipitation);
  const conditionFloor = measured > 0 ? rainConditionFloor(weatherText) : 0;
  const alertFloor = measured > 0 && alert ? rainConditionFloor(alert.type || alert.title) : 0;
  const visual = precipitation(Math.max(measured, conditionFloor, alertFloor));
  const temperature = Math.round(finiteNumber(now.temperature));

  let hourly;
  let forecastProvider = 'open-meteo';
  let forecastFallbackReason = '';
  try {
    hourly = (await fetchOpenMeteo(latitude, longitude, options)).hourly;
    hourly = applyCmaRainTrend(hourly, today, currentHour);
    forecastProvider = 'cma-trend+open-meteo';
  } catch (error) {
    forecastProvider = 'cma-current-only';
    forecastFallbackReason = error instanceof Error ? error.message : '逐小时预报请求失败';
    hourly = currentOnlyTimeline(currentHour, temperature, weatherText, visual);
  }
  if (Number.isInteger(currentHour) && currentHour >= 0 && currentHour <= 23) {
    hourly[currentHour].precipitation = precipitation(Math.max(
      hourly[currentHour].precipitation,
      visual
    ));
    hourly[currentHour].temperature = temperature;
    hourly[currentHour].weatherText = weatherText;
  }

  const pathParts = String(data.location?.path || '').split(',').map(cleanLocationName).filter(Boolean);
  return {
    provider: 'cma',
    forecastProvider,
    city: cleanLocationName(data.location?.name || station.city),
    region: pathParts.length >= 2 ? pathParts.at(-2) : '',
    country: pathParts[0] || '中国',
    updatedAt: String(data.lastUpdate || new Date().toISOString()),
    currentHour,
    timezone: 'Asia/Shanghai',
    station: {
      id: station.id,
      name: cleanLocationName(data.location?.name || station.city),
      distanceKm: Math.round(station.distanceKm * 10) / 10
    },
    forecastTrend: today
      ? {
          provider: 'cma',
          date: String(today.date || ''),
          dayText: String(today.dayText || ''),
          nightText: String(today.nightText || '')
        }
      : null,
    alert,
    current: {
      precipitation: measured,
      visualPrecipitation: visual,
      precipitationEstimated: visual > measured,
      temperature,
      humidity: Math.round(finiteNumber(now.humidity)),
      weatherCode: daylight ? finiteNumber(today?.dayCode) : finiteNumber(today?.nightCode),
      weatherText
    },
    hourly,
    rainfall: hourly.map(item => item.precipitation),
    forecastFallback: forecastProvider === 'cma-current-only'
      ? { from: 'open-meteo', reason: forecastFallbackReason }
      : null
  };
}

function mojiRainFloor(conditionText, conditionId) {
  return rainConditionFloor(conditionText, conditionId);
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
    currentHour,
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
  const reverse = requestedCity
    ? { city: '', district: '', region: '', country: '' }
    : await reverseGeocode(latitude, longitude, options);
  let weather;
  let weatherChinaFallbackReason = '';
  let mojiFallbackReason = '';
  let cmaFallbackReason = '';
  if (options.weatherChinaEnabled !== false) {
    try {
      weather = await fetchWeatherChina(
        latitude,
        longitude,
        requestedCity || reverse.district || reverse.city,
        options
      );
    } catch (error) {
      weatherChinaFallbackReason = error instanceof Error ? error.message : '中国天气网请求失败';
    }
  }
  if (!weather) {
    try {
      weather = await fetchMoji(latitude, longitude, options);
    } catch (error) {
      mojiFallbackReason = error instanceof Error ? error.message : '墨迹天气请求失败';
    }
    if (!weather && !mojiFallbackReason) mojiFallbackReason = '未配置墨迹天气凭据';
  }
  if (!weather) {
    try {
      weather = await fetchCma(latitude, longitude, options);
    } catch (error) {
      cmaFallbackReason = error instanceof Error ? error.message : '中国气象局实况请求失败';
    }
  }
  if (!weather) weather = await fetchOpenMeteo(latitude, longitude, options);

  const city = weather.provider === 'weather-china'
    ? cleanLocationName(weather.city) || requestedCity || reverse.city || '当前位置'
    : requestedCity || cleanLocationName(weather.city) || reverse.city || '当前位置';
  const region = requestedRegion || cleanLocationName(weather.region) || reverse.region;

  return {
    ...weather,
    city,
    region,
    country: weather.country || reverse.country,
    latitude,
    longitude,
    locationSource: request?.source === 'search' ? 'search' : 'system',
    fallback: weather.provider === 'weather-china'
      ? null
      : {
          from: 'weather-china',
          to: weather.provider,
          reason: weatherChinaFallbackReason || mojiFallbackReason || cmaFallbackReason
        }
  };
}

export const weatherInternals = Object.freeze({
  openMeteoTimeline,
  normalizeMojiHourly,
  normalizeCmaStations,
  nearestCmaStation,
  applyCmaRainTrend,
  parseWeatherChinaSearch,
  extractWeatherChinaAssignment,
  parseWeatherChinaForecast,
  weatherChinaTimeline,
  rainConditionFloor,
  mojiRainFloor,
  mojiCurrentRain,
  precipitation,
  WEATHER_CODE_TEXT
});
