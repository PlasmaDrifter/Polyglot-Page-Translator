/**
 * Polyglot Page Translator - Options Page Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const providerSelect = document.getElementById('provider-select');
  const libreGroup = document.getElementById('libre-group');
  const libreUrl = document.getElementById('libre-url');
  const libreKey = document.getElementById('libre-key');
  const deeplGroup = document.getElementById('deepl-group');
  const deeplKey = document.getElementById('deepl-key');
  const deeplUrl = document.getElementById('deepl-url');
  const defaultLangSelect = document.getElementById('default-lang-select');
  const defaultModeSelect = document.getElementById('default-mode-select');
  const chkAutoAll = document.getElementById('chk-auto-all');
  const newDomainInput = document.getElementById('new-domain-input');
  const btnAddDomain = document.getElementById('btn-add-domain');
  const domainsList = document.getElementById('domains-list');
  const btnSave = document.getElementById('btn-save');
  const saveStatus = document.getElementById('save-status');

  let currentSettings = {};

  // Populate default languages
  SUPPORTED_LANGUAGES.forEach(lang => {
    const opt = document.createElement('option');
    opt.value = lang.code;
    opt.textContent = `${lang.name} (${lang.native})`;
    defaultLangSelect.appendChild(opt);
  });

  // Toggle provider groups
  function updateProviderVisibility() {
    const provider = providerSelect.value;
    libreGroup.style.display = provider === 'libretranslate' ? 'flex' : 'none';
    deeplGroup.style.display = provider === 'deepl' ? 'flex' : 'none';
  }

  providerSelect.addEventListener('change', updateProviderVisibility);

  // Render auto-translate domains
  function renderDomains(domains = []) {
    domainsList.textContent = '';
    if (domains.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'domains-empty';
      emptyDiv.textContent = 'No domains configured. You can add websites above or toggle from the popup.';
      domainsList.appendChild(emptyDiv);
      return;
    }

    domains.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'domain-item';

      const domainSpan = document.createElement('span');
      domainSpan.textContent = domain;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'domain-delete-btn';
      deleteBtn.textContent = 'Remove';
      deleteBtn.setAttribute('data-domain', domain);

      deleteBtn.addEventListener('click', async () => {
        currentSettings.autoTranslateDomains = currentSettings.autoTranslateDomains.filter(d => d !== domain);
        renderDomains(currentSettings.autoTranslateDomains);
        await saveCurrentSettings();
      });

      item.appendChild(domainSpan);
      item.appendChild(deleteBtn);
      domainsList.appendChild(item);
    });
  }

  // Add domain handler
  function handleAddDomain() {
    let val = newDomainInput.value.trim().toLowerCase();
    if (!val) return;

    // Clean protocol or path if user pasted a full URL
    val = val.replace(/^[a-zA-Z]+:\/\//, '').replace(/\/.*$/, '').trim();
    if (!val) return;

    if (!currentSettings.autoTranslateDomains) {
      currentSettings.autoTranslateDomains = [];
    }

    if (!currentSettings.autoTranslateDomains.includes(val)) {
      currentSettings.autoTranslateDomains.push(val);
      renderDomains(currentSettings.autoTranslateDomains);
      newDomainInput.value = '';
      saveCurrentSettings();
    } else {
      newDomainInput.value = '';
    }
  }

  btnAddDomain.addEventListener('click', handleAddDomain);
  newDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddDomain();
    }
  });

  // Load existing settings
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
    currentSettings = (response && response.settings) || {};

    providerSelect.value = currentSettings.provider || 'google';
    libreUrl.value = currentSettings.libreTranslateUrl || 'https://translate.argosopentech.com';
    libreKey.value = currentSettings.libreTranslateApiKey || '';
    deeplKey.value = currentSettings.deeplApiKey || '';
    deeplUrl.value = currentSettings.deeplApiUrl || 'https://api-free.deepl.com';
    defaultLangSelect.value = currentSettings.targetLang || 'en';
    defaultModeSelect.value = currentSettings.displayMode || 'replace';
    concurrencyInput.value = currentSettings.concurrencyLimit || 6;
    chkAutoAll.checked = Boolean(currentSettings.autoTranslateAllPages);

    updateProviderVisibility();
    renderDomains(currentSettings.autoTranslateDomains || []);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }

  async function saveCurrentSettings() {
    const newSettings = {
      provider: providerSelect.value,
      libreTranslateUrl: libreUrl.value.trim(),
      libreTranslateApiKey: libreKey.value.trim(),
      deeplApiKey: deeplKey.value.trim(),
      deeplApiUrl: deeplUrl.value,
      targetLang: defaultLangSelect.value,
      displayMode: defaultModeSelect.value,
      concurrencyLimit: parseInt(concurrencyInput.value, 10) || 6,
      autoTranslateAllPages: chkAutoAll.checked,
      autoTranslateDomains: currentSettings.autoTranslateDomains || []
    };

    const res = await chrome.runtime.sendMessage({
      action: 'SET_SETTINGS',
      settings: newSettings
    });

    if (res && res.success) {
      saveStatus.textContent = 'Settings saved successfully.';
      setTimeout(() => {
        saveStatus.textContent = '';
      }, 2500);
    }
  }

  btnSave.addEventListener('click', saveCurrentSettings);
});
