document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const extensionEnabled = document.getElementById('extensionEnabled');
    const settingsToggle = document.getElementById('settingsToggle');
    const mainContent = document.getElementById('mainContent');
    const primaryPanel = document.getElementById('primaryPanel');
    const settingsPanel = document.getElementById('settingsPanel');
    const modeAuto = document.getElementById('modeAuto');
    const modeInteractive = document.getElementById('modeInteractive');
    const targetCurrency = document.getElementById('targetCurrency');
    const currencySearch = document.getElementById('currencySearch');
    const defaultDollarCurrency = document.getElementById('defaultDollarCurrency');
    const defaultYenCurrency = document.getElementById('defaultYenCurrency');
    const defaultKrCurrency = document.getElementById('defaultKrCurrency');
    const numberFormat = document.getElementById('numberFormat');
    const outputFormat = document.getElementById('outputFormat');
    const disableAnimations = document.getElementById('disableAnimations');
    const lastSynced = document.getElementById('lastSynced');
    const syncBtn = document.getElementById('syncBtn');
    const msgLog = document.getElementById('msgLog');
    const disabledSitesList = document.getElementById('disabledSitesList');
    const disabledSitesEmpty = document.getElementById('disabledSitesEmpty');

    // Site Toggle Elements
    const siteToggleContainer = document.getElementById('siteToggleContainer');
    const siteHostnameEl = document.getElementById('siteHostname');
    const siteStatusDot = document.getElementById('siteStatusDot');
    const siteToggleBtn = document.getElementById('siteToggleBtn');
    let currentHostname = null;
    let currentSiteDisabled = false;

    // Load Settings
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
    const settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
    let selectedTargetCurrency = settings.targetCurrency;
    populateCurrencyDropdown(targetCurrency, '', selectedTargetCurrency);

    // Apply UI State
    extensionEnabled.checked = settings.extensionEnabled;
    updateGlobalState(settings.extensionEnabled);
    setActivePanel(false);
    renderDisabledSites(settings.disabledDomains);

    // Init Site Toggle
    initSiteToggle(settings);

    if (settings.conversionMode === 'interactive') {
        modeInteractive.checked = true;
    } else {
        modeAuto.checked = true;
    }

    targetCurrency.value = settings.targetCurrency;
    defaultDollarCurrency.value = settings.defaultDollarCurrency;
    defaultYenCurrency.value = settings.defaultYenCurrency;
    defaultKrCurrency.value = settings.defaultKrCurrency;
    numberFormat.value = settings.numberFormat;
    outputFormat.value = settings.outputFormat;
    disableAnimations.checked = settings.disableAnimations;
    applyAnimationsPreference(settings.disableAnimations);

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

    settingsToggle.addEventListener('click', () => {
        setActivePanel(!mainContent.classList.contains('settings-active'));
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
    targetCurrency.addEventListener('change', (e) => {
        if (!e.target.value) return;
        selectedTargetCurrency = e.target.value;
        saveSetting('targetCurrency', selectedTargetCurrency);
        currencySearch.value = '';
        populateCurrencyDropdown(targetCurrency, '', selectedTargetCurrency);
    });
    currencySearch.addEventListener('input', (e) => {
        const autoSelectedCode = populateCurrencyDropdown(
            targetCurrency,
            e.target.value,
            selectedTargetCurrency,
        );
        if (autoSelectedCode && autoSelectedCode !== selectedTargetCurrency) {
            selectedTargetCurrency = autoSelectedCode;
            saveSetting('targetCurrency', selectedTargetCurrency);
        }
    });
    defaultDollarCurrency.addEventListener('change', (e) => saveSetting('defaultDollarCurrency', e.target.value));
    defaultYenCurrency.addEventListener('change', (e) => saveSetting('defaultYenCurrency', e.target.value));
    defaultKrCurrency.addEventListener('change', (e) => saveSetting('defaultKrCurrency', e.target.value));
    numberFormat.addEventListener('change', (e) => saveSetting('numberFormat', e.target.value));
    outputFormat.addEventListener('change', (e) => saveSetting('outputFormat', e.target.value));
    disableAnimations.addEventListener('change', () => {
        applyAnimationsPreference(disableAnimations.checked);
        saveSetting('disableAnimations', disableAnimations.checked);
    });

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
        } else {
            mainContent.classList.add('disabled');
        }
    }

    function applyAnimationsPreference(disabled) {
        document.body.classList.toggle('animations-disabled', disabled);
    }

    function setActivePanel(showSettings) {
        mainContent.classList.toggle('settings-active', showSettings);
        primaryPanel.setAttribute('aria-hidden', String(showSettings));
        settingsPanel.setAttribute('aria-hidden', String(!showSettings));
        primaryPanel.inert = showSettings;
        settingsPanel.inert = !showSettings;
        if (showSettings) settingsPanel.scrollTop = 0;
        settingsToggle.classList.toggle('active', showSettings);
        settingsToggle.setAttribute('aria-pressed', String(showSettings));
        settingsToggle.setAttribute('aria-label', showSettings ? 'Close settings' : 'Open settings');
    }

    function renderDisabledSites(domains) {
        disabledSitesList.textContent = '';
        const sortedDomains = [...new Set(domains || [])].sort();
        disabledSitesEmpty.hidden = sortedDomains.length > 0;

        sortedDomains.forEach((domain) => {
            const item = document.createElement('li');
            item.className = 'disabled-site-row';

            const label = document.createElement('span');
            label.textContent = domain;

            const enableButton = document.createElement('button');
            enableButton.type = 'button';
            enableButton.className = 'disabled-site-enable';
            enableButton.textContent = 'Enable';
            enableButton.addEventListener('click', async () => {
                const freshData = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
                const freshSettings = { ...DEFAULT_SETTINGS, ...freshData[STORAGE_KEYS.SETTINGS] };
                await saveDisabledDomains(
                    (freshSettings.disabledDomains || []).filter((entry) => entry !== domain),
                );
            });

            item.append(label, enableButton);
            disabledSitesList.appendChild(item);
        });
    }

    async function saveDisabledDomains(domains) {
        const cleanedDomains = [...new Set(domains || [])].sort();
        const freshData = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
        const freshSettings = { ...DEFAULT_SETTINGS, ...freshData[STORAGE_KEYS.SETTINGS] };
        await chrome.storage.sync.set({
            [STORAGE_KEYS.SETTINGS]: {
                ...freshSettings,
                disabledDomains: cleanedDomains,
            },
        });

        renderDisabledSites(cleanedDomains);
        if (currentHostname) {
            currentSiteDisabled = cleanedDomains.includes(currentHostname);
            updateSiteUI();
        }
    }

    function populateCurrencyDropdown(select, query, selectedCode) {
        const state = getCurrencySearchState(query, selectedCode);
        const { codes, autoSelectedCode } = state;
        select.textContent = '';

        if (!state.selectedCode) {
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.disabled = true;
            placeholder.selected = true;
            placeholder.textContent = codes.length
                ? `Select from ${codes.length} matches`
                : 'No matching currencies';
            select.appendChild(placeholder);
        }

        codes.forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = `${code} - ${CURRENCY_NAMES[code]}`;
            select.appendChild(option);
        });

        if (state.selectedCode) {
            select.value = state.selectedCode;
        }
        return autoSelectedCode;
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

        try {
            currentHostname = new URL(tab.url).hostname;
        } catch (e) {
            return;
        }

        // Show container
        siteToggleContainer.style.display = 'flex';
        siteHostnameEl.textContent = currentHostname;
        siteHostnameEl.title = currentHostname; // Tooltip for long names

        currentSiteDisabled = (settings.disabledDomains || []).includes(currentHostname);
        updateSiteUI();

        // Click Handler
        siteToggleBtn.addEventListener('click', async () => {
            // Re-fetch latest settings to avoid race conditions
            const freshData = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
            const freshSettings = { ...DEFAULT_SETTINGS, ...freshData[STORAGE_KEYS.SETTINGS] };
            let currentList = freshSettings.disabledDomains || [];

            if (currentSiteDisabled) {
                // Was disabled, now enable -> remove from list
                currentList = currentList.filter(domain => domain !== currentHostname);
            } else {
                // Was enabled, now disable -> add to list
                if (!currentList.includes(currentHostname)) {
                    currentList.push(currentHostname);
                }
            }

            await saveDisabledDomains(currentList);
        });
    }

    function updateSiteUI() {
        if (currentSiteDisabled) {
            siteStatusDot.classList.add('disabled');
            siteToggleBtn.classList.add('disabled');
            siteToggleBtn.textContent = 'Disabled';
            siteToggleBtn.setAttribute('aria-label', `Enable extension on ${currentHostname}`);
        } else {
            siteStatusDot.classList.remove('disabled');
            siteToggleBtn.classList.remove('disabled');
            siteToggleBtn.textContent = 'Enabled';
            siteToggleBtn.setAttribute('aria-label', `Disable extension on ${currentHostname}`);
        }
    }
});
