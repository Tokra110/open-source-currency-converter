/**
 * Detects currency amounts in text selections.
 * Handles symbols ($, EUR, £, etc.), ISO codes, and both US/EU number formats.
 */

/* eslint-disable no-var */
var CurrencyDetector = (() => {
  // Symbols sorted longest-first so "Mex$" matches before "$"
  const sortedSymbols = Object.keys(CURRENCY_SYMBOLS)
    .sort((a, b) => b.length - a.length);

  // Escape regex special chars in symbols
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Build a combined regex pattern for all currency symbols
  const symbolPattern = sortedSymbols.map(escapeRegex).join('|');

  // Number pattern: digits with optional thousands separators and decimal
  // Matches: 1000, 1,000, 1.000, 1,000.50, 1.000,50, 100.5, 100,5
  const numberPattern = '\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';

  // ISO code pattern: 3 uppercase letters that are known currencies
  const isoCodesSet = new Set(ECB_CURRENCIES);

  // Full patterns:
  // 1. Symbol before number: $100, € 1,000.50
  // 2. Symbol after number: 100$, 1.000,50€
  // 3. ISO code before number: USD 100, EUR1000
  // 4. ISO code after number: 100 USD, 1000EUR
  const patterns = [
    new RegExp(`(${symbolPattern})\\s?(${numberPattern})`, 'g'),
    new RegExp(`(${numberPattern})\\s?(${symbolPattern})`, 'g'),
    new RegExp(`\\b([A-Z]{3})\\s?(${numberPattern})`, 'g'),
    new RegExp(`(${numberPattern})\\s?([A-Z]{3})\\b`, 'g'),
  ];

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
      // Could be US decimal or EU thousands separator
      const afterDot = cleaned.substring(lastDot + 1);
      if (afterDot.length <= 2) {
        // Treat as US decimal: 100.50
        return parseFloat(cleaned);
      }
      // Treat as EU thousands: 1.000
      cleaned = cleaned.replace(/\./g, '');
      return parseFloat(cleaned);
    }

    if (lastComma > -1 && lastDot === -1) {
      // Could be EU decimal or US thousands separator
      const afterComma = cleaned.substring(lastComma + 1);
      if (afterComma.length <= 2) {
        // Treat as EU decimal: 100,50
        cleaned = cleaned.replace(',', '.');
        return parseFloat(cleaned);
      }
      // Treat as US thousands: 1,000
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned);
    }

    // Both dot and comma present
    if (lastDot > lastComma) {
      // US format: 1,000.50 (comma is thousands, dot is decimal)
      cleaned = cleaned.replace(/,/g, '');
      return parseFloat(cleaned);
    }
    // EU format: 1.000,50 (dot is thousands, comma is decimal)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned);
  }

  /**
   * Identify which currencies a symbol or code represents.
   * @param {string} symbolOrCode
   * @returns {string[]} Array of possible ISO currency codes
   */
  function identifyCurrencies(symbolOrCode) {
    // Check symbol map first
    if (CURRENCY_SYMBOLS[symbolOrCode]) {
      return CURRENCY_SYMBOLS[symbolOrCode];
    }
    // Check if it's a valid ISO code
    if (isoCodesSet.has(symbolOrCode)) {
      return [symbolOrCode];
    }
    return [];
  }

  /**
   * Detect currency amount in the given text.
   * Returns the first match found.
   *
   * @param {string} text - Selected text to analyze
   * @param {string} numberFormat - 'auto', 'us', or 'eu'
   * @returns {{ amount: number, currencies: string[], original: string, symbol: string } | null}
   */
  function detectCurrency(text, numberFormat = 'auto') {
    if (!text || text.length > 200) return null;

    const trimmed = text.trim();

    // Try symbol-before-number pattern
    for (const symbol of sortedSymbols) {
      const escaped = escapeRegex(symbol);
      const re = new RegExp(`(${escaped})\\s?(${numberPattern})`);
      const match = trimmed.match(re);
      if (match) {
        const amount = parseNumber(match[2], numberFormat);
        if (amount != null && amount > 0) {
          const currencies = identifyCurrencies(match[1]);
          if (currencies.length > 0) {
            return {
              amount,
              currencies,
              original: match[0],
              symbol: match[1],
            };
          }
        }
      }
    }

    // Try number-before-symbol pattern
    for (const symbol of sortedSymbols) {
      const escaped = escapeRegex(symbol);
      const re = new RegExp(`(${numberPattern})\\s?(${escaped})`);
      const match = trimmed.match(re);
      if (match) {
        const amount = parseNumber(match[1], numberFormat);
        if (amount != null && amount > 0) {
          const currencies = identifyCurrencies(match[2]);
          if (currencies.length > 0) {
            return {
              amount,
              currencies,
              original: match[0],
              symbol: match[2],
            };
          }
        }
      }
    }

    // Try ISO code before number
    const isoBeforeRe = new RegExp(`\\b([A-Z]{3})\\s?(${numberPattern})`);
    const isoBefore = trimmed.match(isoBeforeRe);
    if (isoBefore) {
      const code = isoBefore[1];
      if (isoCodesSet.has(code)) {
        const amount = parseNumber(isoBefore[2], numberFormat);
        if (amount != null && amount > 0) {
          return {
            amount,
            currencies: [code],
            original: isoBefore[0],
            symbol: code,
          };
        }
      }
    }

    // Try number before ISO code
    const isoAfterRe = new RegExp(`(${numberPattern})\\s?([A-Z]{3})\\b`);
    const isoAfter = trimmed.match(isoAfterRe);
    if (isoAfter) {
      const code = isoAfter[2];
      if (isoCodesSet.has(code)) {
        const amount = parseNumber(isoAfter[1], numberFormat);
        if (amount != null && amount > 0) {
          return {
            amount,
            currencies: [code],
            original: isoAfter[0],
            symbol: code,
          };
        }
      }
    }

    return null;
  }

  return { detectCurrency, parseNumber };
})();
