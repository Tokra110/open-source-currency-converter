/**
 * Content script: listens for text selection changes,
 * runs currency detection, and communicates with the service worker.
 */

(() => {
  let debounceTimer = null;
  let lastDetection = null;
  let currentTheme = DEFAULT_SETTINGS.theme;
  let settingsCache = null;
  let settingsLoadPromise = null;
  let settingsCacheVersion = 0;
  let scannerRates = null;
  let scannerInitialized = false;
  let scannerUpdateVersion = 0;
  const siteHostname = getSiteHostname(window.location);

  // Load initial theme setting
  getSettings().then(s => { currentTheme = s.theme; });

  // Listen for selection changes
  document.addEventListener('selectionchange', onSelectionChange);

  // Clean up on page unload (pagehide preserves bfcache compatibility)
  window.addEventListener('pagehide', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    CurrencyTooltip.remove();
  });

  // Listen for conversion responses from the service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'show-conversion') {
      CurrencyTooltip.show(message.data, currentTheme);
    }
  });

  function onSelectionChange() {
    // Clear existing tooltip on any selection change
    CurrencyTooltip.remove();

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      processSelection();
    }, TIMING.DEBOUNCE_MS);
  }

  async function processSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (!text || text.length === 0 || text.length > LIMITS.MAX_SELECTION_LENGTH) {
      lastDetection = null;
      return;
    }

    const settings = await getSettings();

    // Selection tooltips are available in both Interactive and Hybrid modes.
    if (!settings.extensionEnabled) {
      lastDetection = null;
      return;
    }

    // Check Site-Specific Disable
    if (isSiteDisabled(settings)) {
      lastDetection = null;
      return;
    }

    const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat, {
      maxLength: LIMITS.MAX_SELECTION_LENGTH,
      startIndex: 0,
    });

    if (!detection) {
      lastDetection = null;
      return;
    }

    // Currency reordering is handled by the service worker
    lastDetection = { ...detection, selectionText: text };
    sendMessage({ type: 'currency-detected', detection: lastDetection });
  }

  async function getSettings() {
    if (settingsCache) return settingsCache;
    if (settingsLoadPromise) return settingsLoadPromise;

    const loadVersion = settingsCacheVersion;
    let loadPromise;
    loadPromise = chrome.storage.sync.get(STORAGE_KEYS.SETTINGS)
      .then((result) => {
        const loadedSettings = {
          ...DEFAULT_SETTINGS,
          ...(result[STORAGE_KEYS.SETTINGS] || {}),
        };
        if (loadVersion === settingsCacheVersion) {
          settingsCache = loadedSettings;
        }
        return settingsCache || loadedSettings;
      })
      .catch((err) => {
        console.warn('[OpenSourceCurrencyConverter] Failed to load settings:', err);
        const fallbackSettings = { ...DEFAULT_SETTINGS };
        if (loadVersion === settingsCacheVersion) {
          settingsCache = fallbackSettings;
        }
        return settingsCache || fallbackSettings;
      })
      .finally(() => {
        if (settingsLoadPromise === loadPromise) {
          settingsLoadPromise = null;
        }
      });

    settingsLoadPromise = loadPromise;
    return loadPromise;
  }

  function sendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // Extension context may be invalidated after update/reload
    }
  }

  // --- Page Scanner Integration ---

  /**
   * Initialize the page scanner.
   * Loads rates only when Hybrid scanning is active for this site.
   */
  async function initPageScanner() {
    const settings = await getSettings();
    await applyPageScannerSettings(settings);
  }

  async function applyPageScannerSettings(settings) {
    const updateVersion = ++scannerUpdateVersion;
    const needsRates = shouldLoadPageScannerRates(settings, siteHostname);

    if (needsRates && !scannerRates) {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'get-rates' });
        if (response?.rates) {
          scannerRates = response.rates;
        }
      } catch (err) {
        console.warn('[OpenSourceCurrencyConverter] Failed to load scanner rates:', err);
      }
    }

    if (updateVersion !== scannerUpdateVersion) return;
    if (needsRates && !scannerRates) return;

    const ratesForSettings = needsRates ? scannerRates : null;
    if (!scannerInitialized) {
      PageScanner.init(settings, ratesForSettings);
      scannerInitialized = true;
      return;
    }
    PageScanner.updateSettings(settings, ratesForSettings);
  }

  // Initialize scanner on page load
  initPageScanner();

  // Re-initialize scanner when settings change
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
      const newSettings = {
        ...DEFAULT_SETTINGS,
        ...(changes[STORAGE_KEYS.SETTINGS].newValue || {}),
      };
      settingsCache = newSettings;
      settingsCacheVersion++;
      settingsLoadPromise = null;

      // Check if current site status changed
      const oldDisabled = isSiteDisabled({ ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.SETTINGS].oldValue || {}) });
      const newDisabled = isSiteDisabled(newSettings);

      if (newDisabled !== oldDisabled) {
        if (newDisabled) {
          // Site just got disabled
          CurrencyTooltip.remove();
          // PageScanner doesn't have a public 'stop' method yet, but it checks settings internally
        }
      }

      // Update theme for tooltip (and apply to any visible tooltip immediately)
      if (newSettings.theme) {
        const oldTheme = currentTheme;
        currentTheme = newSettings.theme;

        // Update existing tooltip theme class if visible
        const tooltip = document.getElementById('currency-converter-tooltip');
        if (tooltip && oldTheme !== currentTheme) {
          const resolvedOld = oldTheme === 'system'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : oldTheme;
          const resolvedNew = currentTheme === 'system'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : currentTheme;
          tooltip.classList.remove(`cc-theme-${resolvedOld}`);
          tooltip.classList.add(`cc-theme-${resolvedNew}`);
        }
      }

      await applyPageScannerSettings(newSettings);
    }
  });

  function isSiteDisabled(settings) {
    if (!settings.disabledDomains) return false;
    return settings.disabledDomains.includes(siteHostname);
  }
})();
