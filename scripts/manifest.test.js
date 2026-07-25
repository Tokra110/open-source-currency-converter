/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const contentScript = manifest.content_scripts[0];
const license = fs.readFileSync('LICENSE', 'utf8');
const readme = fs.readFileSync('README.md', 'utf8');
const privacy = fs.readFileSync('PRIVACY.md', 'utf8');
assert.ok(fs.existsSync('CHANGELOG.md'), 'CHANGELOG.md must exist');
const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');

assert.strictEqual(manifest.version, '1.3.2');
assert.strictEqual(contentScript.all_frames, true);
assert.strictEqual(contentScript.match_about_blank, true);
assert.strictEqual(contentScript.match_origin_as_fallback, true);

assert.ok(license.startsWith('MIT License\n'));
assert.ok(license.includes('Copyright (c) 2026 Dávid Takács-Tolnai'));
assert.ok(license.includes('Permission is hereby granted, free of charge'));
assert.ok(!license.includes('GNU GENERAL PUBLIC LICENSE'));

assert.ok(changelog.includes('## [Unreleased]'));
assert.ok(changelog.includes('## [1.3.2] - 2026-07-25'));
assert.ok(changelog.includes('## [1.3.1] - 2026-07-25'));
assert.ok(changelog.includes('## [1.3.0] - 2026-07-25'));
assert.ok(changelog.includes('### Added'));
assert.ok(changelog.includes('### Changed'));
assert.ok(changelog.includes('### Fixed'));
assert.ok(
  changelog.includes(
    '[1.3.2]: https://github.com/Tokra110/open-source-currency-converter/compare/v1.3.1...v1.3.2',
  ),
);
assert.ok(
  changelog.includes(
    '[1.3.1]: https://github.com/Tokra110/open-source-currency-converter/compare/v1.3.0...v1.3.1',
  ),
);
assert.ok(
  changelog.includes(
    '[1.3.0]: https://github.com/Tokra110/open-source-currency-converter/releases/tag/v1.3.0',
  ),
);

assert.ok(readme.includes('## Releases'));
assert.ok(readme.includes('[CHANGELOG.md](CHANGELOG.md)'));
assert.ok(readme.includes('## License'));
assert.ok(readme.includes('[MIT License](LICENSE)'));
assert.ok(privacy.includes('**Last updated: July 25, 2026**'));

console.log('manifest: all tests passed');
