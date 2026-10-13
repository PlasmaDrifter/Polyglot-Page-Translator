/**
 * Polyglot Page Translator - Content Script (Test Version)
 * Traverses DOM, extracts translatable blocks and mixed-container inline runs,
 * applies translations (in-place or bilingual), tracks multi-language statistics,
 * and supports dynamic DOM mutations.
 */

(() => {
  // Prevent double injection
  if (window.__polyglotInjected) return;
  window.__polyglotInjected = true;

  // State
  let isTranslating = false;
  let isPageTranslated = false;
  let currentTargetLang = 'en';
  let currentDisplayMode = 'replace'; // 'replace' | 'bilingual'
  let elementIdCounter = 0;
  
  // Track translated units: id -> { element, isWrapped, originalHTML, originalText, detectedLang, translatedText, displayMode, injectedNode }
  const trackedUnits = new Map();
  const languageStats = {};
  let totalTranslatedCount = 0;

  let mutationObserver = null;
  let mutationTimeout = null;

  // Tags that represent phrasing/inline styling content
  const INLINE_TAGS = new Set([
    'A', 'SPAN', 'B', 'I', 'STRONG', 'EM', 'U', 'S', 'SMALL', 'MARK',
    'SUB', 'SUP', 'TIME', 'ABBR', 'CITE', 'Q', 'DFN', 'BDI', 'BDO'
  ]);

  // Block level tags that define structural boundaries
  const BLOCK_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'BLOCKQUOTE', 'ARTICLE', 'SECTION',
    'TD', 'TH', 'DD', 'DT', 'FIGCAPTION', 'SUMMARY',
    'DIV', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'UL', 'OL', 'DL',
    'FORM', 'FIELDSET', 'FIGURE'
  ]);

  const CHILD_BLOCK_SELECTOR = 'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, table, section, article, ul, ol, header, footer, aside, nav, form, fieldset, figure';

  /**
   * Checks whether an element is a structural/block element or custom element (e.g. <shreddit-post>)
   */
  function isStructuralElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName.toUpperCase();
    if (BLOCK_TAGS.has(tag)) return true;
    // Any custom Web Component element (contains a hyphen in tag name) is structural
    if (tag.includes('-')) return true;
    return false;
  }

  /**
   * Checks whether a text snippet represents meaningful translatable content.
   */
  function isMeaningfulRun(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length < 3) return false;

    // Skip wiki edit tags, pure numbers/punctuation
    if (/^\[edit\]$/i.test(trimmed)) return false;
    if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return false;

    // Reject JavaScript code, module loaders (e.g. SML.load), functions, and JSON/script blocks
    if (/^\s*\(?\s*\(\)\s*=>|function\s*\(|class\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|;\s*\}\)?\s*;?$/.test(trimmed)) {
      return false;
    }
    if (/\b(SML\.load|webpackChunk|window\.__|\.addEventListener\(|\.prototype\.)\b/.test(trimmed)) {
      return false;
    }
    // If text is code-heavy (high proportion of programming syntax characters)
    const codeSymbols = (trimmed.match(/[{}\[\]();=><+\-*\/~^%$#@!&|]/g) || []).length;
    if (trimmed.length > 12 && (codeSymbols / trimmed.length) > 0.22) {
      return false;
    }

    // If text contains non-Latin scripts, 3+ characters is valid
    if (detectScriptHint(trimmed)) return true;

    // For Latin text: require at least 2 words or length >= 14 chars
    const words = trimmed.split(' ');
    return words.length >= 2 || trimmed.length >= 14;
  }

  /**
   * Checks if an element is a navigation or boilerplate UI container
   */
  function isBoilerplateContainer(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.tagName === 'NAV') return true;
    if (el.closest('nav, [role="navigation"], .vector-menu, #mw-navigation, .sidebar, .mw-editsection, reddit-header, shreddit-nav, #header, .header-container')) return true;
    return false;
  }

  /**
   * Collects all candidate units (both leaf elements and wrapped inline runs)
   */
  function collectCandidateUnits(root = document.body) {
    const units = [];
    if (!root) return units;

    // Query candidate container elements plus any custom Web Components
    const elements = Array.from(root.querySelectorAll(
      'p, div, h1, h2, h3, h4, h5, h6, li, blockquote, article, section, td, th, dd, dt, figcaption, summary'
    ));

    // Also include any custom components that might hold translatable text directly
    root.querySelectorAll('*').forEach(el => {
      if (el.tagName.includes('-') && !elements.includes(el)) {
        elements.push(el);
      }
    });

    if (root.tagName && elements.indexOf(root) === -1) {
      elements.unshift(root);
    }

    for (const el of elements) {
      if (isElementExcluded(el) || isBoilerplateContainer(el)) continue;
      if (el.hasAttribute('data-polyglot-id')) continue;
      if (el.classList && (
        el.classList.contains('polyglot-translation-block') ||
        el.classList.contains('polyglot-translation-inline') ||
        el.classList.contains('polyglot-text-unit') ||
        el.id === 'polyglot-selection-card'
      )) continue;

      // Check child element composition
      const childElements = Array.from(el.children);
      const hasComplexChildren = childElements.some(child => !INLINE_TAGS.has(child.tagName.toUpperCase()));
      const hasChildBlocks = hasComplexChildren || Boolean(el.querySelector(CHILD_BLOCK_SELECTOR));

      if (!hasChildBlocks) {
        // Pure leaf block (contains only text nodes and phrasing tags like <a>, <b>, <i>, <span>)
        const text = el.innerText || el.textContent;
        if (isMeaningfulRun(text)) {
          units.push({
            element: el,
            isWrapped: false
          });
        }
      } else {
        // Container with nested child elements (e.g. <div lang="fr"> <b>Bienvenue</b>... <div>...</div> </div>)
        // Group consecutive inline child nodes between structural elements
        const childNodes = Array.from(el.childNodes);
        let currentRun = [];

        function flushRun() {
          if (currentRun.length === 0) return;
          const runText = currentRun.map(n => n.textContent || '').join('');
          if (isMeaningfulRun(runText)) {
            // Wrap this inline run into a span
            const span = document.createElement('span');
            span.className = 'polyglot-text-unit';
            span.setAttribute('data-polyglot-wrapped', 'true');

            // Insert wrapper before the first node of the run
            const first = currentRun[0];
            first.parentNode.insertBefore(span, first);

            // Move run nodes inside wrapper
            for (const n of currentRun) {
              span.appendChild(n);
            }

            units.push({
              element: span,
              isWrapped: true
            });
          }
          currentRun = [];
        }

        for (const child of childNodes) {
          // If child is script, style, or other ignored tags, flush any current run and skip the child completely
          if (child.nodeType === Node.ELEMENT_NODE && (IGNORED_TAGS.has(child.tagName.toUpperCase()) || isElementExcluded(child))) {
            flushRun();
            continue;
          }

          if (isStructuralElement(child)) {
            flushRun();
          } else {
            currentRun.push(child);
          }
        }
        flushRun();
      }
    }

    return units;
  }

  /**
   * Main Translation Controller
   */
  async function translatePage(targetLang = 'en', displayMode = 'replace') {
    if (isTranslating) return;
    isTranslating = true;
    currentTargetLang = targetLang;
    currentDisplayMode = displayMode;

    const candidateUnits = collectCandidateUnits(document.body);
    if (candidateUnits.length === 0) {
      isTranslating = false;
      return;
    }

    // Prepare batch items
    const batchItems = [];
    for (const unit of candidateUnits) {
      const el = unit.element;
      const id = ++elementIdCounter;
      el.setAttribute('data-polyglot-id', String(id));

      const originalChildNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
      const originalText = normalizeText(el.innerText || el.textContent);
      
      // Check for explicit lang attribute on element or closest ancestor
      const closestLangEl = el.closest('[lang]');
      const explicitLang = closestLangEl ? closestLangEl.getAttribute('lang') : null;
      const scriptHint = explicitLang || detectScriptHint(originalText);

      trackedUnits.set(id, {
        element: el,
        isWrapped: unit.isWrapped,
        originalChildNodes,
        originalText,
        displayMode,
        scriptHint,
        injectedNode: null
      });

      batchItems.push({
        id,
        text: originalText,
        scriptHint
      });
    }

    // Process in batches of 25 items
    const CHUNK_SIZE = 25;
    for (let i = 0; i < batchItems.length; i += CHUNK_SIZE) {
      const chunk = batchItems.slice(i, i + CHUNK_SIZE);
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'TRANSLATE_BATCH',
          items: chunk,
          targetLang
        });

        if (response && response.success && response.results) {
          applyTranslations(response.results, displayMode, targetLang);
        }
      } catch (err) {
        console.error('Error during chunk translation:', err);
      }

      // Yield briefly so browser can render smoothly
      await new Promise(r => requestAnimationFrame(r));
    }

    isTranslating = false;
    isPageTranslated = true;
    syncTabState();
    startMutationObserver();
  }

  /**
   * Applies returned translations to the DOM
   */
  function applyTranslations(results, displayMode, targetLang) {
    for (const res of results) {
      const tracked = trackedUnits.get(res.id);
      if (!tracked || !tracked.element) continue;

      const { element, originalHTML, originalText } = tracked;
      const detectedLang = res.detectedLang || 'unknown';

      // If the snippet was already in target language and unchanged, mark and skip DOM mutation
      if (res.isAlreadyTargetLang) {
        element.setAttribute('data-polyglot-skipped', 'true');
        continue;
      }

      // Increment stats for this detected language
      if (detectedLang && detectedLang !== 'unknown') {
        languageStats[detectedLang] = (languageStats[detectedLang] || 0) + 1;
        totalTranslatedCount++;
      }

      tracked.detectedLang = detectedLang;
      tracked.translatedText = res.translatedText;

      const langName = getLanguageName(detectedLang);
      const langBadge = `${detectedLang.toUpperCase()} → ${targetLang.toUpperCase()}`;

      if (displayMode === 'bilingual') {
        // Create a bilingual translation block/inline element
        const isInline = element.tagName === 'SPAN' || element.tagName === 'A';
        const transNode = document.createElement(isInline ? 'span' : 'div');
        transNode.className = isInline ? 'polyglot-translation-inline' : 'polyglot-translation-block';
        transNode.setAttribute('data-polyglot-for', String(res.id));
        transNode.setAttribute('translate', 'no');

        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'polyglot-lang-badge';
        badgeSpan.title = `Source: ${langName}`;
        badgeSpan.textContent = `[${langBadge}]`;

        transNode.appendChild(badgeSpan);
        transNode.appendChild(document.createTextNode(` ${res.translatedText}`));

        if (element.nextSibling) {
          element.parentNode.insertBefore(transNode, element.nextSibling);
        } else {
          element.parentNode.appendChild(transNode);
        }

        tracked.injectedNode = transNode;
      } else {
        // In-place replacement mode
        element.classList.add('polyglot-replaced');
        element.setAttribute('data-polyglot-detected', detectedLang);
        element.setAttribute('title', `Original (${langName}): ${originalText}`);

        element.textContent = res.translatedText;
      }
    }
  }

  /**
   * Restores the page to its original pristine state
   */
  function restorePage() {
    stopMutationObserver();

    // 1. Restore modified units
    for (const [id, tracked] of trackedUnits.entries()) {
      const { element, isWrapped, originalChildNodes, injectedNode, displayMode } = tracked;
      if (element && element.parentNode) {
        if (isWrapped) {
          // Unwrap span back into original child nodes
          if (originalChildNodes && originalChildNodes.length > 0) {
            for (const child of originalChildNodes) {
              element.parentNode.insertBefore(child, element);
            }
          }
          element.remove();
        } else {
          if (displayMode === 'replace') {
            if (originalChildNodes && originalChildNodes.length > 0) {
              element.textContent = '';
              for (const child of originalChildNodes) {
                element.appendChild(child);
              }
            }
            element.classList.remove('polyglot-replaced');
            element.removeAttribute('data-polyglot-detected');
            element.removeAttribute('title');
          }
          element.removeAttribute('data-polyglot-id');
          element.removeAttribute('data-polyglot-skipped');
        }
      }

      // 2. Remove injected bilingual blocks
      if (injectedNode && injectedNode.parentNode) {
        injectedNode.parentNode.removeChild(injectedNode);
      }
    }

    // 3. Clean up any stray polyglot elements
    document.querySelectorAll('.polyglot-translation-block, .polyglot-translation-inline').forEach(el => el.remove());
    document.querySelectorAll('.polyglot-text-unit').forEach(el => {
      // If any wrapped span remains, unwrap it
      while (el.firstChild) {
        el.parentNode.insertBefore(el.firstChild, el);
      }
      el.remove();
    });
    document.querySelectorAll('[data-polyglot-id]').forEach(el => {
      el.removeAttribute('data-polyglot-id');
      el.removeAttribute('data-polyglot-skipped');
    });

    trackedUnits.clear();
    for (const key of Object.keys(languageStats)) {
      delete languageStats[key];
    }
    totalTranslatedCount = 0;
    isPageTranslated = false;
    isTranslating = false;

    removeSelectionPopup();
    syncTabState();
  }

  /**
   * MutationObserver for dynamic websites and infinite scrolling feeds
   */
  function startMutationObserver() {
    if (mutationObserver) return;

    mutationObserver = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('polyglot-translation-block')) {
              hasNewNodes = true;
              break;
            }
          }
        }
        if (hasNewNodes) break;
      }

      if (hasNewNodes) {
        clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(() => {
          if (isPageTranslated && !isTranslating) {
            translateNewNodes();
          }
        }, 400);
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopMutationObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    clearTimeout(mutationTimeout);
  }

  async function translateNewNodes() {
    const newUnits = collectCandidateUnits(document.body);
    if (newUnits.length === 0) return;

    const batchItems = [];
    for (const unit of newUnits) {
      const el = unit.element;
      const id = ++elementIdCounter;
      el.setAttribute('data-polyglot-id', String(id));

      const originalChildNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
      const originalText = normalizeText(el.innerText || el.textContent);
      const closestLangEl = el.closest('[lang]');
      const explicitLang = closestLangEl ? closestLangEl.getAttribute('lang') : null;
      const scriptHint = explicitLang || detectScriptHint(originalText);

      trackedUnits.set(id, {
        element: el,
        isWrapped: unit.isWrapped,
        originalChildNodes,
        originalText,
        displayMode: currentDisplayMode,
        scriptHint,
        injectedNode: null
      });

      batchItems.push({ id, text: originalText, scriptHint });
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'TRANSLATE_BATCH',
        items: batchItems,
        targetLang: currentTargetLang
      });

      if (response && response.success && response.results) {
        applyTranslations(response.results, currentDisplayMode, currentTargetLang);
        syncTabState();
      }
    } catch (err) {
      console.error('Error translating dynamic nodes:', err);
    }
  }

  /**
   * Helper to format concise, non-cluttered language statistics summary
   */
  function formatLanguageSummary() {
    const keys = Object.keys(languageStats);
    if (keys.length === 0) {
      return totalTranslatedCount > 0 ? `Translated ${totalTranslatedCount} blocks.` : 'Page translated.';
    }

    const sorted = keys.sort((a, b) => languageStats[b] - languageStats[a]);
    const topCount = 3;
    const topLangs = sorted.slice(0, topCount).map(k => `${getLanguageName(k)}: ${languageStats[k]}`);

    let summary = `Translated ${totalTranslatedCount} blocks across ${keys.length} ${keys.length === 1 ? 'language' : 'languages'}`;
    if (keys.length <= topCount) {
      summary += ` (${topLangs.join(', ')})`;
    } else {
      const remaining = keys.length - topCount;
      summary += ` (${topLangs.join(', ')} + ${remaining} more)`;
    }

    return summary;
  }

  /**
   * Syncs tab state with the background service
   */
  function syncTabState() {
    chrome.runtime.sendMessage({
      action: 'UPDATE_TAB_STATE',
      state: {
        isTranslated: isPageTranslated,
        isTranslating,
        displayMode: currentDisplayMode,
        targetLang: currentTargetLang,
        stats: {
          total: totalTranslatedCount,
          languages: { ...languageStats }
        }
      }
    }).catch(() => {});
  }



  /**
   * Selection Translation Tooltip
   */
  async function translateSelection(selectedText, targetLang) {
    if (!selectedText || !selectedText.trim()) return;

    removeSelectionPopup();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const card = document.createElement('div');
    card.id = 'polyglot-selection-card';
    card.setAttribute('translate', 'no');
    card.style.top = `${window.scrollY + rect.bottom + 6}px`;
    card.style.left = `${Math.max(10, window.scrollX + rect.left)}px`;
    const header = document.createElement('div');
    header.className = 'polyglot-sel-header';

    const headerTitle = document.createElement('span');
    headerTitle.textContent = 'Translating selection...';

    const headerClose = document.createElement('span');
    headerClose.id = 'polyglot-sel-close';
    headerClose.style.cursor = 'pointer';
    headerClose.textContent = '✕';

    header.appendChild(headerTitle);
    header.appendChild(headerClose);

    const body = document.createElement('div');
    body.className = 'polyglot-sel-body';
    body.textContent = `Translating to ${getLanguageName(targetLang)}...`;

    card.appendChild(header);
    card.appendChild(body);

    document.body.appendChild(card);
    headerClose.addEventListener('click', removeSelectionPopup);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'TRANSLATE_BATCH',
        items: [{ id: 1, text: selectedText }],
        targetLang
      });

      if (response && response.results && response.results[0]) {
        const item = response.results[0];
        const langName = getLanguageName(item.detectedLang);
        card.querySelector('.polyglot-sel-header span').textContent = `${langName} → ${getLanguageName(targetLang)}`;
        card.querySelector('.polyglot-sel-body').textContent = item.translatedText;
      }
    } catch (err) {
      card.querySelector('.polyglot-sel-body').textContent = `Translation failed: ${err.message}`;
    }
  }

  function removeSelectionPopup() {
    const card = document.getElementById('polyglot-selection-card');
    if (card) card.remove();
  }

  document.addEventListener('mousedown', (e) => {
    const card = document.getElementById('polyglot-selection-card');
    if (card && !card.contains(e.target)) {
      removeSelectionPopup();
    }
  });

  /**
   * Message listener from popup / background
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TRANSLATE_PAGE') {
      translatePage(message.targetLang, message.displayMode);
      sendResponse({ success: true, started: true });
    } else if (message.action === 'RESTORE_PAGE') {
      restorePage();
      sendResponse({ success: true, restored: true });
    } else if (message.action === 'GET_STATUS') {
      sendResponse({
        isTranslated: isPageTranslated,
        isTranslating,
        displayMode: currentDisplayMode,
        targetLang: currentTargetLang,
        stats: {
          total: totalTranslatedCount,
          languages: { ...languageStats }
        }
      });
    } else if (message.action === 'TRANSLATE_SELECTION') {
      translateSelection(message.selectedText, message.targetLang);
      sendResponse({ success: true });
    }
    return true;
  });

  // Check for auto-translate on initial page load
  chrome.runtime.sendMessage({ action: 'GET_SETTINGS' }).then((response) => {
    if (response && response.settings) {
      const { autoTranslateAllPages, autoTranslateDomains, targetLang, displayMode } = response.settings;
      const currentHost = window.location.hostname;
      const shouldAutoTranslate = Boolean(
        autoTranslateAllPages || 
        (autoTranslateDomains && autoTranslateDomains.includes(currentHost))
      );

      if (shouldAutoTranslate) {
        setTimeout(() => {
          translatePage(targetLang, displayMode);
        }, 800);
      }
    }
  }).catch(() => {});
})();
