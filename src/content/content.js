/**
 * Content script: listens for text selection changes,
 * runs currency detection, and communicates with the service worker.
 */

(() => {
  let debounceTimer = null;
  let lastDetection = null;

  let currentTooltip = null;

  // Load initial settings
  initSettings();

  // Listen for selection changes
  document.addEventListener('selectionchange', onSelectionChange);

  // Listen for settings changes
  chrome.storage.onChanged.addListener(onStorageChange);

  function onSelectionChange() {


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
      lastDetection = null;
      return;
    }

    // Get number format setting
    const settings = await getSettings();
    const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat);

    if (!detection) {
      lastDetection = null;
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

    lastDetection = { ...detection, selectionText: text };
    sendMessage({ type: 'currency-detected', detection: lastDetection });
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
    // If tooltip exists, update it instead of removing
    if (currentTooltip) {
      updateTooltip(data);
      return;
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = document.createElement('div');
    tooltip.id = 'currency-converter-tooltip';

    const formattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    const displayText = `${formattedAmount} ${data.targetCurrency}`;

    let headerHtml = `<span class="cc-label">Converted:</span>`;

    // If we have multiple possible currencies, show a toggle list
    if (data.possibleCurrencies && data.possibleCurrencies.length > 1) {
      headerHtml = buildHeaderHtml(data);
      tooltip.classList.add('cc-has-multiple');
    }

    tooltip.innerHTML = `
      <div class="cc-tooltip-content">
        ${headerHtml}
        <div class="cc-value-container">
          <span class="cc-value">${displayText}</span>
        </div>
        <span class="cc-hint">Click to copy</span>
      </div>
    `;

    // Premium styling
    injectStyles();

    document.body.appendChild(tooltip);
    currentTooltip = tooltip;

    // Attach event listeners for pills & copy
    attachTooltipListeners(tooltip, data);

    // Position tooltip
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    tooltip.style.left = `${rect.left + scrollX + rect.width / 2}px`;
    tooltip.style.top = `${rect.top + scrollY - 10}px`;

    // Global close handler
    const closeHandler = (e) => {
      if (tooltip.parentNode && !tooltip.contains(e.target)) {
        tooltip.remove();
        if (currentTooltip === tooltip) currentTooltip = null;
        document.removeEventListener('mousedown', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closeHandler), 10);
  }

  function updateTooltip(data) {
    if (!currentTooltip) return;

    // Update pills active state
    if (data.possibleCurrencies && data.possibleCurrencies.length > 1) {
      if (!currentTooltip.classList.contains('cc-has-multiple')) {
        currentTooltip.classList.add('cc-has-multiple');
      }

      const pills = currentTooltip.querySelectorAll('.cc-currency-pill');
      pills.forEach(pill => {
        if (pill.dataset.currency === data.originalCurrency) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });

      // Update data references for listeners
      attachTooltipListeners(currentTooltip, data);
      // Note: Re-attaching listeners might duplicate if not careful, 
      // but here we are mainly needing to update the closure 'data' for the copy action?
      // Actually, 'data' in 'attachTooltipListeners' is used for Recalculation (which sends current values).
      // We should probably just update the cached 'data' implementation or re-render pills if needed.
      // Simpler approach for now: The pills have the currency in dataset.

      // We need to update the data object stored/used by the click handlers if we want them to be "fresh".
      // However, the pill click handler builds the request based on `pill.dataset.currency` and `currentData` closure.
      // To fix closure staleness, we can't easily "update" the closure of existing listeners.
      // It's safer to re-render the pills area or implement a more robust state management.
      // Given the simplicity, let's just re-render the header if it exists.

      const headerRow = currentTooltip.querySelector('.cc-header-row');
      if (headerRow) {
        // Re-render header to ensure listeners have fresh 'data' closure if strictly needed,
        // BUT wait, formatting 'from' currency might be enough? 
        // Actually, let's keep it simple: just update styling.
        // For the NEXT click, the pill listeners need to know what the CURRENT target/amount logic is.
        // But wait, the pill listeners use `data` from the closure of the *creation* time.
        // If we don't re-attach listeners, they will use old `data`.
        // So we SHOULD re-render the header to be safe and simple.
        const headerContainer = currentTooltip.querySelector('.cc-header-wrapper'); // We'll add a wrapper
        if (headerContainer) {
          headerContainer.innerHTML = buildHeaderHtml(data);
          attachPillListeners(currentTooltip, data);
        } else {
          // Fallback if structure is different (initial migration)
          const oldHeader = currentTooltip.querySelector('.cc-header-row');
          if (oldHeader) {
            oldHeader.outerHTML = `<div class="cc-header-wrapper">${buildHeaderHtml(data)}</div>`;
            attachPillListeners(currentTooltip, data);
          }
        }
      }
    } else {
      currentTooltip.classList.remove('cc-has-multiple');
    }

    // Animate Value
    // Animate Value
    const formattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    const newText = `${formattedAmount} ${data.targetCurrency}`;

    const valueContainer = currentTooltip.querySelector('.cc-value-container');
    const oldValueEl = valueContainer.querySelector('.cc-value');

    // If text is same, do nothing
    if (oldValueEl.textContent === newText) return;

    // Create new element
    const newValueEl = document.createElement('span');
    newValueEl.className = 'cc-value cc-value-entering';
    newValueEl.textContent = newText;

    valueContainer.appendChild(newValueEl);

    // Trigger animation
    // Force reflow
    void newValueEl.offsetWidth;

    oldValueEl.classList.add('cc-value-exit');
    newValueEl.classList.remove('cc-value-entering');
    newValueEl.classList.add('cc-value-active');

    setTimeout(() => {
      if (oldValueEl.parentNode) oldValueEl.remove();
    }, 300); // match css transition

    // Update copy listener data? 
    // The copy listener uses `formattedAmount` from closure.
    // We need to update the copy handler or the text it reads.
    // The current copy handler reads `formattedAmount` variable. 
    // We should change copy handler to read from DOM or update a state.
    // Let's re-attach the main click listener or make it dynamic.
    // Actually, simply updating the DOM text is enough if we read from textContent?
    // Original code: navigator.clipboard.writeText(formattedAmount)
    // We should switch to reading the current valid value.
    currentTooltip._currentFormattedAmount = formattedAmount; // Stash it on the element
  }

  function formatCurrency(amount, currencyCode) {
    if (typeof amount === 'string') return amount;

    let digits = 2;
    if (currencyCode && ZERO_DECIMAL_CURRENCIES && ZERO_DECIMAL_CURRENCIES.includes(currencyCode)) {
      digits = 0;
    }

    return amount.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function buildHeaderHtml(data) {
    const pills = data.possibleCurrencies.map(currency => {
      const isActive = currency === data.originalCurrency;
      return `<span class="cc-currency-pill ${isActive ? 'active' : ''}" data-currency="${currency}">${currency}</span>`;
    }).join('');

    return `
        <div class="cc-header-wrapper">
            <div class="cc-header-row">
            <span class="cc-label">From</span>
            <div class="cc-currency-list">
                ${pills}
            </div>
            </div>
        </div>
      `;
  }

  function attachTooltipListeners(tooltip, data) {
    attachPillListeners(tooltip, data);

    // Click to copy
    // We remove old listener if any to avoid duplicates? 
    // Actually `showTooltip` creates fresh element. `updateTooltip` relies on this helper?
    // Let's handle the copy listener separately to avoid re-binding issues.
    if (!tooltip._copyListenerAttached) {
      let isCopying = false;
      tooltip.addEventListener('click', (e) => {
        // If clicking a pill, don't copy
        if (e.target.closest('.cc-currency-pill')) return;

        if (isCopying) return;
        isCopying = true;

        // Prefer stashed value (from update) or initial closure value
        const textToCopy = tooltip._currentFormattedAmount || formatCurrency(data.convertedAmount, data.targetCurrency);

        navigator.clipboard.writeText(textToCopy).then(() => {
          const hint = tooltip.querySelector('.cc-hint');
          if (hint) {
            hint.textContent = 'Copied to clipboard!';
            hint.classList.add('cc-copied');
            tooltip.style.pointerEvents = 'none';

            setTimeout(() => {
              tooltip.style.opacity = '0';
              tooltip.style.transform = 'translate(-50%, -110%) scale(0.9)';
              setTimeout(() => {
                if (tooltip.parentNode) tooltip.remove();
                if (currentTooltip === tooltip) currentTooltip = null;
              }, 200);
            }, 1500);
          }
        }).catch(() => {
          isCopying = false;
        });
      });
      tooltip._copyListenerAttached = true;
      tooltip._currentFormattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    } else {
      // Just update the stash
      tooltip._currentFormattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    }
  }

  function attachPillListeners(tooltip, data) {
    const pills = tooltip.querySelectorAll('.cc-currency-pill');
    pills.forEach(pill => {
      // Clone to remove old listeners if we are re-attaching?
      // Or just ensure we don't double bind. 
      // Since we re-render the header HTML in `updateTooltip`, these are NEW DOM nodes.
      // So simple addEventListener is fine.

      pill.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent tooltip click (copy)

        // Don't do anything if clicking the already active one
        if (pill.classList.contains('active')) return;

        const newCurrency = pill.dataset.currency;
        const currentData = { ...data };

        // Notify background to recalculate
        chrome.runtime.sendMessage({
          type: 'recalculate-conversion',
          data: {
            amount: currentData.originalAmount,
            fromCurrency: newCurrency,
            targetCurrency: currentData.targetCurrency,
            originalSymbol: currentData.originalSymbol,
            possibleCurrencies: currentData.possibleCurrencies
          }
        });

        // Optimistic UI update
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');

        // Optional: Dim value while loading
        const valueEl = tooltip.querySelector('.cc-value');
        if (valueEl) valueEl.style.opacity = '0.5';
      });

      pill.addEventListener('mousedown', (e) => e.stopPropagation());
    });
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
      
      #currency-converter-tooltip.cc-has-multiple {
        padding: 12px 18px;
        min-width: 180px;
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

      .cc-value-container {
        display: grid;
        grid-template-areas: "content";
        align-items: center;
        justify-items: center;
        position: relative;
        height: 48px; /* Fixed height to contain absolute slides */
        min-width: 60px;
        overflow: hidden;
      }

      .cc-value {
        grid-area: content;
        font-weight: 600;
        font-size: 16px;
        background: linear-gradient(135deg, #fff 0%, #aaa 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        width: auto;
        white-space: nowrap;
        text-align: center;
      }

      .cc-value-entering {
        transform: translateY(100%);
        opacity: 0;
      }

      .cc-value-active {
        transform: translateY(0);
        opacity: 1;
      }
      
      .cc-value-exit {
        transform: translateY(-100%);
        opacity: 0;
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

      .cc-header-wrapper {
        min-height: 20px;
      }

      .cc-header-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 2px;
      }

      @keyframes cc-bounce {
        0% { transform: translate(-50%, -80%) scale(0.8); opacity: 0; }
        100% { transform: translate(-50%, -100%) scale(1); opacity: 1; }
      }
      
      .cc-currency-list {
        display: flex;
        gap: 4px;
        background: rgba(255, 255, 255, 0.1);
        padding: 2px;
        border-radius: 6px;
      }

      .cc-currency-pill {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 4px;
        cursor: pointer;
        opacity: 0.6;
        transition: all 0.2s;
        font-weight: 500;
      }

      .cc-currency-pill:hover {
        opacity: 0.9;
        background: rgba(255, 255, 255, 0.1);
      }

      .cc-currency-pill.active {
        opacity: 1;
        background: rgba(255, 255, 255, 0.25);
        color: #fff;
        font-weight: 700;
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }
    `;
    document.head.appendChild(style);
  }
})();
