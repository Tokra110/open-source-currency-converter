/**
 * Currency constants and mappings for the extension.
 * All rates from ECB are EUR-based.
 *
 * Uses `var` so these are true globals accessible across content scripts,
 * the service worker (via importScripts), and the popup.
 */

/* eslint-disable no-var */

var CURRENCY_SYMBOLS = {
  '$': ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD'],
  'US$': ['USD'],
  'A$': ['AUD'],
  'C$': ['CAD'],
  'CA$': ['CAD'],
  'NZ$': ['NZD'],
  'S$': ['SGD'],
  'HK$': ['HKD'],
  '€': ['EUR'],
  '£': ['GBP'],
  '¥': ['JPY', 'CNY'],
  '₹': ['INR'],
  '₩': ['KRW'],
  'kr': ['SEK', 'NOK', 'DKK', 'ISK'],
  'Fr': ['CHF'],
  'zł': ['PLN'],
  'Ft': ['HUF'],
  'Kč': ['CZK'],
  'lei': ['RON'],
  '₺': ['TRY'],
  'R$': ['BRL'],
  'R': ['ZAR'],
  '₱': ['PHP'],
  '฿': ['THB'],
  'RM': ['MYR'],
  'Rp': ['IDR'],
  '₪': ['ILS'],
  'Mex$': ['MXN'],
};

var CURRENCY_KEYWORDS = {
  // MAJOR CURRENCIES
  'USD': ['dollar', 'dollars', 'buck', 'bucks', 'greenback', 'greenbacks', 'us dollar', 'us dollars', 'usd'],
  'EUR': ['euro', 'euros', 'eur'],
  'JPY': ['yen', 'yens', 'jpy'],
  'GBP': ['pound', 'pounds', 'quid', 'sterling', 'pound sterling', 'gbp'],
  'CHF': ['franc', 'francs', 'swiss franc', 'swiss francs', 'sfr', 'chf'],
  'CNY': ['yuan', 'yuans', 'renminbi', 'rmb', 'kuai', 'cny'],
  'INR': ['rupee', 'rupees', 'inr'],

  // DOLLAR VARIANTS
  'AUD': ['australian dollar', 'australian dollars', 'aussie dollar', 'aussie dollars', 'aud'],
  'CAD': ['canadian dollar', 'canadian dollars', 'loonie', 'loonies', 'toonie', 'toonies', 'cad'],
  'NZD': ['new zealand dollar', 'new zealand dollars', 'kiwi', 'kiwis', 'nzd'],
  'SGD': ['singapore dollar', 'singapore dollars', 'sgd'],
  'HKD': ['hong kong dollar', 'hong kong dollars', 'hkd'],

  // EUROPEAN / NORDIC
  'SEK': ['swedish krona', 'sek'], // 'krona' handled by generic lookup if needed, but specific here for full names
  'NOK': ['norwegian krone', 'nok'],
  'DKK': ['danish krone', 'dkk'],
  'ISK': ['icelandic krona', 'icelandic kronur', 'isk'],
  'CZK': ['koruna', 'korunas', 'czech koruna', 'czk'],
  'HUF': ['forint', 'forints', 'huf'],
  'PLN': ['zloty', 'zlotys', 'pln'],
  'RON': ['leu', 'lei', 'romanian leu', 'ron'],
  'BGN': ['lev', 'leva', 'bulgarian lev', 'bgn'],
  'HRK': ['kuna', 'kunas', 'croatian kuna', 'hrk'],

  // OTHERS
  'TRY': ['lira', 'liras', 'turkish lira', 'try'],
  'BRL': ['real', 'reais', 'brazilian real', 'brl'],
  'MXN': ['mexican peso', 'mexican pesos', 'mxn'],
  'PHP': ['philippine peso', 'philippine pesos', 'php'],
  'IDR': ['rupiah', 'rupiahs', 'indonesian rupiah', 'idr'],
  'ILS': ['shekel', 'shekels', 'israeli shekel', 'ils'],
  'KRW': ['won', 'wons', 'south korean won', 'krw'],
  'MYR': ['ringgit', 'ringgits', 'malaysian ringgit', 'myr'],
  'THB': ['baht', 'bahts', 'thai baht', 'thb'],
  'ZAR': ['rand', 'rands', 'south african rand', 'zar'],
};

