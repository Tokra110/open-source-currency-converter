/**
 * ECB exchange rate fetching, caching, and conversion.
 * All ECB rates are EUR-based. Non-EUR pairs are cross-calculated.
 * Uses globals from constants.js (loaded via importScripts).
 */

/**
 * Fetch latest rates from the ECB XML endpoint.
 * Parses the XML and returns a map of { currency: rateVsEUR }.
 * EUR itself is always 1.
 */
async function fetchRates() {
  const response = await fetch(ECB_API_URL);
  if (!response.ok) {
    throw new Error(`ECB API returned ${response.status}`);
  }

  const xmlText = await response.text();
  const rates = parseEcbXml(xmlText);
  rates.EUR = 1;

  await chrome.storage.local.set({
    [STORAGE_KEYS.RATES]: rates,
    [STORAGE_KEYS.RATES_TIMESTAMP]: new Date().toISOString(),
  });

  return rates;
}

/**
 * Parse ECB XML to extract currency rates.
 * The XML contains <Cube currency="USD" rate="1.1919"/> elements.
 */
function parseEcbXml(xmlText) {
  const rates = {};
  const regex = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/>/g;
  let match;

  while ((match = regex.exec(xmlText)) !== null) {
    const currency = match[1];
    const rate = parseFloat(match[2]);
    if (!isNaN(rate)) {
      rates[currency] = rate;
    }
  }

  return rates;
}

/**
 * Get cached rates from storage.
 * Returns { rates, timestamp } or { rates: null, timestamp: null }.
 */
async function getCachedRates() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.RATES,
    STORAGE_KEYS.RATES_TIMESTAMP,
  ]);
  return {
    rates: result[STORAGE_KEYS.RATES] || null,
    timestamp: result[STORAGE_KEYS.RATES_TIMESTAMP] || null,
  };
}

/**
 * Convert an amount from one currency to another.
 * Cross-calculates through EUR using ECB rates.
 *
 * @param {number} amount - The amount to convert
 * @param {string} from - Source currency ISO code
 * @param {string} to - Target currency ISO code
 * @param {Object} rates - Rate map { currency: rateVsEUR }
 * @returns {number} Converted amount
 */
function convertCurrency(amount, from, to, rates) {
  if (from === to) return amount;

  const fromRate = rates[from];
  const toRate = rates[to];

  if (fromRate == null || toRate == null) {
    throw new Error(`Missing rate for ${fromRate == null ? from : to}`);
  }

  // Convert to EUR first, then to target
  // fromRate = how many units of 'from' per 1 EUR
  // toRate = how many units of 'to' per 1 EUR
  const amountInEur = amount / fromRate;
  return amountInEur * toRate;
}
