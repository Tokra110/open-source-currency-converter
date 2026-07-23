/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const contentScript = manifest.content_scripts[0];

assert.strictEqual(contentScript.all_frames, true);
assert.strictEqual(contentScript.match_about_blank, true);
assert.strictEqual(contentScript.match_origin_as_fallback, true);

console.log('manifest: all tests passed');
