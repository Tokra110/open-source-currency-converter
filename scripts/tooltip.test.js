/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

async function run() {
  let copiedText = null;
  const context = {
    console,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          copiedText = text;
        },
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(
    [
      fs.readFileSync('src/shared/constants.js', 'utf8'),
      fs.readFileSync('src/content/tooltip.js', 'utf8'),
    ].join('\n'),
    context,
  );

  const copied = await context.CurrencyTooltip.copyValue({
    convertedAmount: 1234.5,
    targetCurrency: 'USD',
  });

  assert.strictEqual(copied, true);
  assert.strictEqual(copiedText, '1,234.50 USD');
  console.log('tooltip: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
