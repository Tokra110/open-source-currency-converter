/**
 * Tooltip display and interaction for currency conversions.
 * Exposes CurrencyTooltip global (IIFE pattern for content script compatibility).
 */

/* eslint-disable no-var, no-unused-vars */
var CurrencyTooltip = (() => {
  // Centralized tooltip state - replaces DOM-stashed properties
  let state = {
    element: null,
    data: null,
    formattedAmount: null,
    closeHandler: null,
    keyHandler: null,
  };

  /**
   * Escape HTML special characters for safe interpolation.
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Format a numeric amount for display.
   */
  function formatCurrency(amount, currencyCode) {
    if (typeof amount !== 'number' || !isFinite(amount)) return String(amount);

    let digits = 2;
    if (currencyCode && ZERO_DECIMAL_CURRENCIES && ZERO_DECIMAL_CURRENCIES.includes(currencyCode)) {
      digits = 0;
    }

    return amount.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  /**
   * Build header HTML with currency pills for multi-currency selections.
   */
  function buildHeaderHtml(data) {
    const pills = data.possibleCurrencies.map(currency => {
      const isActive = currency === data.originalCurrency;
      const safe = escapeHtml(currency);
      return `<span class="cc-currency-pill ${isActive ? 'active' : ''}" data-currency="${safe}" role="button" tabindex="0" aria-pressed="${isActive}">${safe}</span>`;
    }).join('');

    return `
      <div class="cc-header-wrapper">
        <div class="cc-header-row">
          <span class="cc-label">From</span>
          <div class="cc-currency-list">${pills}</div>
        </div>
      </div>
    `;
  }

  /**
   * Resolve theme setting to 'light' or 'dark'.
   * 'system' defers to the OS preference via matchMedia.
   */
  function resolveTheme(theme) {
    if (theme === 'light') return 'light';
    if (theme === 'dark') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /**
   * Remove active event handlers from the document.
   */
  function cleanupHandlers() {
    if (state.closeHandler) {
      document.removeEventListener('mousedown', state.closeHandler);
      state.closeHandler = null;
    }
    if (state.keyHandler) {
      document.removeEventListener('keydown', state.keyHandler);
      state.keyHandler = null;
    }
  }

  /**
   * Append tooltip to the DOM and position it near the selection.
   * Flips below if clipped at top of viewport.
   */
  function mountAndPositionTooltip(tooltip, rect) {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    let left = rect.left + scrollX + rect.width / 2;
    let top = rect.top + scrollY - 10;

    // Check if tooltip would be clipped above viewport
    document.body.appendChild(tooltip);
    const tooltipRect = tooltip.getBoundingClientRect();

    if (rect.top - tooltipRect.height < 0) {
      // Flip below the selection
      top = rect.bottom + scrollY + 10;
      tooltip.classList.add('cc-below');
    }

    // Clamp horizontal position to viewport
    const halfWidth = tooltipRect.width / 2;
    const minLeft = scrollX + halfWidth + 8;
    const maxLeft = scrollX + document.documentElement.clientWidth - halfWidth - 8;
    left = Math.max(minLeft, Math.min(maxLeft, left));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  /**
   * Attach delegated pill listeners to the tooltip element.
   * Uses event delegation so listeners survive DOM replacements in update().
   */
  function attachDelegatedPillListeners(tooltip) {
    tooltip.addEventListener('click', (e) => {
      const pill = e.target.closest('.cc-currency-pill');
      if (!pill) return;
      if (pill.classList.contains('active')) return;
      e.stopPropagation();

      const newCurrency = pill.dataset.currency;
      const currentData = state.data;
      if (!currentData) return;

      try {
        chrome.runtime.sendMessage({
          type: 'recalculate-conversion',
          data: {
            amount: currentData.originalAmount,
            fromCurrency: newCurrency,
            targetCurrency: currentData.targetCurrency,
            originalSymbol: currentData.originalSymbol,
            possibleCurrencies: currentData.possibleCurrencies,
          }
        });
      } catch {
        // Extension context may be invalidated
      }

      tooltip.querySelectorAll('.cc-currency-pill').forEach(p => {
        p.classList.remove('active');
        p.setAttribute('aria-pressed', 'false');
      });
      pill.classList.add('active');
      pill.setAttribute('aria-pressed', 'true');

      const valueEl = tooltip.querySelector('.cc-value');
      if (valueEl) valueEl.style.opacity = '0.5';
    });

    tooltip.addEventListener('mousedown', (e) => {
      if (e.target.closest('.cc-currency-pill')) e.stopPropagation();
    });

    // Keyboard activation for pills (Enter/Space)
    tooltip.addEventListener('keydown', (e) => {
      const pill = e.target.closest('.cc-currency-pill');
      if (!pill) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pill.click();
      }
    });
  }

  /**
   * Create and display the tooltip for a new conversion.
   */
  function show(data, theme) {
    if (state.element) {
      update(data);
      return;
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Update state
    state.data = data;
    state.formattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    const originalFormatted = formatCurrency(data.originalAmount, data.originalCurrency);

    const displayText = `${state.formattedAmount} ${escapeHtml(data.targetCurrency)}`;
    const originalText = `${originalFormatted} ${escapeHtml(data.originalCurrency)}`;

    let headerHtml = `<span class="cc-label">Converted:</span>`;
    if (data.possibleCurrencies && data.possibleCurrencies.length > 1) {
      headerHtml = buildHeaderHtml(data);
    }

    const tooltip = document.createElement('div');
    tooltip.id = 'currency-converter-tooltip';

    if (data.possibleCurrencies && data.possibleCurrencies.length > 1) {
      tooltip.classList.add('cc-has-multiple');
    }

    tooltip.classList.add(`cc-theme-${resolveTheme(theme)}`);
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-label', `Converted: ${state.formattedAmount} ${data.targetCurrency}`);

    tooltip.innerHTML = `
      <div class="cc-tooltip-content">
        ${headerHtml}
        <div class="cc-original-value">${originalText}</div>
        <div class="cc-value-container">
          <span class="cc-value">${displayText}</span>
        </div>
      </div>
    `;

    state.element = tooltip;

    // Attach listeners (delegated - survives DOM replacements in update)
    attachDelegatedPillListeners(tooltip);

    // Mount to DOM and position
    mountAndPositionTooltip(tooltip, rect);

    // Close handler: timestamp check avoids the originating mousedown from closing immediately
    cleanupHandlers();
    const createdAt = Date.now();
    const closeHandler = (e) => {
      if (Date.now() - createdAt < TIMING.TOOLTIP_CLOSE_DELAY_MS) return;
      if (tooltip.parentNode && !tooltip.contains(e.target)) {
        remove();
      }
    };
    state.closeHandler = closeHandler;
    document.addEventListener('mousedown', closeHandler);

    // Escape key dismisses tooltip
    const keyHandler = (e) => {
      if (e.key === 'Escape') remove();
    };
    state.keyHandler = keyHandler;
    document.addEventListener('keydown', keyHandler);
  }

  /**
   * Update an existing tooltip with new conversion data.
   */
  function update(data) {
    if (!state.element) return;

    // Update state
    state.data = data;
    state.formattedAmount = formatCurrency(data.convertedAmount, data.targetCurrency);
    state.element.setAttribute('aria-label', `Converted: ${state.formattedAmount} ${data.targetCurrency}`);

    // Update pills
    if (data.possibleCurrencies && data.possibleCurrencies.length > 1) {
      if (!state.element.classList.contains('cc-has-multiple')) {
        state.element.classList.add('cc-has-multiple');
      }

      // Re-render header (delegated listeners survive DOM replacement)
      const headerContainer = state.element.querySelector('.cc-header-wrapper');
      if (headerContainer) {
        headerContainer.outerHTML = buildHeaderHtml(data);
      }
    } else {
      state.element.classList.remove('cc-has-multiple');
    }

    // Update original value
    const originalFormatted = formatCurrency(data.originalAmount, data.originalCurrency);
    const originalValueEl = state.element.querySelector('.cc-original-value');
    if (originalValueEl) {
      originalValueEl.textContent = `${originalFormatted} ${data.originalCurrency}`;
    }

    // Animate value transition
    const newText = `${state.formattedAmount} ${data.targetCurrency}`;
    const valueContainer = state.element.querySelector('.cc-value-container');
    if (!valueContainer) return;

    const existingValues = valueContainer.querySelectorAll('.cc-value');
    const oldValueEl = valueContainer.querySelector('.cc-value:not(.cc-value-exit)');

    if (oldValueEl && oldValueEl.textContent === newText) return;

    // Immediately remove any elements already in exit state to prevent accumulation
    existingValues.forEach(el => {
      if (el.classList.contains('cc-value-exit')) {
        el.remove();
      }
    });

    const newValueEl = document.createElement('span');
    newValueEl.className = 'cc-value cc-value-entering';
    newValueEl.textContent = newText;

    valueContainer.appendChild(newValueEl);

    // Force reflow then animate
    void newValueEl.offsetWidth;

    if (oldValueEl) {
      oldValueEl.classList.add('cc-value-exit');
      // Remove old element after animation
      setTimeout(() => {
        if (oldValueEl.parentNode) oldValueEl.remove();
      }, TIMING.VALUE_TRANSITION_MS);
    }

    newValueEl.classList.remove('cc-value-entering');
    newValueEl.classList.add('cc-value-active');
  }

  /**
   * Remove the tooltip and clean up all associated state.
   */
  function remove() {
    cleanupHandlers();
    if (state.element && state.element.parentNode) {
      state.element.remove();
    }
    state.element = null;
    state.data = null;
    state.formattedAmount = null;
  }

  /**
   * Whether a tooltip is currently visible.
   */
  function isVisible() {
    return !!state.element;
  }

  return { show, update, remove, isVisible };
})();
