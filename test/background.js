/**
 * Polyglot Page Translator - Background Script
 * Handles translation API calls, concurrency queue, caching, and state management.
 */

// Import language dictionaries if in browser environment with importScripts
try {
  importScripts('lib/languages.js', 'lib/text-utils.js');
} catch (e) {
  // Ignored if bundled or running in environments where importScripts is not needed
}

// In-memory cache for translated snippets
// Key: `${provider}:${targetLang}:${normalizedText}` -> { translatedText, detectedLang }
const translationCache = new Map();
const MAX_CACHE_SIZE = 5000;

// Tab state tracker: tabId -> { isTranslated, displayMode, targetLang, stats: { total, languages: { es: 5, ja: 3 } } }
const tabStates = new Map();

// Default settings
const DEFAULT_SETTINGS = {
  targetLang: 'en',
  displayMode: 'replace', // 'replace' or 'bilingual'
  provider: 'google',     // 'google', 'libretranslate', 'deepl'
  concurrencyLimit: 6,
  libreTranslateUrl: 'https://translate.argosopentech.com',
  libreTranslateApiKey: '',
  deeplApiKey: '',
  deeplApiUrl: 'https://api-free.deepl.com',
  showLanguageBadges: true,
  showOriginalOnHover: true,
  autoTranslateDomains: []
};

// Concurrency Semaphore
class RequestQueue {
  constructor(concurrency = 6) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  setConcurrency(limit) {
    this.concurrency = Math.max(1, Math.min(limit, 12));
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.dequeue();
    });
  }

  dequeue() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const { task, resolve, reject } = this.queue.shift();
    this.running++;

    task()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.running--;
        this.dequeue();
      });
  }
}

const queue = new RequestQueue(DEFAULT_SETTINGS.concurrencyLimit);

// Load settings from storage
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

// Save settings to storage
async function saveSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  queue.setConcurrency(merged.concurrencyLimit || 6);
  return merged;
}

// Cache helpers
function getCached(provider, targetLang, text) {
  const key = `${provider}:${targetLang}:${text}`;
  return translationCache.get(key) || null;
}

function setCache(provider, targetLang, text, value) {
  if (translationCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entries
    const firstKey = translationCache.keys().next().value;
    if (firstKey) translationCache.delete(firstKey);
  }
  const key = `${provider}:${targetLang}:${text}`;
  translationCache.set(key, value);
}

/**
 * Google Translate Free Client API
 * sl=auto provides per-snippet automatic language detection
 */
async function translateWithGoogle(text, targetLang) {
  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'auto');
  url.searchParams.set('tl', targetLang);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Google Translate error: HTTP ${response.status}`);
  }

  const data = await response.json();
  // data[0] contains array of [[translatedChunk, originalChunk], ...]
  // data[2] contains detected source language code, e.g. "es", "ja", "fr"
  const chunks = data[0] || [];
  const translatedText = chunks.map(chunk => chunk[0] || '').join('');
  const detectedLang = (data[2] || 'unknown').toLowerCase();

  return {
    translatedText: translatedText.trim(),
    detectedLang
  };
}

/**
 * LibreTranslate API
 */
async function translateWithLibre(text, targetLang, settings) {
  const baseUrl = settings.libreTranslateUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/translate`;

  const payload = {
    q: text,
    source: 'auto',
    target: targetLang,
    format: 'text'
  };

  if (settings.libreTranslateApiKey) {
    payload.api_key = settings.libreTranslateApiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`LibreTranslate error: HTTP ${response.status}`);
  }

  const data = await response.json();
  const detectedLang = data.detectedLanguage ? (data.detectedLanguage.language || 'unknown') : 'unknown';

  return {
    translatedText: (data.translatedText || '').trim(),
    detectedLang: detectedLang.toLowerCase()
  };
}

/**
 * DeepL API
 */
