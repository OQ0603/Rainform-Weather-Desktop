# Rainform Weather Desktop

This derivative keeps the original Rainform Three.js/WebGL renderer and adds a Windows-only Electron shell. It is an unofficial noncommercial derivative and retains the original `LICENSE`, `NOTICE.md`, and third-party notices.

## Weather providers

- The Electron main process retains the Alibaba Cloud Marketplace Moji professional latitude/longitude API as a configured fallback. It reads `MOJI_WEATHER_APPCODE`, `MOJI_WEATHER_CONDITION_TOKEN`, and `MOJI_WEATHER_FORECAST_TOKEN` only from the launch environment.
- `MOJI_WEATHER_PASSWORD` remains a compatibility alias for APPCode, while `MOJI_WEATHER_TOKEN` is a compatibility shared endpoint token.
- Automatic timelines first use the public China Weather page selected for the located/searched city. Hualong/Puyang coordinates are pinned to `https://www.weather.com.cn/weather/101181306.shtml`.
- Elapsed hours come from the page's `observe24h_data.od26` measured precipitation. Future hours come from its `hour3data` conditions and are explicitly marked as forecast-derived visual intensity.
- In automatic mode, rain audio uses only the current measured observation; elapsed or forecast rain does not produce sound while the current hour is dry.
- The automatic panel refreshes the current location every five minutes. Its immediate refresh reuses the saved request; only the separate relocate action asks Windows for location again.
- If China Weather fails, the main process falls back through configured Moji, the nearest CMA observation, and Open-Meteo.
- If Moji current conditions succeed but its hourly token/request fails, Moji remains the current-condition source and only the hourly timeline is filled by Open-Meteo.
- Open-Meteo also supplies city-name search. Coordinate-to-city display uses a no-key reverse-geocoding fallback because Open-Meteo's public geocoding endpoint accepts place names, not coordinate pairs.
- CMA station observations include measured hourly precipitation, temperature, humidity, observation time and active rain alerts. A rain condition or warning may raise only the visual intensity floor; measured mm/h remains unchanged and is displayed separately.
- The automatic panel lists the complete 00:00–24:00 day. China Weather primary-mode earlier/current rows use measured page precipitation; future rows use page forecast conditions and never present derived visual intensity as measured mm/h. The list automatically centers the current hour.
- Provider credentials are never exposed through the preload bridge or included in the renderer bundle.

Example for a development launch in PowerShell:

```powershell
$env:MOJI_WEATHER_APPCODE='your-appcode'
$env:MOJI_WEATHER_CONDITION_TOKEN='your-condition-token'
$env:MOJI_WEATHER_FORECAST_TOKEN='your-forecast24hours-token'
pnpm run build
pnpm start
```

Do not save real credentials in `.env.example`, source control, or packaging configuration.

## Windows package

```powershell
pnpm run dist:win
```

The NSIS target is x64, uses an assisted installer, allows the user to choose the installation directory, and creates Desktop and Start Menu shortcuts. Frontend assets are included in the application archive, so the app never loads the deployed Rainform website.

## Verification

```powershell
pnpm run check
pnpm run test:integration
pnpm run test:weather-china-live
pnpm run test:desktop
```

The system-location smoke deliberately has no injected coordinate and therefore requires a packaged executable:

```powershell
$env:RAINFORM_SYSTEM_LOCATION_EXECUTABLE='D:\path\to\Rainform Weather Desktop.exe'
pnpm run test:system-location
```

The dedicated China Weather live smoke uses a Puyang coordinate, verifies code `101181306`, records measured past rain and the future forecast list, and rejects mixed Open-Meteo/CMA labels. The full desktop smoke exercises China Weather synchronization and city search, dry/light/heavy renderer state, audio mute/restore, component independence, and a 900x500 landscape layout.
