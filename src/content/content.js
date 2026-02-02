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

  // React to settings changes (e.g., user changes theme in options page)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
      const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue || {};
      if (newSettings.theme) currentTheme = newSettings.theme;
    }
  });

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
})();
