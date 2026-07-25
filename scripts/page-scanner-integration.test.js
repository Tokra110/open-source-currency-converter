/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const chromePath = [
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find(candidate => fs.existsSync(candidate));

assert.ok(chromePath, 'A Chrome or Chromium executable is required');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'currency-converter-test-'));
const fixtureUrl = pathToFileURL(
  path.resolve(__dirname, 'page-scanner.integration.html'),
).href;

try {
  const result = spawnSync(chromePath, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${profileDir}`,
    '--virtual-time-budget=12000',
    '--dump-dom',
    fixtureUrl,
  ], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });

  assert.strictEqual(result.status, 0, result.stderr);
  const replacements = result.stdout.match(
    /class="[^"]*\bcc-auto-replaced\b[^"]*"/g,
  ) || [];
  assert.match(result.stdout, />6,750 Ft</);
  assert.match(
    result.stdout,
    /<span[^>]*id="split-price-container"[^>]*class="[^"]*\bcc-auto-replaced\b[^"]*"[^>]*>13,415 Ft<\/span>/,
    'Hybrid mode should replace the complete split-price element',
  );
  assert.doesNotMatch(
    result.stdout,
    /id="split-price-container"[^>]*font-size:\s*8px/,
    'The converted split price should use the surrounding available width',
  );
  assert.match(
    result.stdout,
    /<div[^>]*id="split-symbol-rate"[^>]*class="[^"]*\bcc-auto-replaced\b[^"]*"[^>]*>1,636 Ft \/ MTok<\/div>/,
    'Hybrid mode should combine a split currency symbol and amount',
  );
  assert.match(
    result.stdout,
    /<div[^>]*id="split-code-rate"[^>]*class="[^"]*\bcc-auto-replaced\b[^"]*"[^>]*>1,800 Ft \/ MTok<\/div>/,
    'Hybrid mode should combine a split ISO currency code and amount',
  );
  assert.doesNotMatch(
    result.stdout,
    /class="[^"]*\bcc-auto-replaced\b[^"]*"[^>]*font-size:\s*(?:1[7-9]|[2-9]\d|[1-9]\d{2,})(?:\.\d+)?px/,
    'Layout fallback must never enlarge converted text',
  );

  // A price the site recalculates after we converted it must not stay frozen
  // at the old converted value. $10.00 -> 3,273 Ft, $25.00 -> 8,182 Ft.
  assert.doesNotMatch(
    result.stdout,
    /id="recalc-plain"[\s\S]{0,200}?3,273 Ft/,
    'A recalculated price must not keep showing the old converted value',
  );
  assert.match(
    result.stdout,
    /id="recalc-plain"[\s\S]{0,200}?8,182 Ft/,
    'A recalculated price should be converted again from its new value',
  );
  assert.match(
    result.stdout,
    /id="recalc-composite"[^>]*>8,182 Ft</,
    'A recalculated composite price should be converted again',
  );
  assert.match(
    result.stdout,
    /id="recalc-overwrite"[^>]*>8,182 Ft</,
    'A row the site rewrites in place should be converted again',
  );

  // When the new value is not a price, the site keeps its own text and no
  // stale "Original: ..." label may survive.
  assert.match(
    result.stdout,
    /id="recalc-gone"[^>]*>Calculated at next step</,
    'A value that stops being a price must fall back to the native text',
  );
  assert.doesNotMatch(
    result.stdout,
    /title="Original: \$10\.00 \(USD\)"/,
    'No conversion may keep a label describing a value it no longer shows',
  );

  // Checked last: a count mismatch is a symptom, the assertions above name the cause.
  assert.strictEqual(
    replacements.length,
    11,
    'Hybrid mode should replace each price exactly once',
  );
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log('page-scanner-integration: all tests passed');
