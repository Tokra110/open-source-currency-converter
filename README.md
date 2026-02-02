# Currency Converter - Chrome extension

A Manifest V3 Chrome extension that detects currency amounts in selected text and converts them to your preferred currency via the right-click context menu.

## Features

- Detects currency symbols ($, EUR, GBP, etc.) and ISO codes in selected text
- Smart context menu that only appears when a currency is detected
- Sub-menu for ambiguous symbols (e.g. $ could be USD, AUD, CAD)
- Daily exchange rates from the European Central Bank (free, no API key)
- Offline support with cached rates
- Supports US (1,000.50) and EU (1.000,50) number formats
- Configurable target currency, theme (light/dark), and more

## Installation (development)

1. Clone this repository
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select this project folder
5. The extension icon should appear in the toolbar

## Configuration

Click the extension icon to open settings:
- **Target currency**: Choose your preferred conversion currency
- **Default $ currency**: Set what bare `$` means (USD, AUD, CAD, etc.)
- **Number format**: Auto-detect, US, or EU
- **Theme**: Light, Dark, or System

## How it works

1. Select any text containing a currency amount on a webpage
2. Right-click to open the context menu
3. Click "Convert [amount]" (or pick from sub-menu if ambiguous)
4. A tooltip appears near the selection with the converted amount

## Rate source

Exchange rates are fetched daily from the [European Central Bank](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html). All rates are EUR-based; non-EUR pairs are cross-calculated.
