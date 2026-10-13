# Polyglot Page Translator

A Firefox WebExtension (Manifest V3) designed to translate entire web pages containing multiple different languages simultaneously into your desired language.

Unlike standard translation tools that assume a single source language for an entire page, Polyglot inspects and translates each text block individually with automatic source language detection.

## Features

- **Multi-Language Detection**: Detects and translates distinct languages across different sections of a single page in one pass.
- **Dual Display Modes**:
  - *In-Place Replacement*: Replaces foreign text directly in the page while keeping original styling intact.
  - *Bilingual View*: Inserts translated text alongside the original with source language tags (`[FR → EN]`, `[JA → EN]`) for side-by-side reading.
- **Automatic Translation & Always-Translate Domain List**:
  - Automatically translates pages on load if desired.
  - Configure specific domains to always translate automatically, or enable the global automatic translation setting in the Options page.
- **Layout & SPA Protection**: Full compatibility with modern web frameworks and custom Web Components (Reddit `<shreddit-*>`, social feeds, dynamic forums) without breaking layouts, navigation menus, or code blocks.
- **High-Throughput Batch Translation**: Batches requests with independent per-item language detection, avoiding HTTP 429 rate limits and speeding up full-page translation.
- **Context Menu & Selection Tool**: Right-click anywhere to trigger "Translate Page" or highlight specific text to translate on demand.
- **Zero Telemetry**: No tracking, analytics, or background data collection.

## Project Structure

```
polyglot-page-translator/
├── release/                   # Production build
│   ├── manifest.json          # Manifest V3
│   ├── background.js          # Background service worker & queue
│   ├── lib/                   # Language dictionary and text processing
│   ├── content/               # DOM parser and content scripts
│   ├── popup/                 # Extension popup interface
│   ├── options/               # Extension settings page
│   ├── icons/                 # Extension icons
│   ├── build.sh               # Packaging script for AMO ZIP and XPI
│   └── AMO_RELEASE_NOTES.md   # AMO Release Notes
└── README.md
```

## How to Install and Load the Add-on in Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` from the `release/` directory.

## Packaging for AMO (addons.mozilla.org)

To generate clean ZIP and XPI archives for submission:
```bash
cd release && ./build.sh
```
This produces:
- `polyglot-page-translator-v0.3.2.zip` (for upload to the Mozilla Add-on Developer Hub)
- `polyglot-page-translator.xpi` (for local standalone installation)
