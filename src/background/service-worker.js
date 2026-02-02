/**
 * Service worker for the currency converter extension.
 * Handles: rate fetching alarms, context menu management, message routing.
 * Uses importScripts to load shared modules and rates.
 */

importScripts('../shared/constants.js', 'rates.js');

// --- Installation and alarm setup ---

chrome.runtime.onInstalled.addListener(async () => {
  // Set default settings if not already configured
  const existing = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  if (!existing[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
    });
  }

  // Fetch rates immediately on install
  try {
    await fetchRates();

  } catch (err) {
    console.warn('Failed to fetch initial rates:', err.message);
  }

  // Set up daily alarm for rate refresh
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

// --- Alarm handler ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  try {
    await fetchRates();

  } catch (err) {
    console.warn('Alarm rate refresh failed, using cached rates:', err.message);
  }
});

// --- Message handler (from content scripts) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'currency-detected') {
    handleCurrencyDetected(message, sender);
    return false;
  }

  return false;
});

async function handleCurrencyDetected(message, sender) {
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const config = settingsResult[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

  // Auto-display conversion if applicable (selection length <= 200)
  if (message.detection && message.detection.selectionText.length <= 200) {
    const { rates } = await getCachedRates();
    if (!rates) return;

    // Use the first currency in the ordered list
    const ordered = reorderCurrencies(message.detection.currencies, config.defaultDollarCurrency);
    const fromCurrency = ordered[0];

    if (fromCurrency === config.targetCurrency) return;

    try {
      const convertedAmount = convertCurrency(message.detection.amount, fromCurrency, config.targetCurrency, rates);

      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'show-conversion',
        data: {
          originalAmount: message.detection.amount,
          originalCurrency: fromCurrency,
          originalSymbol: message.detection.symbol,
          possibleCurrencies: message.detection.currencies,
          convertedAmount,
          targetCurrency: config.targetCurrency,
        }
      });
    } catch (err) {
      console.error('Auto-conversion failed:', err.message);
    }
  }
}

/**
 * Reorder currencies array so the preferred one comes first.
 */
function reorderCurrencies(currencies, preferred) {
  if (!preferred) return currencies;
  const idx = currencies.indexOf(preferred);
  if (idx <= 0) return currencies;
  const copy = [...currencies];
  copy.splice(idx, 1);
  copy.unshift(preferred);
  return copy;
}


// --- Recalculation handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'recalculate-conversion') {
    handleRecalculation(message, sender);
    return false;
  }
});

async function handleRecalculation(message, sender) {
  const { amount, fromCurrency, targetCurrency, originalSymbol, possibleCurrencies } = message.data;
  const { rates } = await getCachedRates();

  if (!rates) return;

  try {
    const convertedAmount = convertCurrency(amount, fromCurrency, targetCurrency, rates);

    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'show-conversion',
      data: {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        originalSymbol: originalSymbol,
        possibleCurrencies: possibleCurrencies,
        convertedAmount,
        targetCurrency: targetCurrency,
      }
    });
  } catch (err) {
    console.error('Recalculation failed:', err.message);
  }
}
