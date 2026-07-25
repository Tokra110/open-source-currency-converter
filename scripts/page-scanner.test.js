/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Intl, WeakMap, URL };
const pageScannerSource = fs.readFileSync('src/content/page-scanner.js', 'utf8');
vm.createContext(context);
vm.runInContext(
  [
    fs.readFileSync('src/shared/constants.js', 'utf8'),
    fs.readFileSync('src/content/currency-detector.js', 'utf8'),
    pageScannerSource,
  ].join('\n'),
  context,
);

function element(tagName, parentElement = null, options = {}) {
  return {
    tagName,
    parentElement,
    id: options.id || '',
    isContentEditable: options.isContentEditable || false,
    classList: {
      contains: () => false,
    },
  };
}

const editable = element('DIV', null, { isContentEditable: true });
const editableChild = element('SPAN', editable);
assert.strictEqual(context.PageScanner.shouldSkipNode({ parentElement: editableChild }), true);
assert.strictEqual(context.PageScanner.shouldSkipNode({ parentElement: element('SELECT') }), true);
assert.strictEqual(context.PageScanner.shouldSkipNode({ parentElement: element('OPTION') }), true);
assert.strictEqual(context.PageScanner.shouldSkipNode({ parentElement: element('P') }), false);

const embeddedWindow = { top: {}, self: {} };
const safeFrameDocument = { querySelector: () => null };
const sensitiveFrameDocument = {
  querySelector: () => ({ tagName: 'INPUT' }),
};
assert.strictEqual(
  context.PageScanner.isSensitiveEmbeddedFrame(safeFrameDocument, embeddedWindow),
  false,
);
assert.strictEqual(
  context.PageScanner.isSensitiveEmbeddedFrame(sensitiveFrameDocument, embeddedWindow),
  true,
);
assert.strictEqual(
  context.PageScanner.isSensitiveEmbeddedFrame(sensitiveFrameDocument, { top: null, self: null }),
  false,
);

const firstShadowRoot = { id: 'first' };
const secondShadowRoot = { id: 'second' };
const shadowHostTree = {
  querySelectorAll: () => [
    { shadowRoot: firstShadowRoot },
    { shadowRoot: null },
    { shadowRoot: secondShadowRoot },
  ],
};
assert.strictEqual(
  JSON.stringify(context.PageScanner.collectOpenShadowRoots(shadowHostTree)),
  JSON.stringify([firstShadowRoot, secondShadowRoot]),
);
assert.strictEqual(
  JSON.stringify(context.PageScanner.collectOpenShadowRoots({
    shadowRoot: firstShadowRoot,
    querySelectorAll: () => [],
  })),
  JSON.stringify([firstShadowRoot]),
);

assert.strictEqual(context.DEFAULT_SETTINGS.disableAnimations, false);
assert.strictEqual(context.PageScanner.shouldAnimate({ disableAnimations: false }), true);
assert.strictEqual(context.PageScanner.shouldAnimate({ disableAnimations: true }), false);
let immediateAnimationCompletions = 0;
let registeredAnimationHandler = null;
const animationElement = {
  addEventListener: (type, handler) => {
    assert.strictEqual(type, 'animationend');
    registeredAnimationHandler = handler;
  },
};
context.PageScanner.onAnimationOrNow(
  animationElement,
  () => { immediateAnimationCompletions++; },
  { disableAnimations: true },
);
assert.strictEqual(immediateAnimationCompletions, 1);
assert.strictEqual(registeredAnimationHandler, null);
context.PageScanner.onAnimationOrNow(
  animationElement,
  () => { immediateAnimationCompletions++; },
  { disableAnimations: false },
);
assert.strictEqual(immediateAnimationCompletions, 1);
assert.strictEqual(typeof registeredAnimationHandler, 'function');
registeredAnimationHandler();
assert.strictEqual(immediateAnimationCompletions, 2);

assert.strictEqual(
  typeof context.PageScanner.isNodeConnected,
  'function',
  'page scanner must expose a shadow-aware connectivity check',
);
assert.strictEqual(context.PageScanner.isNodeConnected({ isConnected: true }), true);
assert.strictEqual(context.PageScanner.isNodeConnected({ isConnected: false }), false);
assert.ok(
  !pageScannerSource.includes('if (!document.contains(element))'),
  'composite replacements must not reject connected shadow-root elements',
);
assert.ok(
  !pageScannerSource.includes('if (!document.contains(currentParent))'),
  'text replacements must not reject connected shadow-root parents',
);

const dollar = context.CurrencyDetector.detectCurrency('33.99 $');
const yen = context.CurrencyDetector.detectCurrency('2,000 ¥');
const kr = context.CurrencyDetector.detectCurrency('200 kr');

assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(
    ['Subtotal', '33.99 $', 'Shipping', '18.99 $', 'Total', 'CAD', '43.17 $'],
    dollar,
    'auto',
  ).currency,
  'CAD',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['CAD', '$43.17'], dollar, 'auto').currency,
  'CAD',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['AUD', '$120'], dollar, 'auto').currency,
  'AUD',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['JPY', '2,000 ¥'], yen, 'auto').currency,
  'JPY',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['NOK', '200 kr'], kr, 'auto').currency,
  'NOK',
);

assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(
    ['CAD', '20 $', 'USD', '15 $'],
    dollar,
    'auto',
  ).status,
  'conflict',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['EUR', '20 €', '15 $'], dollar, 'auto').status,
  'none',
);
assert.strictEqual(
  context.PageScanner.analyzeCurrencyContext(['Shipping to Canada', '15 $'], dollar, 'auto').status,
  'none',
);

