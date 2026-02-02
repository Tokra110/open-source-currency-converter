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
    console.log('Initial rates fetched successfully');
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
    console.log('Rates refreshed via alarm');
  } catch (err) {
    console.warn('Alarm rate refresh failed, using cached rates:', err.message);
  }
});

// --- Context menu state ---

let currentDetection = null;

/**
 * Rebuild context menu items based on a currency detection result.
 * Removes all existing items, then creates new ones.
 */
async function updateContextMenu(detection, settings) {
  await chrome.contextMenus.removeAll();

  if (!detection || !settings.enabled) {
    currentDetection = null;
    return;
  }

  currentDetection = detection;
  const { amount, currencies, symbol } = detection;
  const target = settings.targetCurrency;
  const displayAmount = formatDisplayAmount(amount, symbol);
  const { rates } = await getCachedRates();

  if (currencies.length === 1) {
    const from = currencies[0];
    if (from === target) return;

    const title = buildConvertedTitle(displayAmount, from, target, amount, rates);
    chrome.contextMenus.create({
      id: `convert_${from}`,
      title,
      contexts: ['selection'],
    });
  } else {
    chrome.contextMenus.create({
      id: 'convert_parent',
      title: `Convert ${displayAmount}`,
      contexts: ['selection'],
    });

    const ordered = reorderCurrencies(currencies, settings.defaultDollarCurrency);

    for (const from of ordered) {
      if (from === target) continue;
      const title = buildConvertedTitle(displayAmount, from, target, amount, rates);
      chrome.contextMenus.create({
        id: `convert_${from}`,
        parentId: 'convert_parent',
        title: `${from}: ${title}`,
        contexts: ['selection'],
      });
    }
  }
}

/**
 * Build a menu title that includes the converted amount.
 * Falls back to a plain label if rates are unavailable.
 */
function buildConvertedTitle(displayAmount, from, target, amount, rates) {
  if (!rates || !rates[from] || !rates[target]) {
    return `${displayAmount} → ${target} (no rates)`;
  }
  const converted = convertCurrency(amount, from, target, rates);
  const formatted = converted.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${displayAmount} → ${target} ${formatted}`;
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

/**
 * Format an amount with its symbol for display in the menu.
 */
function formatDisplayAmount(amount, symbol) {
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${symbol}${formatted}`;
}

// --- Message handler (from content scripts) ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'currency-detected') {
    handleCurrencyDetected(message, sender);
    return false;
  }

  if (message.type === 'no-currency') {
    handleNoCurrency();
    return false;
  }

  return false;
});

async function handleCurrencyDetected(message, sender) {
  const settingsResult = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const config = settingsResult[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

  // Update context menu as before
  await updateContextMenu(message.detection, config);

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

async function handleNoCurrency() {
  await chrome.contextMenus.removeAll();
  currentDetection = null;
}

// --- Context menu click handler ---

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.menuItemId.startsWith('convert_') || !currentDetection) return;

  const settingsResult = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  const settings = settingsResult[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  const { rates } = await getCachedRates();

  if (!rates) return;

  let fromCurrency;
  if (info.menuItemId === 'convert_parent') {
    // If they clicked the parent, use the first currency in the ordered list
    const ordered = reorderCurrencies(currentDetection.currencies, settings.defaultDollarCurrency);
    fromCurrency = ordered[0];
  } else {
    fromCurrency = info.menuItemId.replace('convert_', '');
  }

  try {
    const convertedAmount = convertCurrency(currentDetection.amount, fromCurrency, settings.targetCurrency, rates);

    chrome.tabs.sendMessage(tab.id, {
      type: 'show-conversion',
      data: {
        originalAmount: currentDetection.amount,
        originalCurrency: fromCurrency,
        originalSymbol: currentDetection.symbol,
        convertedAmount,
        targetCurrency: settings.targetCurrency,
      }
    });
  } catch (err) {
    console.error('Conversion failed:', err.message);
  }
});

// --- Settings change listener ---

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes[STORAGE_KEYS.SETTINGS]) {
    if (currentDetection) {
      const newSettings = changes[STORAGE_KEYS.SETTINGS].newValue || DEFAULT_SETTINGS;
      await updateContextMenu(currentDetection, newSettings);
    }
  }
});

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
