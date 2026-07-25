/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

async function testContentCaching() {
  let storedSettings = {
    extensionEnabled: true,
    conversionMode: 'interactive',
    disabledDomains: [],
  };
  let settingsGetCalls = 0;
  let rateRequestCalls = 0;
  let storageChangeListener = null;
  let selectionChangeListener = null;
  const scannerInitCalls = [];
  const scannerUpdateCalls = [];

  const fastSetTimeout = (callback, delay) => setTimeout(
    callback,
    Math.min(Number(delay) || 0, 1),
  );

  const context = {
    console,
    Intl,
    URL,
    setTimeout: fastSetTimeout,
    clearTimeout,
    document: {
      addEventListener: (type, listener) => {
        if (type === 'selectionchange') selectionChangeListener = listener;
      },
      getElementById: () => null,
    },
    window: {
      location: {
        hostname: 'frame.example',
        ancestorOrigins: ['https://shop.example'],
      },
      addEventListener: () => {},
      getSelection: () => ({ toString: () => '$10' }),
      matchMedia: () => ({ matches: false }),
    },
    chrome: {
      runtime: {
        onMessage: { addListener: () => {} },
        sendMessage: async (message) => {
          if (message.type === 'get-rates') {
            rateRequestCalls++;
            return { rates: { EUR: 1, USD: 1.2 } };
          }
          return undefined;
        },
      },
      storage: {
        sync: {
          get: async () => {
            settingsGetCalls++;
            return { settings: storedSettings };
          },
        },
        onChanged: {
          addListener: (listener) => {
            storageChangeListener = listener;
          },
        },
      },
    },
    CurrencyTooltip: {
      remove: () => {},
      show: () => {},
    },
    CurrencyDetector: {
      detectCurrency: () => null,
    },
    PageScanner: {
      init: (...args) => scannerInitCalls.push(args),
      updateSettings: (...args) => scannerUpdateCalls.push(args),
    },
  };

  vm.createContext(context);
  vm.runInContext(
    [
      fs.readFileSync('src/shared/constants.js', 'utf8'),
      fs.readFileSync('src/content/content.js', 'utf8'),
    ].join('\n'),
    context,
  );

  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(settingsGetCalls, 1);
  assert.strictEqual(rateRequestCalls, 0);
  assert.strictEqual(scannerInitCalls.length, 1);
  assert.strictEqual(scannerInitCalls[0][1], null);

  selectionChangeListener();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.strictEqual(settingsGetCalls, 1);

  const interactiveSettings = storedSettings;
  storedSettings = {
    ...storedSettings,
    conversionMode: 'auto',
  };
  await storageChangeListener({
    settings: {
      oldValue: interactiveSettings,
      newValue: storedSettings,
    },
  }, 'sync');
  assert.strictEqual(rateRequestCalls, 1);
  assert.strictEqual(scannerUpdateCalls.length, 1);

  const autoSettings = storedSettings;
  storedSettings = {
    ...storedSettings,
    disabledDomains: ['shop.example'],
  };
  await storageChangeListener({
    settings: {
      oldValue: autoSettings,
      newValue: storedSettings,
    },
  }, 'sync');
  assert.strictEqual(rateRequestCalls, 1);
  assert.strictEqual(scannerUpdateCalls.length, 2);
  assert.strictEqual(scannerUpdateCalls[1][1], null);

  const disabledSettings = storedSettings;
  storedSettings = {
    ...storedSettings,
    theme: 'dark',
  };
  await storageChangeListener({
    settings: {
      oldValue: disabledSettings,
      newValue: storedSettings,
    },
  }, 'sync');
  assert.strictEqual(rateRequestCalls, 1);
  assert.strictEqual(scannerUpdateCalls.length, 3);
}

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
          get: async () => ({ settings: { disableAnimations: true } }),
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
  assert.strictEqual(sentMessage[1].data.disableAnimations, true);

  let localGetCalls = 0;
  const coalescingContext = {
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
          get: async () => {
            localGetCalls++;
            await new Promise(resolve => setTimeout(resolve, 10));
            return {
              rates: { EUR: 1, USD: 1.2 },
              ratesTimestamp: now,
            };
          },
          set: async () => {},
        },
      },
      tabs: {
        sendMessage: () => {},
      },
    },
  };
  vm.createContext(coalescingContext);
  vm.runInContext(
    [
      fs.readFileSync('src/shared/constants.js', 'utf8'),
      fs.readFileSync('src/background/rates.js', 'utf8'),
      fs.readFileSync('src/background/service-worker.js', 'utf8'),
    ].join('\n'),
    coalescingContext,
  );

  const [firstRates, secondRates] = await Promise.all([
    coalescingContext.resolveRates(),
    coalescingContext.resolveRates(),
  ]);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(firstRates)),
    JSON.parse(JSON.stringify(secondRates)),
  );
  assert.strictEqual(localGetCalls, 1);

  await testContentCaching();

  console.log('service-worker: all tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
