# Changelog

All notable Rainform releases are documented here.

## [Unreleased]

- Public source repository governance, validation and noncommercial licensing.

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