var CURRENCY_NAMES = {
  EUR: 'Euro',
  USD: 'US dollar',
  JPY: 'Japanese yen',
  GBP: 'Pound sterling',
  CHF: 'Swiss franc',
  AUD: 'Australian dollar',
  CAD: 'Canadian dollar',
  NZD: 'New Zealand dollar',
  SEK: 'Swedish krona',
  NOK: 'Norwegian krone',
  DKK: 'Danish krone',
  ISK: 'Icelandic krona',
  CZK: 'Czech koruna',
  HUF: 'Hungarian forint',
  PLN: 'Polish zloty',
  RON: 'Romanian leu',
  TRY: 'Turkish lira',
  BGN: 'Bulgarian lev',
  HRK: 'Croatian kuna',
  BRL: 'Brazilian real',
  MXN: 'Mexican peso',
  CNY: 'Chinese yuan',
  HKD: 'Hong Kong dollar',
  IDR: 'Indonesian rupiah',
  ILS: 'Israeli shekel',
  INR: 'Indian rupee',
  KRW: 'South Korean won',
  MYR: 'Malaysian ringgit',
  PHP: 'Philippine peso',
  SGD: 'Singapore dollar',
  THB: 'Thai baht',
  ZAR: 'South African rand',
};

function filterCurrencyCodes(query, currencyNames = CURRENCY_NAMES) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return Object.keys(currencyNames)
    .filter((code) => {
      if (!normalizedQuery) return true;
      return code.toLowerCase().includes(normalizedQuery) ||
        currencyNames[code].toLowerCase().includes(normalizedQuery);
    })
    .sort();
}

function getCurrencySearchState(query, selectedCode, currencyNames = CURRENCY_NAMES) {
  const codes = filterCurrencyCodes(query, currencyNames);
  const autoSelectedCode = codes.length === 1 ? codes[0] : null;
  return {
    codes,
    selectedCode: autoSelectedCode || (codes.includes(selectedCode) ? selectedCode : ''),
    autoSelectedCode,
  };
}

var CURRENCY_CODE_TO_SYMBOL = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  INR: '₹',
  KRW: '₩',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  ISK: 'kr',
  CHF: 'Fr',
  PLN: 'zł',
  HUF: 'Ft',
  CZK: 'Kč',
  RON: 'lei',
  TRY: '₺',
  BRL: 'R$',
  ZAR: 'R',
  PHP: '₱',
  THB: '฿',
  MYR: 'RM',
  IDR: 'Rp',
  ILS: '₪',
  MXN: 'Mex$',
  AUD: 'A$',
  CAD: 'C$',
  NZD: 'NZ$',
  SGD: 'S$',
  HKD: 'HK$',
  BGN: 'лв',
  HRK: 'kn'
};


var ECB_CURRENCIES = Object.keys(CURRENCY_NAMES);

// Currencies that typically don't use decimal places (or have very low unit value)
var ZERO_DECIMAL_CURRENCIES = ['HUF', 'JPY', 'KRW', 'IDR', 'ISK'];

function resolveOutputLocale(outputFormat, browserLocale) {
  if (outputFormat === 'us') return 'en-US';
  if (outputFormat === 'eu') return 'de-DE';
  return browserLocale;
}

function formatCurrencyAmount(amount, currencyCode, outputFormat = 'smart', browserLocale) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return String(amount);

  const digits = ZERO_DECIMAL_CURRENCIES.includes(currencyCode) ? 0 : 2;
  const locale = resolveOutputLocale(outputFormat, browserLocale);
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

