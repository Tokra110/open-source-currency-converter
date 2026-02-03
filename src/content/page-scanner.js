/**
 * Page Scanner: Scans page content and replaces currency amounts inline.
 * Hover over replaced values to see the original. Uses MutationObserver for dynamic content.
 */

/* eslint-disable no-var, no-unused-vars */
var PageScanner = (() => {
    let isEnabled = false;
    let settings = null;
    let rates = null;
    let replacementCount = 0;
    let observer = null;
    let isScanning = false;

    // Elements to skip when scanning
    const SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE',
        'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS',
    ]);

    // Class used to mark replaced elements
    const REPLACED_CLASS = 'cc-auto-replaced';
    const WRAPPER_TAG = 'span';

    /**
     * Initialize the page scanner.
     * @param {Object} config - Settings object with autoReplaceEnabled, autoReplaceLimit, etc.
     * @param {Object} ratesData - Exchange rates map
     */
    function init(config, ratesData) {
        settings = config;
        rates = ratesData;
        isEnabled = shouldBeEnabled(config);

        if (!isEnabled) {
            cleanup();
            return;
        }

        replacementCount = 0;
        scanPage();
        setupMutationObserver();
    }

    /**
     * Update settings without full reinit (e.g., when settings change mid-session).
     */
    function updateSettings(config, ratesData) {
        const wasEnabled = isEnabled;

        // Detect if we need to re-scan due to parameter changes
        // Use optional chaining/fallback to ensure we don't crash if settings is null (though unlikely after init)
        const oldSettings = settings || {};
        const paramsChanged = (
            oldSettings.targetCurrency !== config.targetCurrency ||
            oldSettings.defaultDollarCurrency !== config.defaultDollarCurrency ||
            oldSettings.numberFormat !== config.numberFormat
        );

        settings = config;
        rates = ratesData;
        isEnabled = shouldBeEnabled(config);

        if (!isEnabled && wasEnabled) {
            // Disabled: remove all changes
            restoreAll();
            cleanup();
        } else if (isEnabled && !wasEnabled) {
            // Enabled: start scanning
            replacementCount = 0;
            scanPage();
            setupMutationObserver();
        } else if (isEnabled && wasEnabled && paramsChanged) {
            // Updated: reset and re-scan with new settings
            restoreAll();
            replacementCount = 0;
            scanPage();
            // Observer remains connected but will use new settings
        }
    }

    function shouldBeEnabled(config) {
        // Must be globally enabled AND in auto mode
        if (!config.extensionEnabled || config.conversionMode !== 'auto') return false;

        // Check if current site is disabled
        if (config.disabledDomains && config.disabledDomains.includes(window.location.hostname)) {
            return false;
        }

        return true;
    }

    /**
     * Clean up observer and state.
     */
    function cleanup() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    /**
     * Scan the entire page for currency amounts.
     */
    function scanPage() {
        if (!isEnabled || !rates || isScanning) return;
        isScanning = true;

        try {
            scanNode(document.body);
        } finally {
            isScanning = false;
        }
    }

    /**
     * Scan a specific node and its descendants.
     * Handles both single text nodes and composite elements (prices split across children).
     * @param {Node} root - Root node to scan
     */
    function scanNode(root) {
        if (!root || replacementCount >= settings.autoReplaceLimit) return;

        // First, scan for composite price elements (e.g., Amazon's split price spans)
        scanCompositeElements(root);

        // Then scan individual text nodes for simple cases
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                    if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        // Collect nodes first to avoid modifying DOM during traversal
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
            textNodes.push(node);
        }

        // Process collected nodes
        for (const textNode of textNodes) {
            if (replacementCount >= settings.autoReplaceLimit) break;
            processTextNode(textNode);
        }
    }

    /**
     * Scan for composite price elements where the price is split across child elements.
     * Common on Amazon, eBay, etc. where "$29.99" becomes multiple spans.
     */
    function scanCompositeElements(root) {
        // Look for elements that might contain composite prices
        // These are typically small elements with few children containing a combined price
        const candidates = root.querySelectorAll('[class*="price"], [class*="Price"], [data-price], [itemprop="price"]');

        for (const el of candidates) {
            if (replacementCount >= settings.autoReplaceLimit) break;
            if (el.classList && el.classList.contains(REPLACED_CLASS)) continue;
            if (el.querySelector(`.${REPLACED_CLASS}`)) continue; // Already processed

            processCompositeElement(el);
        }
    }

    /**
     * Process an element that might contain a composite price.
     */
    function processCompositeElement(element) {
        // Get the combined text content
        const text = element.textContent.trim();
        if (!text || text.length > 50) return; // Too long to be just a price

        const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat);
        if (!detection) return;

        // Resolve ambiguous currencies
        let fromCurrency = detection.currencies[0];
        if (detection.currencies.length > 1 && detection.currencies.includes(settings.defaultDollarCurrency)) {
            fromCurrency = settings.defaultDollarCurrency;
        }

        if (fromCurrency === settings.targetCurrency) return;

        // Surgical Guard: If the detected match covers a small fraction of the element's text,
        // it's likely a container row. We'll skip replacing the whole row and let the
        // scanner find individual price elements inside it.
        const originalLength = detection.original.length;
        const totalLength = text.length;

        // If the price is less than 50% of the total text and the text is reasonably long,
        // it's probably too "noisy" to replace the whole container.
        if (totalLength > 15 && originalLength < totalLength * 0.5) return;

        const convertedAmount = convertCurrencyLocal(detection.amount, fromCurrency, settings.targetCurrency);
        if (convertedAmount === null) return;

        // Replace the entire element's content
        replaceCompositeElement(element, detection, fromCurrency, convertedAmount);
        replacementCount++;
    }

    /**
     * Replace a composite element's content with converted value.
     */
    function replaceCompositeElement(element, detection, fromCurrency, convertedAmount) {
        const fullOriginal = element.textContent.trim();
        const originalRect = element.getBoundingClientRect();
        const originalWidth = originalRect.width;

        // Add fade-out class and store original HTML
        const originalHTML = element.innerHTML;
        element.classList.add('cc-fading-out');

        element.addEventListener('animationend', () => {
            // Guard: element may have been removed during animation
            if (!element.parentNode) return;

            element.classList.remove('cc-fading-out');
            element.classList.add(REPLACED_CLASS);
            element.dataset.original = fullOriginal;
            element.dataset.originalHtml = originalHTML;
            element.dataset.fromCurrency = fromCurrency;
            element.title = `Original: ${fullOriginal}`;

            // Standard horizontal layout
            const symbol = CURRENCY_CODE_TO_SYMBOL[settings.targetCurrency] || settings.targetCurrency;
            element.innerHTML = `${formatAmount(convertedAmount, settings.targetCurrency)} ${symbol}`;

            // Adjust font size intelligently based on available space ("Leg Stretching")
            adjustSizeIntelligently(element, originalRect);
        }, { once: true });
    }

    /**
     * Check if a node should be skipped.
     */
    function shouldSkipNode(node) {
        let current = node.parentElement;
        while (current) {
            if (SKIP_TAGS.has(current.tagName)) return true;
            if (current.classList && current.classList.contains(REPLACED_CLASS)) return true;
            if (current.id === 'currency-converter-tooltip') return true;
            current = current.parentElement;
        }
        return false;
    }

    /**
     * Process a single text node, replacing any detected currencies.
     */
    function processTextNode(textNode) {
        const text = textNode.textContent;
        if (!text || text.length > LIMITS.MAX_SELECTION_LENGTH * 2) return;

        const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat);
        if (!detection) return;

        // Resolve ambiguous currencies using default dollar preference
        let fromCurrency = detection.currencies[0];
        if (detection.currencies.length > 1 && detection.currencies.includes(settings.defaultDollarCurrency)) {
            fromCurrency = settings.defaultDollarCurrency;
        }

        // Skip if same as target
        if (fromCurrency === settings.targetCurrency) return;

        // Convert
        const convertedAmount = convertCurrencyLocal(detection.amount, fromCurrency, settings.targetCurrency);
        if (convertedAmount === null) return;

        // Replace in DOM
        replaceInTextNode(textNode, detection, fromCurrency, convertedAmount);
        replacementCount++;
    }

    /**
     * Convert currency locally using cached rates (same logic as service worker).
     */
    function convertCurrencyLocal(amount, from, to) {
        if (!rates || !amount || from === to) return null;

        try {
            // ECB rates are EUR-based
            let amountInEur;
            if (from === 'EUR') {
                amountInEur = amount;
            } else if (rates[from]) {
                amountInEur = amount / rates[from];
            } else {
                return null;
            }

            let result;
            if (to === 'EUR') {
                result = amountInEur;
            } else if (rates[to]) {
                result = amountInEur * rates[to];
            } else {
                return null;
            }

            return result;
        } catch {
            return null;
        }
    }

    /**
     * Format a currency amount for display.
     */
    function formatAmount(amount, currencyCode) {
        if (typeof amount !== 'number' || !isFinite(amount)) return String(amount);

        let digits = 2;
        if (ZERO_DECIMAL_CURRENCIES && ZERO_DECIMAL_CURRENCIES.includes(currencyCode)) {
            digits = 0;
        }

        return amount.toLocaleString(undefined, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
        });
    }

    /**
     * Replace a currency match in a text node with a span showing converted value.
     * Also handles orphaned currency symbols adjacent to the match (e.g., "$69.99 CAD").
     * Animates: fade out original, then fade in converted.
     */
    function replaceInTextNode(textNode, detection, fromCurrency, convertedAmount) {
        const text = textNode.textContent;
        let matchStart = text.indexOf(detection.original);
        if (matchStart === -1) return;

        const parent = textNode.parentNode;
        if (!parent) return;

        // Check for orphaned currency symbols immediately before the match
        // This handles cases like "$69.99 CAD" where ISO match leaves "$" behind
        let actualMatchStart = matchStart;
        let fullOriginal = detection.original;

        if (matchStart > 0) {
            const beforeMatch = text.substring(0, matchStart).trimEnd();
            // Check if there's a currency symbol right before (possibly with whitespace)
            for (const symbol of Object.keys(CURRENCY_SYMBOLS)) {
                if (beforeMatch.endsWith(symbol)) {
                    // Include the symbol and any whitespace in the match
                    const symbolStart = beforeMatch.length - symbol.length;
                    const whitespace = text.substring(symbolStart + symbol.length, matchStart);
                    actualMatchStart = symbolStart;
                    fullOriginal = symbol + whitespace + detection.original;
                    break;
                }
            }
        }

        // Measure original rect using Range BEFORE any DOM changes
        let originalRect = null;
        try {
            const range = document.createRange();
            range.setStart(textNode, actualMatchStart);
            range.setEnd(textNode, actualMatchStart + fullOriginal.length);
            originalRect = range.getBoundingClientRect();
        } catch (e) {
            // Fallback if range fails (e.g. node detached)
        }


        // Split text around the full match (including any orphaned symbol)
        const before = text.substring(0, actualMatchStart);
        const after = text.substring(actualMatchStart + fullOriginal.length);

        // Create a temporary span to wrap the original text for fade-out
        const fadeOutSpan = document.createElement(WRAPPER_TAG);
        fadeOutSpan.className = 'cc-fading-out';
        fadeOutSpan.textContent = fullOriginal;

        // Build initial fragment with fade-out span
        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(fadeOutSpan);
        if (after) fragment.appendChild(document.createTextNode(after));

        // Replace original text node with fragment containing fade-out span
        parent.replaceChild(fragment, textNode);

        // After fade-out animation completes, swap to converted value with fade-in
        fadeOutSpan.addEventListener('animationend', () => {
            // Guard: element may have been removed during animation
            if (!fadeOutSpan.parentNode) return;

            const span = document.createElement(WRAPPER_TAG);
            span.className = REPLACED_CLASS;
            span.dataset.original = fullOriginal;
            span.dataset.fromCurrency = fromCurrency;
            span.title = `Original: ${fullOriginal}`;

            const symbol = CURRENCY_CODE_TO_SYMBOL[settings.targetCurrency] || settings.targetCurrency;
            span.textContent = `${formatAmount(convertedAmount, settings.targetCurrency)} ${symbol}`;

            fadeOutSpan.parentNode.replaceChild(span, fadeOutSpan);

            // Adjust font size intelligently based on available space ("Leg Stretching")
            adjustSizeIntelligently(span, originalRect);
        }, { once: true });
    }

    /**
     * Adjust font size intelligently based on available space ("Leg Stretching").
     * @param {HTMLElement} element - The replaced element.
     * @param {DOMRect} originalRect - The bounding box of the original text.
     */
    function adjustSizeIntelligently(element, originalRect) {
        if (!originalRect || originalRect.width <= 0) {
            return;
        }

        const parent = element.parentElement;
        if (!parent) {
            return;
        }

        // 1. Reset any previous scaling to measure natural size
        element.style.fontSize = '';
        element.style.whiteSpace = 'nowrap';

        const newRect = element.getBoundingClientRect();

        // 2. Find a suitable ancestor container (not a tight wrapper)
        // Walk up the DOM to find an element whose right edge is significantly larger than our text
        let containerRect = null;
        let ancestor = parent;
        for (let i = 0; i < 5 && ancestor; i++) {
            const rect = ancestor.getBoundingClientRect();
            // A container has space if its right edge is at least 20px more than our text's right
            if (rect.right > newRect.right + 20) {
                containerRect = rect;
                break;
            }
            ancestor = ancestor.parentElement;
        }

        // If we didn't find a spacious container, use the body or skip overflow check
        if (!containerRect) {
            containerRect = document.body.getBoundingClientRect();
        }

        // 3. Check for "Bad Layout Impact"
        // - Line Jump: If top of element shifted significantly down
        const lineJumped = newRect.top > originalRect.top + 5;

        // - Wrapping: If height increased significantly (shouldn't happen with nowrap but good guard)
        const wrapped = newRect.height > originalRect.height * 1.5;

        // - Container Overflow: If right edge exceeds the ACTUAL container (not tight wrapper)
        const overflows = newRect.right > containerRect.right - 2;

        // 4. Fallback if layout broke
        if (lineJumped || wrapped || overflows) {
            const ratio = originalRect.width / newRect.width;
            const computedStyle = window.getComputedStyle(element);
            const currentFontSize = parseFloat(computedStyle.fontSize) || 14;

            let newFontSize = currentFontSize * ratio;
            if (newFontSize < 8) newFontSize = 8;

            element.style.fontSize = `${newFontSize}px`;
        }
        // Else: Keep natural size! It "stretched its legs".
    }





    /**
     * Restore a single replaced element to its original text.
     */
    function restoreElement(element) {
        if (!element || !element.dataset.original) return;

        const textNode = document.createTextNode(element.dataset.original);
        element.parentNode.replaceChild(textNode, element);
        replacementCount = Math.max(0, replacementCount - 1);
    }

    /**
     * Restore all replaced elements on the page.
     */
    function restoreAll() {
        const elements = document.querySelectorAll(`.${REPLACED_CLASS}`);
        elements.forEach(restoreElement);
        replacementCount = 0;
    }

    /**
     * Set up MutationObserver to handle dynamic content.
     */
    function setupMutationObserver() {
        if (observer) return;

        let pendingNodes = [];
        let debounceTimer = null;

        observer = new MutationObserver((mutations) => {
            if (!isEnabled) return;
            if (replacementCount >= settings.autoReplaceLimit) return;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Skip nodes we've already processed
                            if (node.classList && node.classList.contains(REPLACED_CLASS)) continue;
                            if (node.classList && node.classList.contains('cc-fading-out')) continue;
                            pendingNodes.push(node);
                        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            pendingNodes.push(node);
                        }
                    }
                }
            }

            // Debounce processing to batch rapid DOM changes
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (isScanning || pendingNodes.length === 0) return;

                // Capture current settings at processing time to avoid stale closure
                const currentSettings = settings;
                const currentLimit = currentSettings?.autoReplaceLimit ?? 100;

                const nodesToProcess = pendingNodes.slice();
                pendingNodes = [];

                for (const node of nodesToProcess) {
                    if (replacementCount >= currentLimit) break;
                    if (!document.contains(node)) continue; // Node was removed

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        scanNode(node);
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        processTextNode(node);
                    }
                }
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    /**
     * Get current replacement count (for debugging/testing).
     */
    function getReplacementCount() {
        return replacementCount;
    }

    return {
        init,
        updateSettings,
        scanPage,
        restoreAll,
        cleanup,
        getReplacementCount,
    };
})();
