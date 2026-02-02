// options.js

// Wait for DOM
document.addEventListener('DOMContentLoaded', restoreOptions);

// Inputs
const targetCurrencySelect = document.getElementById('targetCurrency');
const defaultDollarSelect = document.getElementById('defaultDollarCurrency');
const numberFormatSelect = document.getElementById('numberFormat');
const themeSelect = document.getElementById('theme');
const syncBtn = document.getElementById('syncBtn');
const lastSyncedSpan = document.getElementById('lastSynced');

const statusDiv = document.getElementById('status');

// Listen for changes
const inputs = [targetCurrencySelect, defaultDollarSelect, numberFormatSelect, themeSelect];
inputs.forEach(input => {
    input.addEventListener('change', saveOptions);
});

syncBtn.addEventListener('click', handleSyncClick);

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
    const result = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    const settings = result[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

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

    // Fetch Last Sync Time (from local storage, not sync)
    const localResult = await chrome.storage.local.get([STORAGE_KEYS.RATES_TIMESTAMP]);
    updateLastSyncedDisplay(localResult[STORAGE_KEYS.RATES_TIMESTAMP]);
}

/**
 * Handle "Sync Now" button click
 */
async function handleSyncClick() {
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';

    try {
        const response = await chrome.runtime.sendMessage({ type: 'manual-sync' });

        if (response && response.status === 'success') {
            showStatus('Rates updated successfully');
            updateLastSyncedDisplay(response.timestamp);
        } else if (response && response.status === 'rate-limited') {
            showStatus(`Please wait ${response.remainingSeconds}s before syncing again`);
        } else {
            showStatus(`Error: ${response?.message || 'Unknown error'}`);
        }
    } catch (err) {
        showStatus('Error communicating with background script');
        console.error(err);
    } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync Now';
    }
}

function updateLastSyncedDisplay(timestamp) {
    if (!timestamp) {
        lastSyncedSpan.textContent = 'Last synced: Never';
        return;
    }
    const date = new Date(timestamp);
    lastSyncedSpan.textContent = `Last synced: ${date.toLocaleString()}`;
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
        enabled: true
    };

    await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });

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
        }, TIMING.STATUS_FADE_MS);
    }, TIMING.STATUS_DISPLAY_MS);
}
