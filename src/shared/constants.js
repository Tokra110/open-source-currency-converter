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

  // GENERIC / AMBIGUOUS TERMS (mapped to most likely or multiple)
  // These will return multiple codes if not handled specifically by exact match above
  'GENERIC_DOLLAR': ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD'],
  'GENERIC_PESO': ['MXN', 'PHP'],
  'GENERIC_KRONA': ['SEK', 'ISK'],
  'GENERIC_KRONE': ['NOK', 'DKK'],
  'GENERIC_CROWN': ['CZK', 'SEK', 'NOK', 'DKK', 'ISK'],
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


var ECB_CURRENCIES = Object.keys(CURRENCY_NAMES);

// Currencies that typically don't use decimal places (or have very low unit value)
var ZERO_DECIMAL_CURRENCIES = ['HUF', 'JPY', 'KRW', 'IDR', 'ISK'];


var ECB_API_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

var ALARM_NAME = 'refreshRates';
var ALARM_PERIOD_MINUTES = 1440; // 24 hours

var DEFAULT_SETTINGS = {
  targetCurrency: 'USD',
  defaultDollarCurrency: 'USD',
  numberFormat: 'auto', // 'auto' | 'us' | 'eu'
  enabled: true,
  theme: 'system', // 'light' | 'dark' | 'system'
};

var STORAGE_KEYS = {
  SETTINGS: 'settings',
  RATES: 'rates',
  RATES_TIMESTAMP: 'ratesTimestamp',
};
