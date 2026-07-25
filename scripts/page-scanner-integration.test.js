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
    '--virtual-time-budget=2000',
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
  assert.strictEqual(
    replacements.length,
    8,
    'Hybrid mode should replace each price exactly once',
  );
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
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log('page-scanner-integration: all tests passed');
