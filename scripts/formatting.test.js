/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/shared/constants.js', 'utf8'), context);

assert.strictEqual(context.DEFAULT_SETTINGS.outputFormat, 'smart');
assert.strictEqual(context.resolveOutputLocale('smart', 'hu-HU'), 'hu-HU');
assert.strictEqual(context.resolveOutputLocale('us', 'hu-HU'), 'en-US');
assert.strictEqual(context.resolveOutputLocale('eu', 'en-US'), 'de-DE');
assert.strictEqual(
  context.formatCurrencyAmount(1234.5, 'USD', 'us'),
  '1,234.50',
);
assert.strictEqual(
  context.formatCurrencyAmount(1234.5, 'USD', 'eu'),
  '1.234,50',
);
assert.strictEqual(
  context.formatCompactCurrencyAmount(1020000, 'EUR', { multiplier: 1000000, label: 'M' }, 'us'),
  '1.02M',
);

console.log('formatting: all tests passed');
