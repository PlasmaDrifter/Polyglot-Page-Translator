/**
 * Polyglot Page Translator
 * Text utilities, script detectors, and DOM filtering helpers
 */

// Tags that should NEVER be translated
const IGNORED_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  'PRE', 'CODE', 'KBD', 'SAMP', 'VAR',
  'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
  'AUDIO', 'VIDEO', 'CANVAS', 'SVG', 'MATH',
  'IFRAME', 'OBJECT', 'EMBED'
]);

// Unicode script regex ranges for fast script classification
const SCRIPT_PATTERNS = {
  cjk: /[\u4e00-\u9fff\u3400-\u4dbf]/, // Chinese characters (also used in Japanese kanji)
  hiragana: /[\u3040-\u309f]/,         // Japanese Hiragana
  katakana: /[\u30a0-\u30ff]/,         // Japanese Katakana
  hangul: /[\uac00-\ud7af\u1100-\u11ff]/, // Korean Hangul
  cyrillic: /[\u0400-\u04ff]/,        // Russian, Ukrainian, Bulgarian, Serbian, etc.
  arabic: /[\u0600-\u06ff\u0750-\u077f]/, // Arabic, Persian, Urdu
  hebrew: /[\u0590-\u05ff]/,          // Hebrew, Yiddish
  greek: /[\u0370-\u03ff]/,           // Greek
  devanagari: /[\u0900-\u097f]/,      // Hindi, Marathi, Nepali, Sanskrit
  thai: /[\u0e00-\u0e7f]/             // Thai
};

/**
 * Checks if a string has translatable textual content (not just punctuation, numbers, symbols)
 */
function isTranslatableText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;

  // Must contain at least one letter or ideograph
  const hasLetters = /[\p{L}\p{M}\p{N}]/u.test(trimmed);
  if (!hasLetters) return false;

  // Skip strings that are purely numeric, currency, timestamps, or simple symbols
  const isOnlyNumbersOrSymbols = /^[\d\s\p{P}\p{S}]+$/u.test(trimmed);
  if (isOnlyNumbersOrSymbols) return false;

  // Skip URLs
  if (/^(https?:\/\/|www\.)[^\s]+$/i.test(trimmed)) return false;

  return true;
}

/**
 * Quick heuristic to check if text contains non-Latin scripts
 */
function detectScriptHint(text) {
  if (!text) return null;
  if (SCRIPT_PATTERNS.hiragana.test(text) || SCRIPT_PATTERNS.katakana.test(text)) return 'ja';
  if (SCRIPT_PATTERNS.hangul.test(text)) return 'ko';
  if (SCRIPT_PATTERNS.cjk.test(text)) return 'zh';
  if (SCRIPT_PATTERNS.cyrillic.test(text)) return 'ru';
  if (SCRIPT_PATTERNS.arabic.test(text)) return 'ar';
  if (SCRIPT_PATTERNS.hebrew.test(text)) return 'he';
  if (SCRIPT_PATTERNS.greek.test(text)) return 'el';
  if (SCRIPT_PATTERNS.devanagari.test(text)) return 'hi';
  if (SCRIPT_PATTERNS.thai.test(text)) return 'th';
  return null;
}

/**
 * Normalizes text for translation queries and cache keys
 */
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Checks whether an element or any of its parents has translate="no" or class="notranslate"
 */
function isElementExcluded(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

  if (IGNORED_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.classList && el.classList.contains('notranslate')) return true;
  if (el.getAttribute('data-polyglot-ignore') !== null) return true;
  if (el.isContentEditable) return true;

  // Check closest excluded ancestor
  const excludedAncestor = el.closest('pre, code, kbd, samp, script, style, textarea, input, select, [translate="no"], .notranslate, [data-polyglot-ignore]');
  return Boolean(excludedAncestor);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    IGNORED_TAGS,
    SCRIPT_PATTERNS,
    isTranslatableText,
    detectScriptHint,
    normalizeText,
    isElementExcluded
  };
}
