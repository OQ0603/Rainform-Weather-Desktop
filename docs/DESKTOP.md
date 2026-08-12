# Rainform Weather Desktop

This derivative keeps the original Rainform Three.js/WebGL renderer and adds a Windows-only Electron shell. It is an unofficial noncommercial derivative and retains the original `LICENSE`, `NOTICE.md`, and third-party notices.

## Weather providers

- The Electron main process uses the Alibaba Cloud Marketplace Moji professional latitude/longitude API. It reads `MOJI_WEATHER_APPCODE`, `MOJI_WEATHER_CONDITION_TOKEN`, and `MOJI_WEATHER_FORECAST_TOKEN` from the launch environment and attempts Moji first.
- `MOJI_WEATHER_PASSWORD` remains a compatibility alias for APPCode, while `MOJI_WEATHER_TOKEN` is a compatibility shared endpoint token.
- If credentials are absent or Moji fails, mainland-China coordinates first use the nearest China Meteorological Administration live station. CMA's day/night forecast constrains future rain conditions; Open-Meteo fills only the hour grid and temperature details.
- If no nearby CMA station is available or the CMA request fails, the main process automatically requests Open-Meteo for both current and hourly weather.
- If Moji current conditions succeed but its hourly token/request fails, Moji remains the current-condition source and only the hourly timeline is filled by Open-Meteo.
- Open-Meteo also supplies city-name search. Coordinate-to-city display uses a no-key reverse-geocoding fallback because Open-Meteo's public geocoding endpoint accepts place names, not coordinate pairs.
- CMA station observations include measured hourly precipitation, temperature, humidity, observation time and active rain alerts. A rain condition or warning may raise only the visual intensity floor; measured mm/h remains unchanged and is displayed separately.
- The automatic panel separates the nearest-station observation from future weather. Only hours after the observation hour are listed through 24:00. When CMA's day/night forecast is wetter than the Open-Meteo grid, the UI shows the CMA condition as a trend rather than presenting the visual floor as a measured mm/h value.
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
pnpm run test:cma-live
pnpm run test:desktop
```

The system-location smoke deliberately has no injected coordinate and therefore requires a packaged executable:

```powershell
$env:RAINFORM_SYSTEM_LOCATION_EXECUTABLE='D:\path\to\Rainform Weather Desktop.exe'
pnpm run test:system-location
```

The dedicated CMA live smoke uses a Puyang coordinate and records the station observation plus the future-hour list. The full desktop smoke uses a deterministic Shanghai coordinate in its test-only environment, exercises live CMA current observations, Open-Meteo hourly synchronization and city search, and verifies dry/light/heavy renderer state, audio mute/restore, component independence, and a 900x500 landscape layout.
