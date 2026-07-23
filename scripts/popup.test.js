/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/shared/constants.js', 'utf8'), context);

assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('hun')),
  JSON.stringify(['HUF']),
);
assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('dollar')),
  JSON.stringify(['AUD', 'CAD', 'HKD', 'NZD', 'SGD', 'USD']),
);
assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('EUR')),
  JSON.stringify(['EUR']),
);

console.log('popup: all tests passed');
