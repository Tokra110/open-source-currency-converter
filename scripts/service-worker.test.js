/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

async function run() {
  let sentMessage = null;
  const now = new Date().toISOString();
  const context = {
    console,
    Intl,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch,
    importScripts: () => {},
    chrome: {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: { addListener: () => {} },
      },
      alarms: {
        create: () => {},
        onAlarm: { addListener: () => {} },
      },
      storage: {
        sync: {
          get: async () => ({ settings: {} }),
          set: async () => {},
        },
        local: {
          get: async () => ({
            rates: { EUR: 1, USD: 1.2 },
            ratesTimestamp: now,
          }),
          set: async () => {},
        },
      },
      tabs: {
        sendMessage: (...args) => {
          sentMessage = args;
        },
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(
    [
      fs.readFileSync('src/shared/constants.js', 'utf8'),
      fs.readFileSync('src/background/rates.js', 'utf8'),
      fs.readFileSync('src/background/service-worker.js', 'utf8'),
    ].join('\n'),
    context,
  );

  await context.handleCurrencyDetected(
    {
      detection: {
        amount: 10,
        currencies: ['EUR'],
        selectionText: '€10',
        symbol: '€',
      },
    },
    { tab: { id: 42 }, frameId: 7 },
  );

  assert(sentMessage);
  assert.strictEqual(sentMessage[0], 42);
  assert.strictEqual(sentMessage[2].frameId, 7);
  console.log('service-worker: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
