# Open source currency converter manual

How the extension is built and why: modes, file layout, tests, release and gotchas. The brief is `AGENTS.md`; the release history is `CHANGELOG.md`; the dated log is `session-notes.md`; the user-facing description is `README.md`.

## Modes

The popup offers two modes. The setting is `conversionMode`.

- **Hybrid** (stored as `auto`, the default): scans the page in small idle-time chunks and replaces prices with converted values. Hover shows the original amount. Selecting a price also opens the tooltip.
- **Interactive** (`interactive`): the page stays unchanged. Selecting text with a price opens the tooltip with the converted amount.

The scanner skips editable fields, password and payment forms, scripts, styles and the extension's own elements. It also reaches embedded frames and open shadow roots. `autoReplaceLimit` caps replacements per page so a large page does not freeze.

## File layout

```
manifest.json                      MV3 manifest: permissions, content scripts, popup, service worker
src/background/service-worker.js   alarms, message routing, conversion requests, manual sync
src/background/rates.js            ECB fetch, XML parsing, rate cache, conversion through EUR
src/content/currency-detector.js   finds currency amounts in text
src/content/content.js             selection listener; asks the service worker to convert
src/content/tooltip.js             the conversion tooltip near the selection
src/content/page-scanner.js        Hybrid mode: walks the DOM, replaces prices, hover label
src/shared/constants.js            storage keys, default settings, ECB URL, limits, formatting helpers
src/popup/                         settings UI: mode, target currency, formats, per-site toggle, manual sync
scripts/*.test.js                  Node tests
scripts/pack_extension.py          builds the store zip
store-listing/                     Chrome Web Store text, screenshots and icons
```

## Rates

- The ECB daily XML (`ECB_API_URL` in `constants.js`) is fetched by a daily alarm and cached in `chrome.storage.local`.
- Cached rates older than 48 hours count as stale (`STALE_THRESHOLD_MS` in `rates.js`). Cached rates are still used when the network is down.
- ECB rates are based on EUR, so a non-EUR pair is `amount / fromRate * toRate`.
- Manual sync in the popup is limited to once per minute (`MANUAL_SYNC_COOLDOWN_MS` in `service-worker.js`), so the ECB endpoint is not hammered.

## Tests

Run all of them from the repo root: `for file in scripts/*.test.js; do node "$file"; done`. They need only Node, except `page-scanner-integration.test.js`, which runs `page-scanner.integration.html` in headless Chrome or Chromium.

`scripts/currency-detection-testbed.html` is a page for trying the detector by hand.

## Release

1. Update `manifest.json` (version), `CHANGELOG.md` (Keep a Changelog, SemVer) and `scripts/manifest.test.js`, which checks both.
2. `python scripts/pack_extension.py` writes `open-source-currency-converter.zip` with `manifest.json`, `LICENSE`, `README.md`, `PRIVACY.md`, `src/` and `icons/`.
3. The zips are attached to GitHub Releases.

## Gotchas

- No build step. Chrome loads the source folder. After any JS, HTML or CSS edit, click reload on the extension card in `chrome://extensions/`.
- The service worker runs `importScripts('../shared/constants.js', 'rates.js')`. `constants.js` must come first, and `rates.js` must stay next to the service worker in `src/background/`.
- The content scripts load `constants.js` first too, through the order in `manifest.json`.
- A currency missing from the ECB feed throws at conversion time, not at fetch time.
- `chrome.storage.sync` holds user settings; `chrome.storage.local` holds the rate cache. Do not mix them.
- The Node tests load the scripts in Node's `vm` module without a browser. If a script starts to need a new global, mock it in the test's `context` object.
