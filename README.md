# Polyglot Page Translator

A Firefox WebExtension (Manifest V3) designed to translate entire web pages containing multiple different languages simultaneously into your desired language.

Unlike standard translation tools that assume a single source language for an entire page, Polyglot inspects and translates each text block individually with automatic source language detection.

## Features

- **Multi-Language Detection**: Detects and translates distinct languages across different sections of a single page in one pass.
- **Dual Display Modes**:
  - *In-Place Replacement*: Replaces foreign text directly in the page while keeping original styling intact.
  - *Bilingual View*: Inserts translated text alongside the original with source language tags (`[FR → EN]`, `[JA → EN]`) for side-by-side reading.
- **Layout & SPA Protection**: Full compatibility with modern web frameworks and custom Web Components (Reddit `<shreddit-*>`, social feeds, dynamic forums) without breaking layouts, navigation menus, or code blocks.
- **High-Throughput Batch Translation**: Batches requests with independent per-item language detection, avoiding HTTP 429 rate limits and speeding up full-page translation.
- **Context Menu & Selection Tool**: Right-click anywhere to trigger "Translate Page" or highlight specific text to translate on demand.
- **Zero Telemetry**: No tracking, analytics, or background data collection.

## Project Structure

```
polyglot-page-translator/
├── release/                   # Production build
│   ├── manifest.json          # Manifest V3 (Version 0.3.0)
│   ├── background.js          # Background service worker & queue
│   ├── lib/                   # Language dictionary and text processing
│   ├── content/               # DOM parser and content scripts
│   ├── popup/                 # Extension popup interface
│   ├── options/               # Extension settings page
│   ├── icons/                 # Extension icons
│   ├── build.sh               # Packaging script for AMO ZIP and XPI
│   ├── AMO_RELEASE_NOTES.md   # AMO Release Notes for v0.3.0
│   └── polyglot-page-translator-v0.3.0.zip # AMO upload archive
│
├── test/                      # Development & test build
│   ├── manifest.json          # Manifest V3 with (Test) naming & distinct ID
│   ├── background.js
│   ├── lib/
│   ├── content/
│   ├── popup/
│   ├── options/
│   ├── icons/
│   ├── build.sh
│   ├── serve.py               # Local testing HTTP server
│   └── test-multilingual-page.html # Interactive test page with dynamic comments
│
└── README.md
```

## How to Test the Extension

### 1. Load the Add-on in Firefox
- Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
- Click **Load Temporary Add-on...**.
- Select `manifest.json` from either the `test/` directory (for the test version) or the `release/` directory (for the release version).

### 2. Testing Websites

#### Option A: Local Interactive Test Server (Recommended)
You can launch the built-in local test server on `http://localhost:8486`:
```bash
python3 test/serve.py
```
Then visit:
`http://localhost:8486/test-multilingual-page.html`

This test page contains:
- English question (preserved untouched when translating into English)
- Spanish comment (Carlos)
- French comment (Élise)
- German comment (Maximilian)
- Japanese comment (Kenji)
- Russian comment (Dmitry)
- JavaScript code block (excluded from translation)
- "Load Dynamic Comments" button to test dynamic translation of Korean, Arabic, Italian, and Chinese additions via `MutationObserver`.

#### Option B: Real-World Public Multilingual Websites
- **Wikipedia Embassy**: `https://en.wikipedia.org/wiki/Wikipedia:Embassy` (Multilingual user messages posted in dozens of different languages).
- **Wikimedia Babel**: `https://meta.wikimedia.org/wiki/Babel` (Multilingual discussion page).
- **Tatoeba Project**: `https://tatoeba.org/en/sentences/show_random` (Multilingual sentence corpus where every sentence is in a different language).
- **Reddit Multilingual Threads**: `https://www.reddit.com/r/languagelearning/` (Discussions where participants reply in Spanish, German, French, Japanese, etc.).
