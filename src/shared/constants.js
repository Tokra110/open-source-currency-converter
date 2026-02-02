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
