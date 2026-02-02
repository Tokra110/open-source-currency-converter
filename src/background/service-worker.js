/**
 * Service worker for the currency converter extension.
 * Handles: rate fetching alarms, message routing.
 * Uses importScripts to load shared modules and rates.
 */

importScripts('../shared/constants.js', 'rates.js');

// --- Installation and alarm setup ---

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  if (!existing[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
    });
  }

  try {
    await fetchRatesWithRetry();
  } catch (err) {
    console.warn('[CurrencyConverter] Failed to fetch initial rates:', err.message);
  }

  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

// --- Alarm handler ---

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  try {
    await fetchRatesWithRetry();
  } catch (err) {
    console.warn('[CurrencyConverter] Alarm rate refresh failed, using cached rates:', err.message);
  }
});

// --- Message handler (single listener for all content script messages) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'currency-detected') {
    handleCurrencyDetected(message, sender);
  } else if (message.type === 'recalculate-conversion') {
    handleRecalculation(message, sender);
  } else if (message.type === 'manual-sync') {
    handleManualSync(sendResponse);
    return true; // async response
  }
  return true;
});

// --- Manual Sync & Rate Limiting ---

let lastManualSync = 0;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000; // 1 minute

async function handleManualSync(sendResponse) {
  const now = Date.now();
  const timeSinceLast = now - lastManualSync;

  if (timeSinceLast < MANUAL_SYNC_COOLDOWN_MS) {
    const remainingSeconds = Math.ceil((MANUAL_SYNC_COOLDOWN_MS - timeSinceLast) / 1000);
    sendResponse({ status: 'rate-limited', remainingSeconds });
    return;
  }

  try {
    const rates = await fetchRatesWithRetry();
    lastManualSync = Date.now();

    // Get the timestamp we just saved
    const { timestamp } = await getCachedRates();

    sendResponse({ status: 'success', timestamp });
  } catch (err) {
    console.error('[CurrencyConverter] Manual sync failed:', err);
    sendResponse({ status: 'error', message: err.message });
  }
}

/**
 * Resolve rates, falling back to a fresh fetch if cache is empty or stale.
 * @returns {Object|null} Rate map or null if completely unavailable
 */
async function resolveRates() {
  const { rates, timestamp } = await getCachedRates();

  if (rates && !isRateStale(timestamp)) {
    return rates;
  }

  if (rates && isRateStale(timestamp)) {
    console.warn('[CurrencyConverter] Cached rates are stale, attempting refresh.');
    try {
      return await fetchRatesWithRetry();
    } catch (err) {
      console.warn('[CurrencyConverter] Refresh failed, using stale rates:', err.message);
      return rates;
    }
  }

  // No cached rates at all
  console.warn('[CurrencyConverter] No cached rates, attempting fresh fetch.');
  try {
    return await fetchRatesWithRetry();
  } catch (err) {
    console.error('[CurrencyConverter] Rate fetch failed:', err.message);
    return null;
  }
}

async function handleCurrencyDetected(message, sender) {
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const config = settingsResult[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

  if (!message.detection || message.detection.selectionText.length > LIMITS.MAX_SELECTION_LENGTH) return;

  const rates = await resolveRates();
  if (!rates) return;

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
    console.error('[CurrencyConverter] Auto-conversion failed:', err.message);
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

async function handleRecalculation(message, sender) {
  const { amount, fromCurrency, targetCurrency, originalSymbol, possibleCurrencies } = message.data;

  const rates = await resolveRates();
  if (!rates) return;

  try {
    const convertedAmount = convertCurrency(amount, fromCurrency, targetCurrency, rates);

    chrome.tabs.sendMessage(sender.tab.id, {
      type: 'show-conversion',
      data: {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        originalSymbol,
        possibleCurrencies,
        convertedAmount,
        targetCurrency,
      }
    });
  } catch (err) {
    console.error('[CurrencyConverter] Recalculation failed:', err.message);
  }
}