function formatCompactCurrencyAmount(amount, currencyCode, compact, outputFormat = 'smart', browserLocale) {
  if (!compact?.multiplier || !compact.label) {
    return formatCurrencyAmount(amount, currencyCode, outputFormat, browserLocale);
  }

  const locale = resolveOutputLocale(outputFormat, browserLocale);
  const scaledAmount = amount / compact.multiplier;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(scaledAmount);
  return `${formatted}${compact.label}`;
}


var TIMING = {
  DEBOUNCE_MS: 300,
  TOOLTIP_CLOSE_DELAY_MS: 50,
  COPY_DISPLAY_MS: 1500,
  FADE_OUT_MS: 200,
  VALUE_TRANSITION_MS: 300,
  STATUS_DISPLAY_MS: 1500,
  STATUS_FADE_MS: 300,
};

var LIMITS = {
  MAX_SELECTION_LENGTH: 200,
};

var ECB_API_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

var ALARM_NAME = 'refreshRates';
var ALARM_PERIOD_MINUTES = 1440; // 24 hours

var DEFAULT_SETTINGS = {
  targetCurrency: 'USD', // Default target currency
  defaultDollarCurrency: 'USD', // Default for generic '$'
  defaultYenCurrency: 'JPY', // Default for generic '¥'
  defaultKrCurrency: 'SEK', // Default for generic 'kr'
  defaultFrCurrency: 'CHF', // Default for generic 'Fr'
  numberFormat: 'auto', // 'auto', 'us', 'eu'
  outputFormat: 'smart', // 'smart' follows browser locale; 'us' and 'eu' are explicit
  extensionEnabled: true, // Master toggle
  conversionMode: 'auto', // 'auto' (wholescan) or 'interactive' (tooltip)
  autoReplaceLimit: 2000, // Max replacements per page to prevent freezing
  theme: 'system', // 'system', 'light', 'dark'
  disabledDomains: [], // List of domains where extension is disabled
  disableAnimations: false // Show extension UI changes immediately
};

function getSiteHostname(locationValue) {
  const ancestorOrigins = locationValue?.ancestorOrigins;
  if (ancestorOrigins?.length) {
    for (let index = ancestorOrigins.length - 1; index >= 0; index--) {
      try {
        const hostname = new URL(ancestorOrigins[index]).hostname;
        if (hostname) return hostname;
      } catch {
        // Ignore malformed ancestor origins and continue to the frame URL.
      }
    }
  }
  return locationValue?.hostname || '';
}

function shouldLoadPageScannerRates(settings, hostname) {
  if (!settings?.extensionEnabled || settings.conversionMode !== 'auto') return false;
  return !settings.disabledDomains?.includes(hostname);
}

var DOLLAR_TOKENS = new Set([
  '$',
  'dollar',
  'dollars',
  'buck',
  'bucks',
  'greenback',
  'greenbacks',
  'us dollar',
  'us dollars',
]);

function getPreferredCurrencyForDetectionSymbol(symbol, settings) {
  if (!symbol || !settings) return null;

  const lower = symbol.toLowerCase();
  if (DOLLAR_TOKENS.has(lower)) return settings.defaultDollarCurrency;
  if (symbol === '¥') return settings.defaultYenCurrency;
  if (lower === 'kr') return settings.defaultKrCurrency;
  if (lower === 'fr') return settings.defaultFrCurrency;
  return null;
}

function chooseDetectedCurrency(detection, settings) {
  if (!detection || !Array.isArray(detection.currencies) || detection.currencies.length === 0) {
    return null;
  }

  const preferred = getPreferredCurrencyForDetectionSymbol(detection.symbol, settings);
  if (preferred && detection.currencies.includes(preferred)) {
    return preferred;
  }

  return detection.currencies[0];
}

var STORAGE_KEYS = {
  SETTINGS: 'settings',
  RATES: 'rates',
  RATES_TIMESTAMP: 'ratesTimestamp',
};
