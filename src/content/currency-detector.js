/**
 * Detects currency amounts in text selections.
 * Handles symbols ($, EUR, £, etc.), ISO codes, and both US/EU number formats.
 */

/* eslint-disable no-var */
var CurrencyDetector = (() => {
  // Symbols sorted longest-first so "Mex$" matches before "$"
  const sortedSymbols = Object.keys(CURRENCY_SYMBOLS)
    .sort((a, b) => b.length - a.length);

  // Flatten CURRENCY_KEYWORDS to keyword -> [ISO codes]
  // We want to map "bucks" -> ['USD', ...]
  const keywordMap = {};
  if (typeof CURRENCY_KEYWORDS !== 'undefined') {
    Object.entries(CURRENCY_KEYWORDS).forEach(([isoOrKey, keywords]) => {
      // If the key is a generic one like 'GENERIC_DOLLAR', the value acts as the "ISO codes" to return
      // But wait, CURRENCY_KEYWORDS structure is: 'USD': ['dollar', ...], 'GENERIC_DOLLAR': ['USD', 'AUD'...]
      // Actually, for 'GENERIC_DOLLAR', the keywords are the ISO codes. This isn't right.
      // Re-reading my constants.js update:
      // 'GENERIC_DOLLAR': ['USD', 'AUD'...] is WRONG usage if I treat keys as ISOs.
      // My previous update: 
      // 'USD': ['dollar', ...], 
      // 'GENERIC_DOLLAR': ['USD', 'AUD'...] -> This entry means 'GENERIC_DOLLAR' is the "ISO".
      // That's not what I want. I want 'dollar' to map to multiple ISOs.

      // Correct Logic:
      // In constants.js, I have: 'USD': ['dollar'], 'AUD': ['dollar'...]?
      // No, in constants.js I have: 'USD': ['dollar'...], 'AUD': ['australian dollar'...]
      // I DO NOT have 'dollar' under 'AUD'.
      // But I added 'GENERIC_DOLLAR': ['USD', 'AUD'...] at the end.
      // Wait, 'GENERIC_DOLLAR' is the KEY. The VALUES are ['USD', 'AUD'...]
      // This is NOT the list of keywords. 
      // The structure of CURRENCY_KEYWORDS is { ISO_CODE: [list_of_keywords] }
      // So checking the file content again...
      // 'GENERIC_DOLLAR': ['USD', 'AUD'...] -> This means if found text is "USD" or "AUD", map to "GENERIC_DOLLAR"? NO.
      // This part of constants.js was sloppy of me. 
      // 'GENERIC_DOLLAR' is not a keyword.
      // I need to fix the logic here.

      // Correction:
      // The "GENERIC_*" entries in constants.js are actually mapping "CONFIG_KEY" -> [ISOs].
      // They are NOT keywords.
      // But wait, where are the generic keywords like "dollar"?
      // I put 'dollar' under 'USD'.
      // If I find "dollar", I should probably return ALL dollar currencies.
      // But currently 'dollar' is ONLY under 'USD'.
      // This means "20 dollars" will strictly map to USD.
      // This might be acceptable if "Default Dollar" setting handles 'USD' -> 'User Pref'.
      // But technically 'dollar' is ambiguous.

      // Better approach for this file:
      // 1. Map specific keywords found to their ISOs.
      // 2. Add explicit mappings for generic terms if they aren't covered.
      //    In constants.js I have: 'USD': ['dollar'...]
      //    So 'dollar' -> USD.
      //    This is "fine" for now, as the extension likely handles USD as a default or we can trust the user wants USD unless they say "Aussie Dollar".
      //    However, users might validly want "20 dollars" to be converted to their home currency, and treating it as USD to XXX is the standard behavior.

      // Let's proceed with the mapping:
      // We iterate over CURRENCY_KEYWORDS.
      // If the ISO is one of the GENERIC_* ones (which it is in the file I wrote),
      // we should probably ignore those or treat them differently?
      // Actually, looking at constants.js again:
      // 'GENERIC_DOLLAR': ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD']
      // This looks like key=GENERIC_DOLLAR, values=Currencies.
      // This DOES NOT contain the string "dollar".
      // So my previous edit to constants.js was slightly confused in intent for those generic keys, 
      // OR I intended to use them to lookup the list of codes when a generic word is found.
      // BUT I assigned 'dollar' specifically to 'USD' in the first block.

      // DECISION:
      // I will respect the current `constants.js` layout.
      // 'dollar' maps to 'USD'.
      // 'buck' maps to 'USD'.
      // 'loonie' maps to 'CAD'.
      // The "GENERIC_*" keys in constants.js seem unused by my logic unless I use them.
      // I will ignore them for now and stick to the explicit keyword mappings.

      keywords.forEach(kw => {
        // Skip if this "keyword" looks like an ISO code (length 3, uppercase) - just to be safe from the generic block
        if (kw.length === 3 && kw === kw.toUpperCase()) return;

        const lowerKw = kw.toLowerCase();
        if (!keywordMap[lowerKw]) {
          keywordMap[lowerKw] = [];
        }
        if (!keywordMap[lowerKw].includes(isoOrKey)) {
          keywordMap[lowerKw].push(isoOrKey);
        }
      });
    });
  }

  // Sort keywords by length descending to match "Australian Dollar" before "Dollar"
  const sortedKeywords = Object.keys(keywordMap)
    .sort((a, b) => b.length - a.length);

  // Escape regex special chars in symbols
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Build a combined regex pattern for all currency symbols
  const symbolPattern = sortedSymbols.map(escapeRegex).join('|');
  const keywordPattern = sortedKeywords.map(escapeRegex).join('|');

  // Number pattern: digits with optional thousands separators and decimal
  // Matches: 1000, 1,000, 1.000, 1,000.50, 1.000,50, 100.5, 100,5
  const numberPattern = '\\d{1,3}(?:[.,\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';

  // ISO code pattern: 3 uppercase letters that are known currencies
  const isoCodesSet = new Set(ECB_CURRENCIES);

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
    // Check keyword map (case-insensitive)
    const lower = symbolOrCode.toLowerCase();
    if (keywordMap[lower]) {
      return keywordMap[lower];
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

    // 1. Try Keyword Check FIRST (Prioritize "20 dollars", "50 bucks")
    if (keywordPattern) {
      // Try number before Keyword: "20 dollars", "50 bucks"
      // Use 'i' flag for case-insensitive matching logic
      const kwAfterRe = new RegExp(`(${numberPattern})\\s?(${keywordPattern})\\b`, 'i');
      const kwAfter = trimmed.match(kwAfterRe);
      if (kwAfter) {
        const amount = parseNumber(kwAfter[1], numberFormat);
        if (amount != null && amount > 0) {
          const currencies = identifyCurrencies(kwAfter[2]);
          if (currencies.length > 0) {
            return {
              amount,
              currencies,
              original: kwAfter[0],
              symbol: kwAfter[2],
            };
          }
        }
      }

      // Try Keyword before number: "US Dollars 20"
      const kwBeforeRe = new RegExp(`\\b(${keywordPattern})\\s?(${numberPattern})`, 'i');
      const kwBefore = trimmed.match(kwBeforeRe);
      if (kwBefore) {
        const amount = parseNumber(kwBefore[2], numberFormat);
        if (amount != null && amount > 0) {
          const currencies = identifyCurrencies(kwBefore[1]);
          if (currencies.length > 0) {
            return {
              amount,
              currencies,
              original: kwBefore[0],
              symbol: kwBefore[1],
            };
          }
        }
      }
    }

    // 2. Try ISO Code Checks (Prioritize "USD 100")

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

    // 3. Try Symbol Patterns LAST (Generic fallback)

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

    return null;
  }

  return { detectCurrency, parseNumber };
})();
