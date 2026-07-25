/* eslint-disable no-console */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync('src/shared/constants.js', 'utf8'), context);

assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('hun')),
  JSON.stringify(['HUF']),
);
assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('dollar')),
  JSON.stringify(['AUD', 'CAD', 'HKD', 'NZD', 'SGD', 'USD']),
);
assert.strictEqual(
  JSON.stringify(context.filterCurrencyCodes('EUR')),
  JSON.stringify(['EUR']),
);

const singleSearch = context.getCurrencySearchState('hun', 'USD');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(singleSearch)),
  {
    codes: ['HUF'],
    selectedCode: 'HUF',
    autoSelectedCode: 'HUF',
  },
);

const multipleSearch = context.getCurrencySearchState('dollar', 'EUR');
assert.strictEqual(multipleSearch.codes.length, 6);
assert.strictEqual(multipleSearch.selectedCode, '');
assert.strictEqual(multipleSearch.autoSelectedCode, null);

const popupSource = fs.readFileSync('src/popup/popup.html', 'utf8');
const contentSource = fs.readFileSync('src/content/content.js', 'utf8');

assert.ok(popupSource.includes('<span class="mode-title">Hybrid</span>'));
assert.ok(popupSource.includes('<span class="mode-desc">Scan + selection tooltips</span>'));
assert.ok(!popupSource.includes('Scan plus selection tooltips'));
assert.ok(popupSource.includes('<span class="mode-desc">Selection tooltips only</span>'));

assert.ok(!popupSource.includes('<h2>Operation Mode</h2>'));

assert.ok(!popupSource.includes('id="statusText"'));
assert.ok(popupSource.includes('id="settingsToggle"'));
assert.ok(popupSource.includes('id="primaryPanel"'));
assert.ok(popupSource.includes('id="settingsPanel"'));
assert.ok(popupSource.includes('id="disabledSitesList"'));
assert.ok(popupSource.includes('id="disabledSitesEmpty"'));
assert.ok(!popupSource.includes('conversion-settings'));
assert.ok(!popupSource.includes('<hr>'));

const settingsPanelMatch = popupSource.match(
  /<section id="settingsPanel"[\s\S]*?<\/section>/,
);
assert.ok(settingsPanelMatch, 'settings view must exist');
for (const id of [
  'defaultDollarCurrency',
  'defaultYenCurrency',
  'defaultKrCurrency',
  'numberFormat',
  'outputFormat',
  'disableAnimations',
]) {
  assert.ok(settingsPanelMatch[0].includes(`id="${id}"`), `${id} must be in settings`);
}
assert.ok(!settingsPanelMatch[0].includes('id="targetCurrency"'));
assert.ok(
  !settingsPanelMatch[0].includes('id="defaultFrCurrency"'),
  'single-choice Fr default must not be shown as a setting',
);
assert.strictEqual(
  (settingsPanelMatch[0].match(/class="settings-fields-grid"/g) || []).length,
  2,
  'recognition and number-format controls must use compact grids',
);

const popupCss = fs.readFileSync('src/popup/popup.css', 'utf8');
assert.ok(popupCss.includes('.header-controls {'));
assert.ok(popupCss.includes('.settings-toggle {'));
assert.ok(popupCss.includes('.disabled-sites-list {'));
assert.ok(!popupCss.includes('.conversion-settings {'));
assert.ok(popupCss.includes('height: 390px;'), 'both popup views must share one compact fixed height');
assert.ok(popupCss.includes('.panel-viewport {'), 'panels must share one clipped viewport');
assert.ok(popupCss.includes('.settings-fields-grid {'), 'settings controls must use a dense grid');
assert.ok(
  popupCss.includes('.settings-panel {\n    overflow-y: auto;'),
  'only the Settings panel must scroll vertically',
);
assert.ok(
  popupCss.includes('transition: opacity 160ms ease, transform 160ms ease'),
  'panel switch must use a short transition',
);
assert.ok(
  popupCss.includes(
    '#primaryPanel {\n    display: grid;\n    align-content: center;\n    gap: 14px;',
  ),
  'main controls must be vertically centered with intentional spacing',
);
assert.ok(
  popupCss.includes('#primaryPanel .section {\n    margin-bottom: 0;'),
  'centered main sections must not retain their old bottom margin',
);
assert.ok(popupCss.includes('main.settings-active #settingsPanel {'));

const popupScript = fs.readFileSync('src/popup/popup.js', 'utf8');
const searchInputHandler = popupScript.match(
  /currencySearch\.addEventListener\('input',[\s\S]*?\n    \}\);/,
);
assert.ok(searchInputHandler, 'currency search input handler must exist');
assert.ok(searchInputHandler[0].includes('const autoSelectedCode = populateCurrencyDropdown('));
assert.ok(searchInputHandler[0].includes("saveSetting('targetCurrency', selectedTargetCurrency)"));
assert.ok(popupScript.includes('function setActivePanel(showSettings)'));
assert.ok(popupScript.includes('function renderDisabledSites(domains)'));
assert.ok(popupScript.includes('async function saveDisabledDomains(domains)'));
assert.ok(
  popupScript.includes("saveSetting('disableAnimations', disableAnimations.checked)"),
  'animation preference must be saved with the other synced settings',
);
assert.ok(
  popupScript.includes("document.body.classList.toggle('animations-disabled'"),
  'popup must apply its no-animation class immediately',
);
assert.ok(
  popupScript.includes("setActivePanel(!mainContent.classList.contains('settings-active'))"),
  'gear click must toggle the active panel state',
);
assert.ok(
  popupScript.includes("mainContent.classList.toggle('settings-active', showSettings)"),
  'panel state must drive the slide transition',
);
assert.ok(
  !popupScript.includes("saveSetting('defaultFrCurrency'"),
  'popup must not save a setting with only one valid choice',
);
assert.ok(!popupScript.includes("getElementById('defaultFrCurrency')"));
assert.ok(popupSource.includes('class="settings-gear"'));
assert.ok(popupCss.includes('.settings-gear {'));
assert.ok(popupCss.includes('.popup-panel {'));

assert.ok(contentSource.includes('if (!settings.extensionEnabled) {'));
assert.ok(contentSource.includes('if (isSiteDisabled(settings)) {'));
assert.ok(
  !contentSource.includes("settings.conversionMode !== 'interactive'"),
  'selection tooltips must also work in Hybrid mode',
);

console.log('popup: all tests passed');
