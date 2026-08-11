# Rainform Weather Desktop

This derivative keeps the original Rainform Three.js/WebGL renderer and adds a Windows-only Electron shell. It is an unofficial noncommercial derivative and retains the original `LICENSE`, `NOTICE.md`, and third-party notices.

## Weather providers

- The Electron main process uses the Alibaba Cloud Marketplace Moji professional latitude/longitude API. It reads `MOJI_WEATHER_APPCODE`, `MOJI_WEATHER_CONDITION_TOKEN`, and `MOJI_WEATHER_FORECAST_TOKEN` from the launch environment and attempts Moji first.
- `MOJI_WEATHER_PASSWORD` remains a compatibility alias for APPCode, while `MOJI_WEATHER_TOKEN` is a compatibility shared endpoint token.
- If credentials are absent or Moji fails, the main process automatically requests Open-Meteo.
- If Moji current conditions succeed but its hourly token/request fails, Moji remains the current-condition source and only the hourly timeline is filled by Open-Meteo.
- Open-Meteo also supplies city-name search. Coordinate-to-city display uses a no-key reverse-geocoding fallback because Open-Meteo's public geocoding endpoint accepts place names, not coordinate pairs.
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
pnpm run test:desktop
```

The desktop smoke test uses a deterministic Shanghai coordinate in its test-only environment, exercises live Open-Meteo synchronization and city search, and verifies dry/light/heavy renderer state, audio mute/restore, component independence, and a 900x500 landscape layout.
