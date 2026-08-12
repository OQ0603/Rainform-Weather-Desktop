# Changelog

All notable Rainform releases are documented here.

## [Unreleased]

- Public source repository governance, validation and noncommercial licensing.

## [2.1.6] - 2026-08-12

- Made China Weather (`weather.com.cn`) the primary automatic timeline source, with Hualong/Puyang mapped to the requested `101181306` page.
- Filled elapsed hours from the page's measured `observe24h_data.od26` precipitation instead of a forecast grid.
- Filled future hours from the page's `hour3data` weather conditions and labelled those visual values as China Weather forecasts rather than measured mm/h.
- Drove automatic-mode audio from the current measured hour, so past or forecast rain cannot play rain sound while the current website observation is dry.
- Added a non-locating immediate refresh action and automatic refresh every five minutes; relocation remains a separate explicit action.
- Retained Moji, CMA and Open-Meteo as failure fallbacks, while keeping provider requests in the Electron main process.

## [2.1.5] - 2026-08-12

- Restored the full 00:00–24:00 list instead of hiding hours before the current observation.
- Labelled rows as earlier, live observation or future, and automatically centered the current hour when the list opens.
- Kept the current row on measured station precipitation while future CMA trend rows remain explicitly estimated.

## [2.1.4] - 2026-08-12

- Prevented future hours from dropping to drizzle when the same CMA station's official day/night forecast remains heavy or moderate rain.
- Made CMA rain conditions the future visual floor while retaining Open-Meteo only for the hour grid and temperatures.
- Labelled trend-adjusted rows and selected points as CMA trends instead of presenting estimated visual intensity as measured mm/h.

## [2.1.3] - 2026-08-12

- Added nearest-station China Meteorological Administration current observations as the default no-credential source in mainland China.
- Kept Open-Meteo only for the 00:00–24:00 hourly curve when CMA current observations are available.
- Used active rain warnings and the CMA daily rain condition to set an honest visual floor while keeping the measured mm/h value separate.
- Added visible station, provider, observation time and rain-warning details to synchronization status.
- Added a source-labelled list from the next hour through 24:00, separate from the current station observation.
- Added automated CMA station-selection, severe-rain regression, future-list and non-injected Windows system-location coverage.

## [2.1.2] - 2026-08-11

- Removed the duplicate world-space hour/rainfall readout; the weather status bar remains the single forecast readout.
- Kept axes and the toolbar visible during ordinary pointer movement.
- Limited temporary label and toolbar hiding to an actual pressed scene drag beyond the movement threshold.
- Added an Electron interaction regression test for hover visibility and drag restoration.

## [2.1.1] - 2026-08-11

- Replaced the obsolete guessed Moji adapter with the Alibaba Cloud Marketplace professional latitude/longitude APPCode contract.
- Made current Moji rain conditions drive the current visual hour, including heavy and extreme rain levels, without presenting estimated visual intensity as measured mm/h.
- Kept Moji current conditions when only its hourly endpoint fails and filled the hourly timeline with Open-Meteo.
- Made the active provider and fallback state explicit in the editor.
- Prevented a late automatic weather response from overwriting data after switching to manual mode.
- Removed the retired visual tuning console, its third control button, stored parameter readers and theme editor from source.

## [2.0.0] - 2026-07-23

- Released the interactive liquid-metal rainfall landscape.
- Added editable hourly rainfall data, bilingual UI and responsive controls.
- Added rain audio, mobile landscape gating and X in-app browser guidance.
- Added production security headers, source-map exclusion and Cloudflare Pages deployment.
