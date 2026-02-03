document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const extensionEnabled = document.getElementById('extensionEnabled');
    const statusText = document.getElementById('statusText');
    const mainContent = document.getElementById('mainContent');
    const modeAuto = document.getElementById('modeAuto');
    const modeInteractive = document.getElementById('modeInteractive');
    const targetCurrency = document.getElementById('targetCurrency');
    const defaultDollarCurrency = document.getElementById('defaultDollarCurrency');
    const numberFormat = document.getElementById('numberFormat');
    const lastSynced = document.getElementById('lastSynced');
    const syncBtn = document.getElementById('syncBtn');
    const msgLog = document.getElementById('msgLog');

    // Site Toggle Elements
    const siteToggleContainer = document.getElementById('siteToggleContainer');
    const siteHostnameEl = document.getElementById('siteHostname');
    const siteStatusDot = document.getElementById('siteStatusDot');
    const siteToggleBtn = document.getElementById('siteToggleBtn');

    // Populate Currencies
    populateCurrencyDropdown(targetCurrency);

    // Load Settings
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };

    // Apply UI State
    extensionEnabled.checked = settings.extensionEnabled;
    updateGlobalState(settings.extensionEnabled);

    // Init Site Toggle
    initSiteToggle(settings);

    if (settings.conversionMode === 'interactive') {
        modeInteractive.checked = true;
    } else {
        modeAuto.checked = true;
    }

    targetCurrency.value = settings.targetCurrency;
    defaultDollarCurrency.value = settings.defaultDollarCurrency;
    numberFormat.value = settings.numberFormat;

    // Load last sync time from local storage (where rates are cached)
    const ratesData = await chrome.storage.local.get(STORAGE_KEYS.RATES_TIMESTAMP);
    updateLastSyncedTime(ratesData[STORAGE_KEYS.RATES_TIMESTAMP]);

    // Event Listeners

    // 1. Global Toggle
    extensionEnabled.addEventListener('change', () => {
        const isEnabled = extensionEnabled.checked;
        updateGlobalState(isEnabled);
        saveSetting('extensionEnabled', isEnabled);
    });

    // 2. Mode Switch
    const modeInputs = document.getElementsByName('conversionMode');
    modeInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            if (e.target.checked) {
                saveSetting('conversionMode', e.target.value);
            }
        });
    });

    // 3. Dropdowns
    targetCurrency.addEventListener('change', (e) => saveSetting('targetCurrency', e.target.value));
    defaultDollarCurrency.addEventListener('change', (e) => saveSetting('defaultDollarCurrency', e.target.value));
    numberFormat.addEventListener('change', (e) => saveSetting('numberFormat', e.target.value));

    // 4. Sync Button
    syncBtn.addEventListener('click', async () => {
        syncBtn.textContent = 'Syncing...';
        syncBtn.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({ type: 'manual-sync' });
            if (response && response.status === 'success') {
                updateLastSyncedTime(response.timestamp);
                showMsg('Rates updated!');
                // Note: Timestamp is stored in local storage by service worker, not in sync settings
            } else if (response && response.status === 'rate-limited') {
                showMsg(`Try again in ${response.remainingSeconds}s`);
            } else {
                showMsg('Sync failed.');
            }
        } catch (err) {
            console.error(err);
            showMsg('Error syncing.');
        } finally {
            syncBtn.textContent = 'Sync Now';
            syncBtn.disabled = false;
        }
    });

    // Helpers - Debounced settings save to prevent race conditions
    const pendingChanges = {};
    let saveDebounceTimer = null;

    function saveSetting(key, value) {
        pendingChanges[key] = value;

        if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(async () => {
            const changesToSave = { ...pendingChanges };
            // Clear pending before async operation
            Object.keys(pendingChanges).forEach(k => delete pendingChanges[k]);

            const current = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
            const newSettings = { ...DEFAULT_SETTINGS, ...current[STORAGE_KEYS.SETTINGS], ...changesToSave };
            await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
        }, 100);
    }

    function updateGlobalState(isEnabled) {
        if (isEnabled) {
            mainContent.classList.remove('disabled');
            statusText.textContent = 'Extension is Active';
            statusText.style.color = 'var(--success-color)';
        } else {
            mainContent.classList.add('disabled');
            statusText.textContent = 'Extension is Disabled';
            statusText.style.color = 'var(--text-muted)';
        }
    }

    function populateCurrencyDropdown(select) {
        // CURRENCIES is likely undefined if not imported. 
        // We need to make sure constants.js exports it or it's globally available.
        // Assuming constants.js declares 'const CURRENCIES = ...' in global scope like the service worker uses.

        // Sorting alphabetically by code
        const sorted = Object.keys(CURRENCY_NAMES).sort();

        sorted.forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = `${code} - ${CURRENCY_NAMES[code]}`;
            select.appendChild(option);
        });
    }

    function updateLastSyncedTime(timestamp) {
        if (!timestamp) {
            lastSynced.textContent = 'Synced: Never';
            return;
        }
        const date = new Date(timestamp);
        lastSynced.textContent = `Synced: ${date.toLocaleTimeString()} ${date.toLocaleDateString()}`;
    }

    function showMsg(text) {
        msgLog.textContent = text;
        setTimeout(() => {
            msgLog.textContent = '';
        }, 3000);
    }

    async function initSiteToggle(settings) {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab || !tab.url || !tab.url.startsWith('http')) {
            return; // Not a web page
        }

        let hostname;
        try {
            hostname = new URL(tab.url).hostname;
        } catch (e) {
            return;
        }

        // Show container
        siteToggleContainer.style.display = 'flex';
        siteHostnameEl.textContent = hostname;
        siteHostnameEl.title = hostname; // Tooltip for long names

        let disabledDomains = settings.disabledDomains || [];
        let isSiteDisabled = disabledDomains.includes(hostname);

        updateSiteUI(isSiteDisabled);

        // Click Handler
        siteToggleBtn.addEventListener('click', async () => {
            // Re-fetch latest settings to avoid race conditions
            const freshData = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
            const freshSettings = { ...DEFAULT_SETTINGS, ...freshData[STORAGE_KEYS.SETTINGS] };
            let currentList = freshSettings.disabledDomains || [];

            if (isSiteDisabled) {
                // Was disabled, now enable -> remove from list
                currentList = currentList.filter(domain => domain !== hostname);
                isSiteDisabled = false;
            } else {
                // Was enabled, now disable -> add to list
                if (!currentList.includes(hostname)) {
                    currentList.push(hostname);
                }
                isSiteDisabled = true;
            }

            // Save
            await saveSetting('disabledDomains', currentList);
            updateSiteUI(isSiteDisabled);
        });

        function updateSiteUI(disabled) {
            if (disabled) {
                siteStatusDot.classList.add('disabled');
                siteToggleBtn.textContent = 'Enable';
                siteToggleBtn.style.color = 'var(--text-muted)';
            } else {
                siteStatusDot.classList.remove('disabled');
                siteToggleBtn.textContent = 'Disable';
                siteToggleBtn.style.color = 'var(--danger-color)';
            }
        }
    }
});
