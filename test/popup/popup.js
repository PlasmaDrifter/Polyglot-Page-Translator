/**
 * Polyglot Page Translator - Popup Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const selectTargetLang = document.getElementById('select-target-lang');
  const modeReplace = document.getElementById('mode-replace');
  const modeBilingual = document.getElementById('mode-bilingual');
  const btnTranslate = document.getElementById('btn-translate');
  const btnOptions = document.getElementById('btn-options');
  const statsPanel = document.getElementById('stats-panel');
  const statsTotal = document.getElementById('stats-total');
  const statsList = document.getElementById('stats-list');
  const chkAutoDomain = document.getElementById('chk-auto-domain');
  const autoDomainLabel = document.getElementById('auto-domain-label');
  const statusIndicator = document.getElementById('status-indicator');
  const engineBadge = document.getElementById('engine-badge');

  let currentTab = null;
  let currentHost = '';
  let activeSettings = null;

  // 1. Populate Target Language Dropdown
  function populateLanguages(selectedCode = 'en') {
    selectTargetLang.textContent = '';
    // Sort with common languages first, then alphabetical
    const priority = ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ru', 'pt', 'it', 'ko', 'ar'];
    const sorted = [...SUPPORTED_LANGUAGES].sort((a, b) => {
      const aP = priority.indexOf(a.code);
      const bP = priority.indexOf(b.code);
      if (aP !== -1 && bP !== -1) return aP - bP;
      if (aP !== -1) return -1;
      if (bP !== -1) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const lang of sorted) {
      const opt = document.createElement('option');
      opt.value = lang.code;
      opt.textContent = `${lang.name} (${lang.native})`;
      if (lang.code === selectedCode) {
        opt.selected = true;
      }
      selectTargetLang.appendChild(opt);
    }
  }

  // 2. Fetch Settings and Active Tab
  try {
    const settingsResponse = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    activeSettings = (settingsResponse && settingsResponse.settings) || {};

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (currentTab && currentTab.url) {
      try {
        const parsedUrl = new URL(currentTab.url);
        currentHost = parsedUrl.hostname;
        autoDomainLabel.textContent = `Always translate ${currentHost}`;
        const autoDomains = activeSettings.autoTranslateDomains || [];
        chkAutoDomain.checked = autoDomains.includes(currentHost);
      } catch (e) {
        currentHost = '';
        chkAutoDomain.disabled = true;
      }
    }

    // Set initial form controls
    populateLanguages(activeSettings.targetLang || 'en');
    if (activeSettings.displayMode === 'bilingual') {
      modeBilingual.checked = true;
    } else {
      modeReplace.checked = true;
    }

    if (activeSettings.provider) {
      engineBadge.textContent = activeSettings.provider.toUpperCase();
    }

    // Query active tab state
    await refreshTabState();
  } catch (err) {
    console.error('Initialization error in popup:', err);
    statusIndicator.textContent = 'Error connecting';
  }

  // 3. Render Detected Languages Stats
  function renderStats(stats) {
    statsList.textContent = '';
    if (!stats || !stats.languages || Object.keys(stats.languages).length === 0) {
      statsTotal.textContent = `${stats?.total || 0} Blocks`;
      const emptySpan = document.createElement('span');
      emptySpan.className = 'stats-empty';
      emptySpan.textContent = 'Click "Translate Page" to detect and translate all languages on this page.';
      statsList.appendChild(emptySpan);
      return;
    }

    statsTotal.textContent = `${stats.total} Blocks`;

    const sortedEntries = Object.entries(stats.languages).sort((a, b) => b[1] - a[1]);

    for (const [code, count] of sortedEntries) {
      const chip = document.createElement('div');
      chip.className = 'stats-chip';
      const langName = getLanguageName(code);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = langName;

      const countSpan = document.createElement('span');
      countSpan.className = 'stats-chip-count';
      countSpan.textContent = String(count);

      chip.appendChild(nameSpan);
      chip.appendChild(countSpan);
      statsList.appendChild(chip);
    }
  }

  // 4. Refresh State from Content Script or Background
  async function refreshTabState() {
    if (!currentTab || !currentTab.id) return;

    try {
      // Try asking content script directly
      const status = await chrome.tabs.sendMessage(currentTab.id, { action: 'GET_STATUS' });
      if (status) {
        updateUIWithState(status);
        return;
      }
    } catch (e) {
      // Content script may not be loaded or page is restricted
    }

    // Fallback: check background state tracker
    try {
      const bgState = await chrome.runtime.sendMessage({ action: 'GET_TAB_STATE', tabId: currentTab.id });
      if (bgState && bgState.state) {
        updateUIWithState(bgState.state);
      }
    } catch (e) {
      // Background unavailable
    }
  }

  function updateUIWithState(state) {
    if (state.isTranslating) {
      statusIndicator.textContent = 'Translating...';
      btnTranslate.disabled = true;
    } else if (state.isTranslated) {
      statusIndicator.textContent = 'Page Translated';
      btnTranslate.disabled = false;
      btnTranslate.textContent = 'Re-translate';
    } else {
      statusIndicator.textContent = 'Ready';
      btnTranslate.disabled = false;
      btnTranslate.textContent = 'Translate Page';
    }

    if (state.targetLang) {
      selectTargetLang.value = state.targetLang;
    }

    if (state.displayMode) {
      if (state.displayMode === 'bilingual') modeBilingual.checked = true;
      else modeReplace.checked = true;
    }

    renderStats(state.stats);
  }

  // 5. Handle Translate Click
  btnTranslate.addEventListener('click', async () => {
    if (!currentTab || !currentTab.id) return;

    const targetLang = selectTargetLang.value;
    const displayMode = modeReplace.checked ? 'replace' : 'bilingual';

    statusIndicator.textContent = 'Translating...';
    btnTranslate.disabled = true;

    // Save choice to settings
    await chrome.runtime.sendMessage({
      action: 'SET_SETTINGS',
      settings: { targetLang, displayMode }
    });

    try {
      // Send translation command to content script
      await chrome.tabs.sendMessage(currentTab.id, {
        action: 'TRANSLATE_PAGE',
        targetLang,
        displayMode
      });

      // Poll briefly to update stats
      setTimeout(async () => {
        await refreshTabState();
      }, 800);
      setTimeout(async () => {
        await refreshTabState();
      }, 2000);
    } catch (err) {
      console.error('Failed to dispatch translation:', err);
      statusIndicator.textContent = 'Cannot translate this page';
      btnTranslate.disabled = false;
    }
  });

  // 7. Auto-domain Toggle
  chkAutoDomain.addEventListener('change', async () => {
    if (!currentHost) return;

    const res = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    const settings = (res && res.settings) || {};
    let autoDomains = settings.autoTranslateDomains || [];

    if (chkAutoDomain.checked) {
      if (!autoDomains.includes(currentHost)) autoDomains.push(currentHost);
    } else {
      autoDomains = autoDomains.filter(d => d !== currentHost);
    }

    await chrome.runtime.sendMessage({
      action: 'SET_SETTINGS',
      settings: { autoTranslateDomains: autoDomains }
    });
  });

  // 8. Open Options Page
  btnOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
});