const settings = { ...context.DEFAULT_SETTINGS, defaultDollarCurrency: 'USD' };
assert.strictEqual(
  context.shouldLoadPageScannerRates(
    { ...context.DEFAULT_SETTINGS, conversionMode: 'interactive' },
    'shop.example',
  ),
  false,
);
assert.strictEqual(
  context.shouldLoadPageScannerRates(
    { ...context.DEFAULT_SETTINGS, extensionEnabled: false },
    'shop.example',
  ),
  false,
);
assert.strictEqual(
  context.shouldLoadPageScannerRates(
    { ...context.DEFAULT_SETTINGS, disabledDomains: ['shop.example'] },
    'shop.example',
  ),
  false,
);
assert.strictEqual(
  context.shouldLoadPageScannerRates(context.DEFAULT_SETTINGS, 'shop.example'),
  true,
);
assert.strictEqual(
  context.getSiteHostname({
    hostname: '',
    ancestorOrigins: ['https://frame.example', 'https://shop.example'],
  }),
  'shop.example',
);
assert.strictEqual(
  context.getSiteHostname({
    hostname: 'frame.example',
    ancestorOrigins: ['https://shop.example'],
  }),
  'shop.example',
);
assert.strictEqual(
  context.getSiteHostname({
    hostname: 'shop.example',
    ancestorOrigins: [],
  }),
  'shop.example',
);

assert.strictEqual(
  context.PageScanner.resolveDetectedCurrency(
    dollar,
    settings,
    { status: 'resolved', currency: 'CAD' },
  ),
  'CAD',
);
assert.strictEqual(
  context.PageScanner.resolveDetectedCurrency(
    dollar,
    settings,
    { status: 'conflict', currency: null },
  ),
  null,
);
assert.strictEqual(
  context.PageScanner.resolveDetectedCurrency(
    dollar,
    settings,
    { status: 'none', currency: null },
  ),
  'USD',
);

const body = { tagName: 'BODY', parentElement: null };
const checkout = { tagName: 'SECTION', parentElement: body };
const row = { tagName: 'DIV', parentElement: checkout };
const price = { tagName: 'SPAN', parentElement: row };
const fragmentsByScope = new Map([
  [price, ['33.99 $']],
  [row, ['Subtotal', '33.99 $']],
  [checkout, ['Subtotal', '33.99 $', 'Total', 'CAD', '43.17 $']],
]);

assert.strictEqual(
  context.PageScanner.findScopedCurrencyContext(
    price,
    dollar,
    'auto',
    (scope) => fragmentsByScope.get(scope) || [],
  ).currency,
  'CAD',
);

assert.strictEqual(
  context.PageScanner.formatOriginalTitle('33.99 $', 'CAD'),
  'Original: 33.99 $ (CAD)',
);
assert.strictEqual(
  context.PageScanner.formatOriginalTitle('2,000 ¥', 'JPY'),
  'Original: 2,000 ¥ (JPY)',
);
assert.strictEqual(
  (pageScannerSource.match(/title = formatOriginalTitle\(fullOriginal, fromCurrency\)/g) || []).length,
  2,
);

const scanQueue = [1, 2, 3, 4, 5];
const processedItems = [];
const remainingWork = context.PageScanner.drainScanWork(
  scanQueue,
  item => processedItems.push(item),
  { timeRemaining: () => 50 },
  2,
);
assert.deepStrictEqual(processedItems, [1, 2]);
assert.strictEqual(remainingWork, 3);

const traversalNodes = [{ id: 1 }, { id: 2 }, { id: 3 }];
const traversalState = {
  rootPending: false,
  walker: {
    nextNode: () => traversalNodes.shift() || null,
  },
};
const visitedTraversalNodes = [];
assert.strictEqual(
  JSON.stringify(context.PageScanner.drainDomTraversal(
    traversalState,
    node => visitedTraversalNodes.push(node.id),
    { timeRemaining: () => 50 },
    2,
  )),
  JSON.stringify({ processed: 2, done: false }),
);
assert.deepStrictEqual(visitedTraversalNodes, [1, 2]);
assert.strictEqual(
  JSON.stringify(context.PageScanner.drainDomTraversal(
    traversalState,
    node => visitedTraversalNodes.push(node.id),
    { timeRemaining: () => 50 },
    2,
  )),
  JSON.stringify({ processed: 1, done: true }),
);
assert.deepStrictEqual(visitedTraversalNodes, [1, 2, 3]);

const pendingParent = { parentNode: null };
const pendingChild = { parentNode: pendingParent };
const pendingSibling = { parentNode: null };
assert.strictEqual(
  JSON.stringify(context.PageScanner.compactPendingNodes([
    pendingParent,
    pendingChild,
    pendingParent,
    pendingSibling,
  ])),
  JSON.stringify([pendingParent, pendingSibling]),
);

let debugFactoryCalls = 0;
assert.strictEqual(
  context.PageScanner.createDebugData(() => {
    debugFactoryCalls++;
    return { expensive: true };
  }),
  undefined,
);
assert.strictEqual(debugFactoryCalls, 0);
assert.deepStrictEqual(
  context.PageScanner.createDebugData(() => {
    debugFactoryCalls++;
    return { expensive: true };
  }, true),
  { expensive: true },
);
assert.strictEqual(debugFactoryCalls, 1);

const contextCache = new WeakMap();
let collectorCalls = 0;
const cachedCollector = scope => {
  collectorCalls++;
  return fragmentsByScope.get(scope) || [];
};
for (let attempt = 0; attempt < 2; attempt++) {
  assert.strictEqual(
    context.PageScanner.findScopedCurrencyContext(
      price,
      dollar,
      'auto',
      cachedCollector,
      contextCache,
    ).currency,
    'CAD',
  );
}
assert.strictEqual(collectorCalls, 3);

console.log('page-scanner: all tests passed');
