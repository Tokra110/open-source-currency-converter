// options.js

// Wait for DOM
document.addEventListener('DOMContentLoaded', restoreOptions);

// Inputs
const targetCurrencySelect = document.getElementById('targetCurrency');
const defaultDollarSelect = document.getElementById('defaultDollarCurrency');
const numberFormatSelect = document.getElementById('numberFormat');
const themeSelect = document.getElementById('theme');
const enabledCheckbox = document.getElementById('enabled');
const statusDiv = document.getElementById('status');

// Listen for changes
const inputs = [targetCurrencySelect, defaultDollarSelect, numberFormatSelect, themeSelect, enabledCheckbox];
inputs.forEach(input => {
    input.addEventListener('change', saveOptions);
});

/**
 * Populate currency dropdowns and restore settings from storage
 */
async function restoreOptions() {
    // Populate Target Currency Dropdown using CURRENCY_NAMES from constants.js
    if (typeof CURRENCY_NAMES !== 'undefined') {
        const currencies = Object.keys(CURRENCY_NAMES).sort();

        // Clear and rebuild
        targetCurrencySelect.innerHTML = '';

        currencies.forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = `${code} - ${CURRENCY_NAMES[code]}`;
            targetCurrencySelect.appendChild(option);
        });
    }

    // Fetch settings
    const result = await chrome.storage.sync.get('settings');
    const settings = result.settings || DEFAULT_SETTINGS;

    // Apply to inputs
    if (settings.targetCurrency) {
        targetCurrencySelect.value = settings.targetCurrency;
    }
    if (settings.defaultDollarCurrency) {
        defaultDollarSelect.value = settings.defaultDollarCurrency;
    }
    if (settings.numberFormat) {
        numberFormatSelect.value = settings.numberFormat;
    }
    if (settings.theme) {
        themeSelect.value = settings.theme;
    }
    if (typeof settings.enabled === 'boolean') {
        enabledCheckbox.checked = settings.enabled;
    } else {
        enabledCheckbox.checked = true;
    }
}

/**
 * Save settings to storage
 */
async function saveOptions() {
    const settings = {
        targetCurrency: targetCurrencySelect.value,
        defaultDollarCurrency: defaultDollarSelect.value,
        numberFormat: numberFormatSelect.value,
        theme: themeSelect.value,
        enabled: enabledCheckbox.checked
    };

    await chrome.storage.sync.set({ settings });

    // Show status
    showStatus('Settings saved');
}

let statusTimeout;
function showStatus(msg) {
    statusDiv.textContent = msg;
    statusDiv.classList.add('visible');

    if (statusTimeout) clearTimeout(statusTimeout);

    statusTimeout = setTimeout(() => {
        statusDiv.classList.remove('visible');
        setTimeout(() => {
            statusDiv.textContent = '';
        }, 300); // Wait for fade out
    }, 1500);
}
