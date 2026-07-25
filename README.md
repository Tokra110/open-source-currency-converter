# Open Source Currency Converter

A privacy-focused Manifest V3 Chrome extension that finds currency amounts on webpages and converts them using daily European Central Bank rates.

## Features

- Two conversion modes:
  - **Hybrid:** Converts prices across the page and also shows selection tooltips.
  - **Interactive:** Leaves the page unchanged and shows conversions only when you select a price.
- Detects currency symbols, ISO codes, and currency names.
- Handles US, European, Indian, and Swiss number grouping.
- Supports negative amounts, accounting-style refunds, and compact values such as `$2.5M`.
- Converts prices in embedded frames and open shadow roots.
- Lets you choose defaults for ambiguous symbols such as `$`, `¥`, and `kr`.
- Keeps input detection and converted-value display formats separate.
- Copies converted values from the selection tooltip.
- Disables the extension on individual sites.
- Offers an option to disable extension animations.
- Uses cached ECB rates when the network is unavailable.
- Contains no analytics, tracking, ads, or remote code.

## Installation for development

1. Clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this project folder.
5. Reload the extension from `chrome://extensions/` after changing source files.

There is no build step. Chrome loads the project source directly.

## Configuration

Select the extension icon to open the popup.

- **Extension toggle:** Enable or disable the extension everywhere.
- **On this site:** Enable or disable conversion for the current top-level site and all its frames.
- **Mode:** Choose Hybrid or Interactive behavior.
- **Convert to:** Search for and select the target currency.
- **Currency recognition:** Choose what ambiguous symbols mean.
- **Number formats:** Configure how source prices are read and converted values are displayed.
- **Disable animations:** Show page replacements and selection tooltips without motion.
- **Disabled sites:** Review and re-enable sites from one list.
- **Sync now:** Refresh ECB rates manually, subject to a one-minute rate limit.

## How it works

### Hybrid mode

The extension scans page text in small idle-time chunks and replaces recognized prices with converted values. Hover over a replacement to see its original amount. Selecting a price also opens the detailed conversion tooltip.

Dynamic page updates, embedded frames, and open shadow roots are scanned as they appear. Editable fields, password and payment forms, scripts, styles, and extension-owned elements are excluded.

### Interactive mode

Select text containing a currency amount. A tooltip appears near the selection with the converted amount. For an ambiguous symbol, the tooltip lets you switch between the possible source currencies. You can also copy the converted value.

## Rate source

Exchange rates come from the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). ECB rates use EUR as the base, so non-EUR pairs are calculated through EUR.

Rates are cached locally for offline use. User settings are stored with `chrome.storage.sync` and may be synchronized by Chrome when browser sync is enabled.

## Tests

Run the browser-independent regression suite with:

```bash
for file in scripts/*.test.js; do node "$file"; done
```

## Packaging

Create the Chrome Web Store archive with:

```bash
python scripts/pack_extension.py
```

The output is `open-source-currency-converter.zip`.

## Releases

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md). Published
versions and their Chrome Web Store archives are available from
[GitHub Releases](https://github.com/Tokra110/open-source-currency-converter/releases).

## License

This project is available under the [MIT License](LICENSE).
