/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Intl, WeakMap };
vm.createContext(context);
vm.runInContext(
  [
    fs.readFileSync('src/shared/constants.js', 'utf8'),
    fs.readFileSync('src/content/page-scanner.js', 'utf8'),
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

console.log('page-scanner: all tests passed');
