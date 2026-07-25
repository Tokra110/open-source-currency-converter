# Changelog

All notable changes to this project are recorded here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Kept converted prices in step with sites that recalculate them after the page has loaded, such as a checkout updating shipping once an address is entered.
- Fell back to the site's own price whenever a recalculated value can no longer be converted, so a stale converted amount is never left on screen.
- Cleared the hover label describing the original amount when a site replaces a row we had already converted.

## [1.3.0] - 2026-07-25

### Added

- Added Hybrid mode, combining automatic page conversion with selection tooltips.
- Added searchable target currencies, separate input and output formats, and clearer defaults for ambiguous symbols.
- Added support for embedded frames, open shadow roots, compact values, refunds, negative amounts, and Indian and Swiss grouping.
- Added a compact Settings view with disabled-site management and an option to disable animations.

### Changed

- Moved page scanning into small idle-time chunks and reduced repeated settings, rate, and DOM work.
- Applied per-site controls consistently to the top-level site and its embedded frames.
- Refined the popup into a shorter fixed-height layout with centered primary controls and scrollable settings.

### Fixed

- Prevented conversion inside editable, password, and payment controls.
- Improved currency detection when nearby context disambiguates a symbol or refund amount.
- Fixed scanning and updates inside connected shadow roots and embedded pages.

[Unreleased]: https://github.com/Tokra110/open-source-currency-converter/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/Tokra110/open-source-currency-converter/releases/tag/v1.3.0
