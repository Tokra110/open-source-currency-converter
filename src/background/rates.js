/**
 * ECB exchange rate fetching, caching, and conversion.
 * All ECB rates are EUR-based. Non-EUR pairs are cross-calculated.
 * Uses globals from constants.js (loaded via importScripts).
 */

const FETCH_TIMEOUT_MS = 10000;
const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 2000;

/**
 * Fetch latest rates from the ECB XML endpoint.
 * Parses the XML and returns a map of { currency: rateVsEUR }.
 * EUR itself is always 1.
 */
async function fetchRates() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(ECB_API_URL, { signal: controller.signal });
    clearTimeout(timeoutId);

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
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Retry wrapper for fetchRates with exponential backoff.
 * Skips retries for client errors (4xx) except 429 (rate limit).
 */
async function fetchRatesWithRetry() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fetchRates();
    } catch (err) {
      lastError = err;
      if (err.message?.includes('returned 4') && !err.message.includes('429')) {
        throw err;
      }
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
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
    if (Number.isFinite(rate) && rate > 0) {
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
 * Check whether cached rates are too old to be reliable.
 * @param {string|null} timestamp - ISO timestamp of last rate fetch
 * @param {number} maxAgeMs - Maximum acceptable age in milliseconds
 * @returns {boolean}
 */
function isRateStale(timestamp, maxAgeMs = STALE_THRESHOLD_MS) {
  if (!timestamp) return true;
  const age = Date.now() - new Date(timestamp).getTime();
  return age > maxAgeMs;
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
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  if (from === to) return amount;

  const fromRate = rates[from];
  const toRate = rates[to];

  if (fromRate == null || toRate == null) {
    throw new Error(`Missing rate for ${fromRate == null ? from : ''}${fromRate == null && toRate == null ? ' and ' : ''}${toRate == null ? to : ''}`);
  }

  // Convert to EUR first, then to target
  // fromRate = how many units of 'from' per 1 EUR
  // toRate = how many units of 'to' per 1 EUR
  const amountInEur = amount / fromRate;
  return amountInEur * toRate;
}
