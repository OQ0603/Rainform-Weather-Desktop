# Changelog

All notable Rainform releases are documented here.

## [Unreleased]

- Public source repository governance, validation and noncommercial licensing.

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
