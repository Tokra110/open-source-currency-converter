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
  const compactTokenPattern = [
    ...sortedSymbols,
    ...ECB_CURRENCIES,
    ...sortedKeywords,
  ]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');

  // Matches: 1000, 1,000, 1.000, 1,000.50, 1.000,50, 100.5, 100,5, .99, ,99
  const numberPattern = '(?:\\d{1,3}(?:[.,\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?|[.,]\\d{1,2})';
  const indianNumberPattern = '\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,2})?';
  const swissNumberPattern = "\\d{1,3}(?:['’]\\d{3})+(?:[.,]\\d{1,2})?";
  const signPattern = '[+\\-−]';
  const leftBoundary = `(?<![A-Za-z0-9_.,'’-])`;
  const rightBoundary = `(?![A-Za-z0-9_.,'’-])`;

  const isoCodesSet = new Set(ECB_CURRENCIES);

  // Pre-compile regexes once at init time (avoids re-creation on every detectCurrency call)
  const kwAfterRe = keywordPattern
    ? new RegExp(`${leftBoundary}(?:(${signPattern})\\s*)?(${numberPattern})\\s*(${keywordPattern})\\b${rightBoundary}`, 'ig')
    : null;
  const kwBeforeRe = keywordPattern
    ? new RegExp(`${leftBoundary}(${keywordPattern})\\s*(?:(${signPattern})\\s*)?(${numberPattern})${rightBoundary}`, 'ig')
    : null;

  const isoBeforeRe = new RegExp(`${leftBoundary}([A-Z]{3})\\s*(?:(${signPattern})\\s*)?(${numberPattern})${rightBoundary}`, 'ig');
  const isoAfterRe = new RegExp(`${leftBoundary}(?:(${signPattern})\\s*)?(${numberPattern})\\s*([A-Z]{3})${rightBoundary}`, 'ig');
  const indianTokenPattern = '(₹|INR|rupees?)';
  const indianBeforeRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?${indianTokenPattern}\\s*` +
    `(?:(${signPattern})\\s*)?(${indianNumberPattern})${rightBoundary}`,
    'ig',
  );
  const indianAfterRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?(${indianNumberPattern})\\s*` +
    `${indianTokenPattern}${rightBoundary}`,
    'ig',
  );
  const swissTokenPattern = '(CHF|Fr\\.?|Swiss\\s+francs?|francs?)';
  const swissBeforeRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?${swissTokenPattern}\\s*` +
    `(?:(${signPattern})\\s*)?(${swissNumberPattern})${rightBoundary}`,
    'ig',
  );
  const swissAfterRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?(${swissNumberPattern})\\s*` +
    `${swissTokenPattern}${rightBoundary}`,
    'ig',
  );
  const compactSuffixPattern = '(k|m|b|bn|million|billion)';
  const compactBeforeRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?(${compactTokenPattern})\\s*` +
    `(?:(${signPattern})\\s*)?(${numberPattern})\\s*${compactSuffixPattern}${rightBoundary}`,
    'ig',
  );
  const compactAfterRe = new RegExp(
    `${leftBoundary}(?:(${signPattern})\\s*)?(${numberPattern})\\s*` +
    `${compactSuffixPattern}\\s*(${compactTokenPattern})${rightBoundary}`,
    'ig',
  );

  // Symbol regexes with negative lookbehind to prevent matching inside words (e.g., GDDR6)
  // (?<![A-Za-z0-9]) ensures the symbol is not preceded by alphanumeric characters
  const symbolBeforeRegexes = sortedSymbols.map(symbol => ({
    symbol,
    re: new RegExp(`${leftBoundary}(?:(${signPattern})\\s*)?(${escapeRegex(symbol)})\\s*(?:(${signPattern})\\s*)?(${numberPattern})${rightBoundary}`, 'g'),
  }));
  const symbolAfterRegexes = sortedSymbols.map(symbol => ({
    symbol,
    re: new RegExp(`${leftBoundary}(?:(${signPattern})\\s*)?(${numberPattern})\\s*(${escapeRegex(symbol)})${rightBoundary}`, 'g'),
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

  function isNegativeSign(sign) {
    return sign === '-' || sign === '−';
  }

  function parseIndianNumber(numStr) {
    return parseFloat(numStr.replace(/,/g, ''));
  }

  function parseSwissNumber(numStr) {
    return parseFloat(numStr.replace(/['’]/g, '').replace(',', '.'));
  }

  function compactMetadata(rawSuffix) {
    const suffix = rawSuffix.toLowerCase();
    if (suffix === 'k') return { multiplier: 1e3, label: 'K' };
    if (suffix === 'm' || suffix === 'million') return { multiplier: 1e6, label: 'M' };
    return { multiplier: 1e9, label: 'B' };
  }

  function isNegativeBySign(signs) {
    return signs.some(isNegativeSign);
  }

  function scanRegexForResult(re, text, startIndex, buildFromMatch) {
    if (!re) return null;

    re.lastIndex = startIndex;
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const result = buildFromMatch(match, start, end);
      if (result) return result;

      // Safety: ensure progress even on unexpected zero-width scenarios.
      if (re.lastIndex <= start) {
        re.lastIndex = start + 1;
      }
    }

    return null;
  }

  function pickEarlier(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (b.start < a.start) return b;
    if (b.start > a.start) return a;
    if (b.original.length > a.original.length) return b;
    return a;
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
  function buildResult(amount, currencies, original, symbol, start, end, signs = []) {
    if (!Number.isFinite(amount) || currencies.length === 0) return null;
    const isNegative = amount < 0 || isNegativeBySign(signs);
    return {
      amount: isNegative ? -Math.abs(amount) : amount,
      currencies,
      original,
      symbol,
      start,
      end,
      negativeStyle: isNegative ? 'sign' : null,
    };
  }

  function applyAccountingParentheses(result, text) {
    if (!result) return null;

    let left = result.start - 1;
    while (left >= 0 && /\s/.test(text[left])) left--;
    let right = result.end;
    while (right < text.length && /\s/.test(text[right])) right++;

    if (left >= 0 && text[left] === '(' && right < text.length && text[right] === ')') {
      return {
        ...result,
        amount: -Math.abs(result.amount),
        original: text.substring(left, right + 1),
        start: left,
        end: right + 1,
        negativeStyle: 'parentheses',
      };
    }

    return result;
  }

  /**
   * Try to detect currency via keywords like "dollars", "bucks", "euro".
   */
  function detectByKeyword(text, numberFormat, startIndex) {
    if (!kwAfterRe) return null;

    // Number before keyword: "20 dollars"
    const afterResult = scanRegexForResult(kwAfterRe, text, startIndex, (match, start, end) => {
      const amount = parseNumber(match[2], numberFormat);
      const currencies = identifyCurrencies(match[3]);
      return buildResult(amount, currencies, match[0], match[3], start, end, [match[1]]);
    });

    // Keyword before number: "US Dollars 20"
    const beforeResult = scanRegexForResult(kwBeforeRe, text, startIndex, (match, start, end) => {
      const amount = parseNumber(match[3], numberFormat);
      const currencies = identifyCurrencies(match[1]);
      return buildResult(amount, currencies, match[0], match[1], start, end, [match[2]]);
    });

    return pickEarlier(afterResult, beforeResult);
  }

  /**
   * Try to detect currency via ISO codes like "USD", "EUR".
   */
  function detectByIsoCode(text, numberFormat, startIndex) {
    // ISO code before number: "USD 100"
    const beforeResult = scanRegexForResult(isoBeforeRe, text, startIndex, (match, start, end) => {
      const iso = match[1].toUpperCase();
      if (!isoCodesSet.has(iso)) return null;
      const amount = parseNumber(match[3], numberFormat);
      return buildResult(amount, [iso], match[0], match[1], start, end, [match[2]]);
    });

    // Number before ISO code: "100 USD"
    const afterResult = scanRegexForResult(isoAfterRe, text, startIndex, (match, start, end) => {
      const iso = match[3].toUpperCase();
      if (!isoCodesSet.has(iso)) return null;
      const amount = parseNumber(match[2], numberFormat);
      return buildResult(amount, [iso], match[0], match[3], start, end, [match[1]]);
    });

    return pickEarlier(beforeResult, afterResult);
  }

  function detectByIndianGrouping(text, startIndex) {
    const beforeResult = scanRegexForResult(indianBeforeRe, text, startIndex, (match, start, end) => {
      const token = match[2];
      return buildResult(
        parseIndianNumber(match[4]),
        ['INR'],
        match[0],
        token,
        start,
        end,
        [match[1], match[3]],
      );
    });

    const afterResult = scanRegexForResult(indianAfterRe, text, startIndex, (match, start, end) => {
      const token = match[3];
      return buildResult(
        parseIndianNumber(match[2]),
        ['INR'],
        match[0],
        token,
        start,
        end,
        [match[1]],
      );
    });

    return pickEarlier(beforeResult, afterResult);
  }

  function detectBySwissGrouping(text, startIndex) {
    const beforeResult = scanRegexForResult(swissBeforeRe, text, startIndex, (match, start, end) => {
      return buildResult(
        parseSwissNumber(match[4]),
        ['CHF'],
        match[0],
        match[2],
        start,
        end,
        [match[1], match[3]],
      );
    });

    const afterResult = scanRegexForResult(swissAfterRe, text, startIndex, (match, start, end) => {
      return buildResult(
        parseSwissNumber(match[2]),
        ['CHF'],
        match[0],
        match[3],
        start,
        end,
        [match[1]],
      );
    });

    return pickEarlier(beforeResult, afterResult);
  }

  function detectByCompactAmount(text, numberFormat, startIndex) {
    const beforeResult = scanRegexForResult(compactBeforeRe, text, startIndex, (match, start, end) => {
      const currencies = identifyCurrencies(match[2]);
      const compact = compactMetadata(match[5]);
      const result = buildResult(
        parseNumber(match[4], numberFormat) * compact.multiplier,
        currencies,
        match[0],
        match[2],
        start,
        end,
        [match[1], match[3]],
      );
      return result ? { ...result, compact } : null;
    });

    const afterResult = scanRegexForResult(compactAfterRe, text, startIndex, (match, start, end) => {
      const currencies = identifyCurrencies(match[4]);
      const compact = compactMetadata(match[3]);
      const result = buildResult(
        parseNumber(match[2], numberFormat) * compact.multiplier,
        currencies,
        match[0],
        match[4],
        start,
        end,
        [match[1]],
      );
      return result ? { ...result, compact } : null;
    });

    return pickEarlier(beforeResult, afterResult);
  }

  /**
   * Try to detect currency via symbols like "$", "EUR", "£".
   */
  function detectBySymbol(text, numberFormat, startIndex) {
    let best = null;

    // Symbol before number: "$100"
    for (const { re } of symbolBeforeRegexes) {
      const result = scanRegexForResult(re, text, startIndex, (match, start, end) => {
        const amount = parseNumber(match[4], numberFormat);
        const currencies = identifyCurrencies(match[2]);
        return buildResult(amount, currencies, match[0], match[2], start, end, [match[1], match[3]]);
      });
      best = pickEarlier(best, result);
    }

    // Number before symbol: "100$"
    for (const { re } of symbolAfterRegexes) {
      const result = scanRegexForResult(re, text, startIndex, (match, start, end) => {
        const amount = parseNumber(match[2], numberFormat);
        const currencies = identifyCurrencies(match[3]);
        return buildResult(amount, currencies, match[0], match[3], start, end, [match[1]]);
      });
      best = pickEarlier(best, result);
    }

    return best;
  }

  /**
   * Detect currency amount in the given text.
   * Finds the earliest valid match across keyword, ISO, and symbol detection.
   *
   * @param {string} text - Selected text to analyze
   * @param {string} numberFormat - 'auto', 'us', or 'eu'
   * @param {{ maxLength?: number, startIndex?: number }} options - Detection options
   * @returns {{ amount: number, currencies: string[], original: string, symbol: string, start: number, end: number } | null}
   */
  function detectCurrency(text, numberFormat = 'auto', options = {}) {
    if (!text) return null;

    const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : null;
    if (maxLength != null && text.length > maxLength) return null;

    const startIndex = Number.isFinite(options.startIndex)
      ? Math.max(0, Math.floor(options.startIndex))
      : 0;
    if (startIndex >= text.length) return null;

    const keywordResult = detectByKeyword(text, numberFormat, startIndex);
    const isoResult = detectByIsoCode(text, numberFormat, startIndex);
    const symbolResult = detectBySymbol(text, numberFormat, startIndex);
    const indianResult = detectByIndianGrouping(text, startIndex);
    const swissResult = detectBySwissGrouping(text, startIndex);
    const compactResult = detectByCompactAmount(text, numberFormat, startIndex);

    const result = pickEarlier(
      pickEarlier(
        pickEarlier(pickEarlier(pickEarlier(keywordResult, isoResult), symbolResult), indianResult),
        swissResult,
      ),
      compactResult,
    );
    return applyAccountingParentheses(result, text);
  }

  return { detectCurrency, parseNumber };
})();
