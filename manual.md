# Open source currency converter manual

How the extension is built and why: file layout, key files and the full gotchas. The brief is `AGENTS.md`; the dated log is `session-notes.md`; open work is in `TODO.md`.

## Architecture

```
manifest.json                      -- MV3 manifest; declares permissions, content scripts, popup, service worker
src/background/service-worker.js   -- background: alarm scheduling, message routing, conversion dispatch
src/background/rates.js            -- ECB fetch, XML parsing, cache read/write, cross-rate conversion
src/content/currency-detector.js   -- detects currency amounts in text (both US and EU number formats)
src/content/content.js             -- selection listener; sends currency-detected messages to service worker
src/content/tooltip.js             -- shows conversion tooltip near selected text
src/content/page-scanner.js        -- full-page mode: walks DOM, replaces price text nodes, hover tooltip
src/shared/constants.js            -- shared constants (storage keys, defaults, ECB URL, limits)
src/popup/popup.html + popup.js    -- settings UI: target currency, mode toggle, per-site disable, manual sync
scripts/detector-corpus.test.js    -- node-based corpus tests for currency-detector.js
scripts/pack_extension.py          -- zips the extension for store upload
```

Two operation modes selected in the popup: Interactive (right-click on selection) and Full Page (auto-replaces all prices on load).

## Key files

- `src/background/rates.js` — ECB XML endpoint is `ECB_API_URL` from constants; rates cached in `chrome.storage.local`; stale threshold is 48 hours; converts via EUR as the base (cross-rate: `amount / fromRate * toRate`)
- `src/shared/constants.js` — single source of truth for storage keys and default settings
- `src/content/currency-detector.js` — the core regex/parsing logic; tested independently via `detector-corpus.test.js`

## Gotchas

- No build step. Chrome loads the source folder directly. After any JS/HTML/CSS edit, go to `chrome://extensions/` and click the reload button on the extension card.
- The service worker loads `rates.js` via `importScripts`. Both files must be co-located in `src/background/` and `constants.js` must be loaded first (it is, via `importScripts('../shared/constants.js', 'rates.js')`).
- ECB rates are EUR-based; all non-EUR conversions cross-calculate through EUR. If a currency is missing from the ECB feed it throws at conversion time, not at fetch time.
- `chrome.storage.sync` holds user settings; `chrome.storage.local` holds the rate cache. Do not mix them.
- Manual sync in the popup is rate-limited to once per minute to avoid hammering the ECB endpoint.
- The detector-corpus tests use Node's `vm` module to load the content scripts without a browser. If you add new globals that content scripts depend on, mock them in the test's `context` object.
