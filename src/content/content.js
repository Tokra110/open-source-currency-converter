/**
 * Content script: listens for text selection changes,
 * runs currency detection, and communicates with the service worker.
 */

(() => {
  let debounceTimer = null;
  let lastDetection = null;
  let extensionEnabled = true;
  let currentTooltip = null;

  // Load initial settings
  initSettings();

  // Listen for selection changes
  document.addEventListener('selectionchange', onSelectionChange);

  // Listen for settings changes
  chrome.storage.onChanged.addListener(onStorageChange);

  function onSelectionChange() {
    if (!extensionEnabled) return;

    // Clear existing tooltip on any selection change
    if (currentTooltip) {
      currentTooltip.remove();
      currentTooltip = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      processSelection();
    }, 300);
  }

  async function processSelection() {
    const selection = window.getSelection();
    const text = selection?.toString().trim();

    if (!text || text.length === 0 || text.length > 200) {
      if (lastDetection) {
        lastDetection = null;
        sendMessage({ type: 'no-currency' });
      }
      return;
    }

    // Get number format setting
    const settings = await getSettings();
    const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat);

    if (!detection) {
      if (lastDetection) {
        lastDetection = null;
        sendMessage({ type: 'no-currency' });
      }
      return;
    }

    // Apply user's default dollar currency preference
    if (detection.currencies.length > 1 && settings.defaultDollarCurrency) {
      const idx = detection.currencies.indexOf(settings.defaultDollarCurrency);
      if (idx > 0) {
        detection.currencies.splice(idx, 1);
        detection.currencies.unshift(settings.defaultDollarCurrency);
      }
    }

    lastDetection = detection;
    sendMessage({ type: 'currency-detected', detection });
  }

  function onStorageChange(changes, area) {
    if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
      const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue || DEFAULT_SETTINGS;
      extensionEnabled = newSettings.enabled;

      if (!extensionEnabled && lastDetection) {
        lastDetection = null;
        sendMessage({ type: 'no-currency' });
      }
    }
  }

  async function initSettings() {
    const settings = await getSettings();
    extensionEnabled = settings.enabled;
  }

  async function getSettings() {
    try {
      const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
      return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  function sendMessage(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      // Extension context may be invalidated, ignore
    }
  }

  // --- Tooltip Logic ---



  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'show-conversion') {
      showTooltip(message.data);
    }
  });

  function showTooltip(data) {
    if (currentTooltip) {
      currentTooltip.remove();
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = document.createElement('div');
    tooltip.id = 'currency-converter-tooltip';

    // Format converted amount
    const formattedAmount = data.convertedAmount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const displayText = `${formattedAmount} ${data.targetCurrency}`;

    tooltip.innerHTML = `
      <div class="cc-tooltip-content">
        <span class="cc-label">Converted:</span>
        <span class="cc-value">${displayText}</span>
        <span class="cc-hint">Click to copy</span>
      </div>
    `;

    // Premium styling
    injectStyles();

    document.body.appendChild(tooltip);
    currentTooltip = tooltip;

    // Position tooltip
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    tooltip.style.left = `${rect.left + scrollX + rect.width / 2}px`;
    tooltip.style.top = `${rect.top + scrollY - 10}px`;

    // Click to copy
    tooltip.addEventListener('click', () => {
      navigator.clipboard.writeText(formattedAmount).then(() => {
        const hint = tooltip.querySelector('.cc-hint');
        if (hint) {
          hint.textContent = 'Copied!';
          hint.classList.add('cc-copied');
          setTimeout(() => {
            if (tooltip.parentNode) tooltip.remove();
            currentTooltip = null;
          }, 1000);
        }
      });
    });

    // Close on click outside or escape
    const closeHandler = (e) => {
      if (!tooltip.contains(e.target)) {
        tooltip.remove();
        currentTooltip = null;
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  function injectStyles() {
    if (document.getElementById('currency-converter-styles')) return;

    const style = document.createElement('style');
    style.id = 'currency-converter-styles';
    style.textContent = `
      #currency-converter-tooltip {
        position: absolute;
        z-index: 2147483647;
        transform: translate(-50%, -100%);
        background: rgba(30, 30, 30, 0.95);
        color: white;
        padding: 8px 14px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        user-select: none;
        transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s;
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(8px);
        animation: cc-bounce 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      #currency-converter-tooltip:hover {
        background: rgba(40, 40, 40, 0.98);
        transform: translate(-50%, -105%) scale(1.02);
      }

      .cc-tooltip-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .cc-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        opacity: 0.7;
      }

      .cc-value {
        font-weight: 600;
        font-size: 16px;
        background: linear-gradient(135deg, #fff 0%, #aaa 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .cc-hint {
        font-size: 10px;
        opacity: 0.5;
        margin-top: 4px;
        transition: color 0.2s;
      }

      .cc-hint.cc-copied {
        color: #4ade80;
        opacity: 1;
        font-weight: bold;
      }

      @keyframes cc-bounce {
        0% { transform: translate(-50%, -80%) scale(0.8); opacity: 0; }
        100% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }
})();
