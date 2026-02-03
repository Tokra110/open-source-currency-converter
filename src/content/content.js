/**
 * Content script: listens for text selection changes,
 * runs currency detection, and communicates with the service worker.
 */

(() => {
  let debounceTimer = null;
  let lastDetection = null;
  let currentTheme = DEFAULT_SETTINGS.theme;

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

    // Check Global Toggle + Interactive Mode
    if (!settings.extensionEnabled || settings.conversionMode !== 'interactive') {
      lastDetection = null;
      return;
    }

    // Check Site-Specific Disable
    if (isSiteDisabled(settings)) {
      lastDetection = null;
      return;
    }

    const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat);

    if (!detection) {
      lastDetection = null;
      return;
    }

    // Currency reordering is handled by the service worker
    lastDetection = { ...detection, selectionText: text };
    sendMessage({ type: 'currency-detected', detection: lastDetection });
  }

  async function getSettings() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
      return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
    } catch (err) {
      console.warn('[CurrencyConverter] Failed to load settings:', err);
      return DEFAULT_SETTINGS;
    }
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
   * Requests rates from service worker and passes them to the scanner.
   * Scanner itself checks if it should be enabled based on settings.
   */
  async function initPageScanner() {
    const settings = await getSettings();
    // We pass settings regardless; PageScanner determines if it runs.

    try {
      const response = await chrome.runtime.sendMessage({ type: 'get-rates' });
      if (response && response.rates) {
        PageScanner.init(settings, response.rates);
      }
    } catch (err) {
      console.warn('[CurrencyConverter] Failed to init page scanner:', err);
    }
  }

  // Initialize scanner on page load
  initPageScanner();

  // Re-initialize scanner when settings change
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
      const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue || {};

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

      // Update theme for tooltip
      if (newSettings.theme) currentTheme = newSettings.theme;

      // Update page scanner
      try {
        const response = await chrome.runtime.sendMessage({ type: 'get-rates' });
        if (response && response.rates) {
          PageScanner.updateSettings(newSettings, response.rates);
        }
      } catch {
        // Extension context may be invalidated
      }
    }
  });

  function isSiteDisabled(settings) {
    if (!settings.disabledDomains) return false;
    return settings.disabledDomains.includes(window.location.hostname);
  }
})();
