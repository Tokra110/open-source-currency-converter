/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadRuntime() {
  const source = [
    fs.readFileSync('src/shared/constants.js', 'utf8'),
    fs.readFileSync('src/content/currency-detector.js', 'utf8'),
  ].join('\n');

  const context = { console };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function detectAll(detector, text, numberFormat = 'auto', maxLength = 400, cap = 25) {
  const results = [];
  let startIndex = 0;
  let guard = 0;

  while (guard < cap) {
    const detection = detector.detectCurrency(text, numberFormat, { maxLength, startIndex });
    if (!detection) break;
    results.push(detection);
    startIndex = detection.end;
    guard += 1;
  }

  return results;
}

function run() {
  const runtime = loadRuntime();
  const detector = runtime.CurrencyDetector;

  // Positive / expected detections
  let d = detector.detectCurrency('€0', 'auto', { maxLength: 200 });
  assert(d && d.amount === 0 && d.symbol === '€');

  d = detector.detectCurrency('.99 €', 'auto', { maxLength: 200 });
  assert(d && d.amount === 0.99 && d.original.includes('.99'));

  d = detector.detectCurrency('USD   10', 'auto', { maxLength: 200 });
  assert(d && d.amount === 10 && d.currencies[0] === 'USD');

  d = detector.detectCurrency('A$10', 'auto', { maxLength: 200 });
  assert(d && d.currencies.length === 1 && d.currencies[0] === 'AUD');

  d = detector.detectCurrency('CA$10', 'auto', { maxLength: 200 });
  assert(d && d.currencies.length === 1 && d.currencies[0] === 'CAD');

  d = detector.detectCurrency('$33.99 CAD', 'auto', { maxLength: 200 });
  assert(d && d.amount === 33.99);
  assert.deepStrictEqual(Array.from(d.currencies), ['CAD']);
  assert.strictEqual(d.original, '$33.99 CAD');

  d = detector.detectCurrency('¥100 CNY', 'auto', { maxLength: 200 });
  assert(d && d.amount === 100 && d.currencies[0] === 'CNY');
  assert.strictEqual(d.original, '¥100 CNY');

  d = detector.detectCurrency('-$33.99 CAD', 'auto', { maxLength: 200 });
  assert(d && d.amount === -33.99 && d.negativeStyle === 'sign');
  assert.strictEqual(d.original, '-$33.99 CAD');

  d = detector.detectCurrency('$5 then 10 CAD', 'auto', { maxLength: 200 });
  assert(d && d.symbol === '$' && d.amount === 5);

  d = detector.detectCurrency('$33.99 EUR', 'auto', { maxLength: 200 });
  assert(d && d.symbol === '$');
  assert(d.currencies.includes('USD') && !d.currencies.includes('EUR'));
  assert.strictEqual(d.original, '$33.99');

  // Indian grouping is supported only when the source is explicitly INR.
  for (const sample of ['₹1,23,456.78', 'INR 1,23,456.78', '1,23,456.78 rupees']) {
    d = detector.detectCurrency(sample, 'auto', { maxLength: 200 });
    assert(d && d.amount === 123456.78 && d.currencies[0] === 'INR');
    assert.strictEqual(d.original, sample);
  }
  assert.strictEqual(detector.detectCurrency('$1,23,456.78', 'auto', { maxLength: 200 }), null);

  // Apostrophe grouping is supported only when the source is explicitly CHF.
  const swissSamples = [
    ["CHF 1'234.56", 1234.56],
    ['1’234,56 Fr.', 1234.56],
    ["Swiss francs 1'234.50", 1234.5],
  ];
  for (const [sample, amount] of swissSamples) {
    d = detector.detectCurrency(sample, 'auto', { maxLength: 200 });
    assert(d && d.amount === amount && d.currencies[0] === 'CHF');
    assert.strictEqual(d.original, sample);
  }
  assert.strictEqual(detector.detectCurrency("$1'234.56", 'auto', { maxLength: 200 }), null);
  d = detector.detectCurrency('-₹1,23,456', 'auto', { maxLength: 200 });
  assert(d && d.amount === -123456 && d.currencies[0] === 'INR');
  d = detector.detectCurrency("-CHF 1'234.56", 'auto', { maxLength: 200 });
  assert(d && d.amount === -1234.56 && d.currencies[0] === 'CHF');

  // Signed refunds and accounting parentheses preserve their negative meaning.
  d = detector.detectCurrency('-€10', 'auto', { maxLength: 200 });
  assert(d && d.amount === -10 && d.negativeStyle === 'sign');

  d = detector.detectCurrency('-€10 and $5', 'auto', { maxLength: 200 });
  assert(d && d.symbol === '€' && d.amount === -10);

  d = detector.detectCurrency('Refund -1 Ft then 2 Ft', 'auto', { maxLength: 200 });
  assert(d && d.amount === -1 && d.original.includes('-1 Ft'));

  d = detector.detectCurrency('Refund: ($20.00)', 'auto', { maxLength: 200 });
  assert(d && d.amount === -20 && d.negativeStyle === 'parentheses');
  assert.strictEqual(d.original, '($20.00)');

  // Compact suffixes require an explicit currency and expand before conversion.
  const compactSamples = [
    ['$1.2M', 1200000, 'M'],
    ['€850K', 850000, 'K'],
    ['JPY 2.4 billion', 2400000000, 'B'],
    ['£3bn', 3000000000, 'B'],
  ];
  for (const [sample, amount, label] of compactSamples) {
    d = detector.detectCurrency(sample, 'auto', { maxLength: 200 });
    assert(d && d.amount === amount);
    assert(d.compact && d.compact.label === label);
    assert.strictEqual(d.original, sample);
  }
  assert.strictEqual(detector.detectCurrency('The cable is 1.2m long', 'auto', { maxLength: 200 }), null);

  // Boundary hardening: avoid IDs/version tokens.
  assert.strictEqual(detector.detectCurrency('R2D2', 'auto', { maxLength: 200 }), null);
  assert.strictEqual(detector.detectCurrency('v1.0USD', 'auto', { maxLength: 200 }), null);
  assert.strictEqual(detector.detectCurrency('abc100USD', 'auto', { maxLength: 200 }), null);
  assert.strictEqual(detector.detectCurrency('SKU-100USD-XL', 'auto', { maxLength: 200 }), null);

  // Length policy is now caller-driven.
  const longText = `${'x'.repeat(250)} USD 10`;
  d = detector.detectCurrency(longText, 'auto');
  assert(d && d.amount === 10);
  assert.strictEqual(detector.detectCurrency(longText, 'auto', { maxLength: 200 }), null);

  // Multi-amount flow for one text node (iterative scanning by startIndex).
  const all = detectAll(detector, '$5 and €0 and A$10 and -¥50 and 12 kr');
  assert.strictEqual(all.length, 5);
  assert(all[0].original.includes('$5'));
  assert(all[1].original.includes('€0'));
  assert(all[2].original.includes('A$10'));
  assert(all[3].original.includes('-¥50') && all[3].amount === -50);
  assert(all[4].original.includes('12 kr'));

  // Ambiguous symbol preferences.
  const settings = {
    ...runtime.DEFAULT_SETTINGS,
    defaultDollarCurrency: 'CAD',
    defaultYenCurrency: 'CNY',
    defaultKrCurrency: 'NOK',
    defaultFrCurrency: 'CHF',
  };

  assert.strictEqual(
    runtime.chooseDetectedCurrency({ symbol: '$', currencies: ['USD', 'CAD'] }, settings),
    'CAD'
  );
  assert.strictEqual(
    runtime.chooseDetectedCurrency({ symbol: '¥', currencies: ['JPY', 'CNY'] }, settings),
    'CNY'
  );
  assert.strictEqual(
    runtime.chooseDetectedCurrency({ symbol: 'kr', currencies: ['SEK', 'NOK', 'DKK'] }, settings),
    'NOK'
  );
  assert.strictEqual(
    runtime.chooseDetectedCurrency({ symbol: 'Fr', currencies: ['CHF'] }, settings),
    'CHF'
  );

  console.log('detector-corpus: all tests passed');
}

run();