async function translateWithDeepL(text, targetLang, settings) {
  if (!settings.deeplApiKey) {
    throw new Error('DeepL API Key is missing. Please configure it in extension options.');
  }

  const baseUrl = settings.deeplApiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/v2/translate`;

  // DeepL target language codes for English are EN-GB or EN-US, Portuguese PT-BR or PT-PT
  let target = targetLang.toUpperCase();
  if (target === 'EN') target = 'EN-US';
  if (target === 'PT') target = 'PT-PT';

  const formData = new URLSearchParams();
  formData.append('text', text);
  formData.append('target_lang', target);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${settings.deeplApiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString()
  });

  if (!response.ok) {
    throw new Error(`DeepL API error: HTTP ${response.status}`);
  }

  const data = await response.json();
  const first = data.translations && data.translations[0];
  if (!first) throw new Error('DeepL returned empty translation');

  return {
    translatedText: (first.text || '').trim(),
    detectedLang: (first.detected_source_language || 'unknown').toLowerCase()
  };
}

/**
 * Dispatches translation through queue and chosen provider
 */
async function translateSnippet(text, targetLang, settings) {
  const cached = getCached(settings.provider, targetLang, text);
  if (cached) {
    return cached;
  }

  const task = async () => {
    let result;
    if (settings.provider === 'libretranslate') {
      result = await translateWithLibre(text, targetLang, settings);
    } else if (settings.provider === 'deepl') {
      result = await translateWithDeepL(text, targetLang, settings);
    } else {
      result = await translateWithGoogle(text, targetLang);
    }
    setCache(settings.provider, targetLang, text, result);
    return result;
  };

  return await queue.add(task);
}

/**
 * Google Translate Batch API (using clients5 endpoint with dict-chrome-ex client)
 * Sends multiple texts in a single POST request while retaining independent language detection.
 */
async function translateWithGoogleBatch(texts, targetLang) {
  if (texts.length === 0) return [];

  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(targetLang)}`;
  const params = new URLSearchParams();
  for (const text of texts) {
    params.append('q', text);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!response.ok) {
    throw new Error(`Google batch translate error: HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.map(item => ({
    translatedText: (item && item[0] ? item[0] : '').trim(),
    detectedLang: (item && item[1] ? item[1] : 'unknown').toLowerCase()
  }));
}

/**
 * Translates a batch of items with native batching for Google and queueing for other engines
 */
async function translateBatch(items, targetLang, settings) {
  if (!items || items.length === 0) return [];

  // 1. Resolve from in-memory cache first
  const resultsMap = new Map();
  const unCachedItems = [];

  for (const item of items) {
    const cached = getCached(settings.provider, targetLang, item.text);
    if (cached) {
      const isTarget = cached.detectedLang.toLowerCase().split('-')[0] === targetLang.toLowerCase().split('-')[0];
      const isIdentical = item.text.trim().toLowerCase() === cached.translatedText.toLowerCase();

      resultsMap.set(item.id, {
        id: item.id,
        originalText: item.text,
        translatedText: cached.translatedText,
        detectedLang: cached.detectedLang,
        isAlreadyTargetLang: isTarget && isIdentical
      });
    } else {
      unCachedItems.push(item);
    }
  }

  // 2. Translate un-cached items
  if (unCachedItems.length > 0) {
    if (settings.provider === 'google') {
      // Chunk into batches of up to 25 items for fast and safe single-request transmission
      const BATCH_SIZE = 25;
      for (let i = 0; i < unCachedItems.length; i += BATCH_SIZE) {
        const chunk = unCachedItems.slice(i, i + BATCH_SIZE);
        const texts = chunk.map(c => c.text);

        try {
          const batchResults = await translateWithGoogleBatch(texts, targetLang);
          for (let j = 0; j < chunk.length; j++) {
            const item = chunk[j];
            const res = batchResults[j] || { translatedText: item.text, detectedLang: 'unknown' };

            setCache(settings.provider, targetLang, item.text, res);

            const isTarget = res.detectedLang.toLowerCase().split('-')[0] === targetLang.toLowerCase().split('-')[0];
            const isIdentical = item.text.trim().toLowerCase() === res.translatedText.toLowerCase();

            resultsMap.set(item.id, {
              id: item.id,
              originalText: item.text,
              translatedText: res.translatedText,
              detectedLang: res.detectedLang,
              isAlreadyTargetLang: isTarget && isIdentical
            });
          }
        } catch (err) {
          console.warn('Batch translation failed, falling back to single items:', err);
          // Fallback to item-by-item translation with queue
          await Promise.all(chunk.map(async (item) => {
            try {
              const res = await translateSnippet(item.text, targetLang, settings);
              const isTarget = res.detectedLang.toLowerCase().split('-')[0] === targetLang.toLowerCase().split('-')[0];
              const isIdentical = item.text.trim().toLowerCase() === res.translatedText.toLowerCase();

              resultsMap.set(item.id, {
                id: item.id,
                originalText: item.text,
                translatedText: res.translatedText,
                detectedLang: res.detectedLang,
                isAlreadyTargetLang: isTarget && isIdentical
              });
            } catch (singleErr) {
              resultsMap.set(item.id, {
                id: item.id,
                originalText: item.text,
                translatedText: item.text,
                detectedLang: 'unknown',
                error: singleErr.message
              });
            }
          }));
        }
      }
    } else {
      // Non-google providers (LibreTranslate or DeepL)
      await Promise.all(unCachedItems.map(async (item) => {
        try {
          const res = await translateSnippet(item.text, targetLang, settings);
          const isTarget = res.detectedLang.toLowerCase().split('-')[0] === targetLang.toLowerCase().split('-')[0];
          const isIdentical = item.text.trim().toLowerCase() === res.translatedText.toLowerCase();

          resultsMap.set(item.id, {
            id: item.id,
            originalText: item.text,
            translatedText: res.translatedText,
            detectedLang: res.detectedLang,
            isAlreadyTargetLang: isTarget && isIdentical
          });
        } catch (singleErr) {
          resultsMap.set(item.id, {
            id: item.id,
            originalText: item.text,
            translatedText: item.text,
            detectedLang: 'unknown',
            error: singleErr.message
          });
        }
      }));
    }
  }

  // 3. Return items in original request order
  return items.map(item => resultsMap.get(item.id) || {
    id: item.id,
    originalText: item.text,
    translatedText: item.text,
    detectedLang: 'unknown'
  });
}

// Initialize Context Menus
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'polyglot-translate-page',
      title: 'Translate Page',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'polyglot-translate-selection',
      title: 'Translate Selection',
      contexts: ['selection']
    });
  });
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'polyglot-translate-page') {
    const settings = await getSettings();
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRANSLATE_PAGE',
      targetLang: settings.targetLang,
      displayMode: settings.displayMode
    });
  } else if (info.menuItemId === 'polyglot-translate-selection') {
    const settings = await getSettings();
    chrome.tabs.sendMessage(tab.id, {
      action: 'TRANSLATE_SELECTION',
      selectedText: info.selectionText,
      targetLang: settings.targetLang
    });
  }
});

// Message Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === 'TRANSLATE_BATCH') {
        const settings = await getSettings();
        const targetLang = message.targetLang || settings.targetLang;
        const results = await translateBatch(message.items, targetLang, settings);
        sendResponse({ success: true, results });
      } else if (message.action === 'GET_SETTINGS') {
        const settings = await getSettings();
        sendResponse({ success: true, settings });
      } else if (message.action === 'SET_SETTINGS') {
        const updated = await saveSettings(message.settings);
        sendResponse({ success: true, settings: updated });
      } else if (message.action === 'UPDATE_TAB_STATE') {
        const tabId = sender.tab ? sender.tab.id : message.tabId;
        if (tabId) {
          tabStates.set(tabId, message.state);
        }
        sendResponse({ success: true });
      } else if (message.action === 'GET_TAB_STATE') {
        const tabId = message.tabId;
        const state = tabStates.get(tabId) || { isTranslated: false, stats: { total: 0, languages: {} } };
        sendResponse({ success: true, state });
      } else {
        sendResponse({ error: `Unknown action: ${message.action}` });
      }
    } catch (err) {
      console.error('Background message error:', err);
      sendResponse({ error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});

// Clean up state when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
