/**
 * Detects currency amounts in text selections.
 * Handles symbols ($, EUR, etc.), ISO codes, keywords, and both US/EU number formats.
 */

/* eslint-disable no-var */
var CurrencyDetector = (() => {
  // Symbols sorted longest-first so "Mex$" matches before "$"
  const sortedSymbols = Object.keys(CURRENCY_SYMBOLS)
    .sort((a, b) => b.length - a.length);

  // Build keyword -> [ISO codes] map from CURRENCY_KEYWORDS.
  // GENERIC_* entries are skipped because their values are ISO codes (3-letter uppercase),
  // not actual keywords. Ambiguity for terms like "dollar" is handled by the user's
  // "Default Dollar Currency" preference in settings.
  const keywordMap = {};
  if (typeof CURRENCY_KEYWORDS !== 'undefined') {
    Object.entries(CURRENCY_KEYWORDS).forEach(([iso, keywords]) => {
      keywords.forEach(kw => {
        if (kw.length === 3 && kw === kw.toUpperCase()) return;

        const lowerKw = kw.toLowerCase();
        if (!keywordMap[lowerKw]) {
          keywordMap[lowerKw] = [];
        }
        if (!keywordMap[lowerKw].includes(iso)) {
          keywordMap[lowerKw].push(iso);
        }
      });
    });
  }

  // Sort keywords by length descending to match "Australian Dollar" before "Dollar"
  const sortedKeywords = Object.keys(keywordMap)
    .sort((a, b) => b.length - a.length);

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const keywordPattern = sortedKeywords.map(escapeRegex).join('|');

  // Matches: 1000, 1,000, 1.000, 1,000.50, 1.000,50, 100.5, 100,5
  const numberPattern = '\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';

  const isoCodesSet = new Set(ECB_CURRENCIES);

  // Pre-compile regexes once at init time (avoids re-creation on every detectCurrency call)
  const kwAfterRe = keywordPattern
    ? new RegExp(`(${numberPattern})\\s?(${keywordPattern})\\b`, 'i')
    : null;
  const kwBeforeRe = keywordPattern
    ? new RegExp(`\\b(${keywordPattern})\\s?(${numberPattern})`, 'i')
    : null;

  const isoBeforeRe = new RegExp(`\\b([A-Z]{3})\\s?(${numberPattern})`);
  const isoAfterRe = new RegExp(`(${numberPattern})\\s?([A-Z]{3})\\b`);

  // Symbol regexes with negative lookbehind to prevent matching inside words (e.g., GDDR6)
  // (?<![A-Za-z0-9]) ensures the symbol is not preceded by alphanumeric characters
  const symbolBeforeRegexes = sortedSymbols.map(symbol => ({
    symbol,
    re: new RegExp(`(?<![A-Za-z0-9])(${escapeRegex(symbol)})\\s?(${numberPattern})`),
  }));
  const symbolAfterRegexes = sortedSymbols.map(symbol => ({
    symbol,
    re: new RegExp(`(${numberPattern})\\s?(${escapeRegex(symbol)})(?![A-Za-z0-9])`),
  }));

  /**
   * Parse a number string that may use US or EU formatting.
   * @param {string} numStr - Raw number string (e.g. "1,000.50" or "1.000,50")
   * @param {string} format - 'auto', 'us', or 'eu'
   * @returns {number|null}
   */
  function parseNumber(numStr, format) {
    if (!numStr || !numStr.trim()) return null;

    let cleaned = numStr.trim().replace(/\s/g, '');

    if (format === 'us') {
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned);
    }

    if (format === 'eu') {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      return parseFloat(cleaned);
    }

    // Auto-detect format
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    if (lastDot === -1 && lastComma === -1) {
      return parseFloat(cleaned);
    }

    if (lastDot > -1 && lastComma === -1) {
      const afterDot = cleaned.substring(lastDot + 1);
      if (afterDot.length <= 2) {
        return parseFloat(cleaned);
      }
      cleaned = cleaned.replace(/\./g, '');
      return parseFloat(cleaned);
    }

    if (lastComma > -1 && lastDot === -1) {
      const afterComma = cleaned.substring(lastComma + 1);
      if (afterComma.length <= 2) {
        cleaned = cleaned.replace(',', '.');
        return parseFloat(cleaned);
      }
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned);
    }

    // Both dot and comma present
    if (lastDot > lastComma) {
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned);
    }
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned);
  }

  /**
   * Identify which currencies a symbol, code, or keyword represents.
   */
  function identifyCurrencies(symbolOrCode) {
    if (CURRENCY_SYMBOLS[symbolOrCode]) {
      return CURRENCY_SYMBOLS[symbolOrCode];
    }
    if (isoCodesSet.has(symbolOrCode)) {
      return [symbolOrCode];
    }
    const lower = symbolOrCode.toLowerCase();
    if (keywordMap[lower]) {
      return keywordMap[lower];
    }
    return [];
  }

  /**
   * Build a match result object.
   */
  function buildResult(amount, currencies, original, symbol) {
    // Allow zero-value amounts, but still reject negatives and invalid parses.
    if (!Number.isFinite(amount) || amount < 0 || currencies.length === 0) return null;
    return { amount, currencies, original, symbol };
  }

  /**
   * Try to detect currency via keywords like "dollars", "bucks", "euro".
   */
  function detectByKeyword(text, numberFormat) {
    if (!kwAfterRe) return null;

    // Number before keyword: "20 dollars"
    const kwAfter = text.match(kwAfterRe);
    if (kwAfter) {
      const amount = parseNumber(kwAfter[1], numberFormat);
      const currencies = identifyCurrencies(kwAfter[2]);
      const result = buildResult(amount, currencies, kwAfter[0], kwAfter[2]);
      if (result) return result;
    }

    // Keyword before number: "US Dollars 20"
    const kwBefore = text.match(kwBeforeRe);
    if (kwBefore) {
      const amount = parseNumber(kwBefore[2], numberFormat);
      const currencies = identifyCurrencies(kwBefore[1]);
      const result = buildResult(amount, currencies, kwBefore[0], kwBefore[1]);
      if (result) return result;
    }

    return null;
  }

  /**
   * Try to detect currency via ISO codes like "USD", "EUR".
   */
  function detectByIsoCode(text, numberFormat) {
    // ISO code before number: "USD 100"
    const isoBefore = text.match(isoBeforeRe);
    if (isoBefore && isoCodesSet.has(isoBefore[1])) {
      const amount = parseNumber(isoBefore[2], numberFormat);
      const result = buildResult(amount, [isoBefore[1]], isoBefore[0], isoBefore[1]);
      if (result) return result;
    }

    // Number before ISO code: "100 USD"
    const isoAfter = text.match(isoAfterRe);
    if (isoAfter && isoCodesSet.has(isoAfter[2])) {
      const amount = parseNumber(isoAfter[1], numberFormat);
      const result = buildResult(amount, [isoAfter[2]], isoAfter[0], isoAfter[2]);
      if (result) return result;
    }

    return null;
  }

  /**
   * Try to detect currency via symbols like "$", "EUR", "£".
   */
  function detectBySymbol(text, numberFormat) {
    // Symbol before number: "$100"
    for (const { re } of symbolBeforeRegexes) {
      const match = text.match(re);
      if (match) {
        const amount = parseNumber(match[2], numberFormat);
        const currencies = identifyCurrencies(match[1]);
        const result = buildResult(amount, currencies, match[0], match[1]);
        if (result) return result;
      }
    }

    // Number before symbol: "100$"
    for (const { re } of symbolAfterRegexes) {
      const match = text.match(re);
      if (match) {
        const amount = parseNumber(match[1], numberFormat);
        const currencies = identifyCurrencies(match[2]);
        const result = buildResult(amount, currencies, match[0], match[2]);
        if (result) return result;
      }
    }

    return null;
  }

  /**
   * Detect currency amount in the given text.
   * Tries keyword, ISO code, then symbol detection in priority order.
   *
   * @param {string} text - Selected text to analyze
   * @param {string} numberFormat - 'auto', 'us', or 'eu'
   * @returns {{ amount: number, currencies: string[], original: string, symbol: string } | null}
   */
  function detectCurrency(text, numberFormat = 'auto') {
    if (!text || text.length > LIMITS.MAX_SELECTION_LENGTH) return null;
    const trimmed = text.trim();

    return detectByKeyword(trimmed, numberFormat)
      || detectByIsoCode(trimmed, numberFormat)
      || detectBySymbol(trimmed, numberFormat);
  }

  return { detectCurrency, parseNumber };
})();
