import { readFile, access } from 'node:fs/promises';

const requiredFiles = [
  'LICENSE',
  'NOTICE.md',
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'index.html',
  'public/_headers',
  'public/robots.txt',
  'src/bootstrap.js',
  'src/main.js',
  'src/weather-controller.js',
  'src/styles.css',
  'electron/main.mjs',
  'electron/preload.cjs',
  'electron/weather-service.mjs',
  'tests/weather-service.test.mjs',
  'tests/ui-contract.test.mjs',
  '.env.example',
  'build/icon.ico',
  'vite.config.js'
];

for (const file of requiredFiles) {
  await access(file);
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (packageJson.name !== 'rainform') throw new Error('package.json name must remain "rainform".');
if (packageJson.license !== 'PolyForm-Noncommercial-1.0.0') {
  throw new Error('package.json must declare PolyForm-Noncommercial-1.0.0.');
}
if (packageJson.private !== true) {
  throw new Error('Rainform must be marked private to prevent accidental npm publication.');
}

const mainSource = await readFile('src/main.js', 'utf8');
const bootstrapSource = await readFile('src/bootstrap.js', 'utf8');
const weatherControllerSource = await readFile('src/weather-controller.js', 'utf8');
const weatherServiceSource = await readFile('electron/weather-service.mjs', 'utf8');
const viteSource = await readFile('vite.config.js', 'utf8');
const html = await readFile('index.html', 'utf8');

if (!mainSource.includes('const ENABLE_TUNING_CONSOLE = import.meta.env.DEV;')) {
  throw new Error('The visual tuning console must remain development-only.');
}
if (!viteSource.includes('sourcemap: false')) {
  throw new Error('Production source maps must remain disabled.');
}
if (!mainSource.includes('Required Notice: Rainform / 数据成雨')) {
  throw new Error('src/main.js is missing the required copyright notice.');
}
if (!bootstrapSource.includes('Required Notice: Rainform / 数据成雨')) {
  throw new Error('src/bootstrap.js is missing the required copyright notice.');
}
if (!html.includes('PolyForm Noncommercial 1.0.0')) {
  throw new Error('index.html is missing the source license notice.');
}
if (/MOJI_WEATHER_(?:TOKEN|PASSWORD)|process\.env/.test(weatherControllerSource)) {
  throw new Error('Moji credentials must never be referenced by renderer code.');
}
if (!weatherServiceSource.includes('process.env.MOJI_WEATHER_TOKEN')) {
  throw new Error('The main-process Moji environment integration is missing.');
}
if (packageJson.build?.nsis?.allowToChangeInstallationDirectory !== true) {
  throw new Error('The NSIS installer must allow installation directory selection.');
}

function objectKeys(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) throw new Error(`Could not inspect translations around ${startMarker}.`);
  return [...source.slice(start, end).matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)]
    .map(match => match[1])
    .sort();
}

const zhKeys = objectKeys(mainSource, "  'zh-CN': {", '  en: {');
const enKeys = objectKeys(mainSource, '  en: {', '\n  }\n};');
if (zhKeys.join('\n') !== enKeys.join('\n')) {
  const onlyZh = zhKeys.filter(key => !enKeys.includes(key));
  const onlyEn = enKeys.filter(key => !zhKeys.includes(key));
  throw new Error(`Translation keys differ. zh-only: ${onlyZh.join(', ')}; en-only: ${onlyEn.join(', ')}`);
}

const bootstrapZhKeys = objectKeys(bootstrapSource, "  'zh-CN': {", '  en: {');
const bootstrapEnKeys = objectKeys(bootstrapSource, '  en: {', '\n  }\n};');
if (bootstrapZhKeys.join('\n') !== bootstrapEnKeys.join('\n')) {
  throw new Error('Bootstrap translation keys differ between Chinese and English.');
}

console.log(`Project checks passed (${zhKeys.length} complete translation keys per locale).`);
