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

    // ========================================
    // DEBUG LOGGING INFRASTRUCTURE
    // ========================================
    const DEBUG_MODE = false; // Set to false to disable logging
    const LOG_PREFIX = '[CC-PageScanner]';

    // Track element states for debugging
    const elementRegistry = new WeakMap();
    let operationId = 0;

    function debugLog(category, message, data = {}) {
        if (!DEBUG_MODE) return;
        const opId = ++operationId;
        const timestamp = performance.now().toFixed(2);
        console.log(`${LOG_PREFIX} [${timestamp}ms] [Op#${opId}] [${category}]`, message, data);
        return opId;
    }

    function debugWarn(category, message, data = {}) {
        if (!DEBUG_MODE) return;
        console.warn(`${LOG_PREFIX} [WARN] [${category}]`, message, data);
    }

    function debugError(category, message, error = null, data = {}) {
        console.error(`${LOG_PREFIX} [ERROR] [${category}]`, message, { error, ...data });
    }

    /**
     * Get detailed node info for debugging.
     * @param {Node} node - The node to inspect
     * @returns {Object} Debug info about the node
     */
    function getNodeDebugInfo(node) {
        if (!node) return { exists: false };

        const info = {
            exists: true,
            nodeType: node.nodeType,
            nodeName: node.nodeName,
            inDocument: document.contains(node),
            hasParent: !!node.parentNode,
        };

        if (node.nodeType === Node.ELEMENT_NODE) {
            info.tagName = node.tagName;
            info.className = node.className;
            info.id = node.id;
            info.innerHTML = node.innerHTML?.substring(0, 100);
            info.parentTagName = node.parentNode?.tagName;
            info.parentClassName = node.parentNode?.className;
            info.childCount = node.childNodes?.length;

            // Check if this looks like a React component
            const hasReactFiber = Object.keys(node).some(k => k.startsWith('__react'));
            info.hasReactFiber = hasReactFiber;

            // Get registered state if tracked
            if (elementRegistry.has(node)) {
                info.registeredState = elementRegistry.get(node);
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            info.textContent = node.textContent?.substring(0, 50);
            info.parentTagName = node.parentNode?.tagName;
            info.parentClassName = node.parentNode?.className;
        }

        return info;
    }

    /**
     * Safe DOM operation wrapper with detailed error logging.
     * @param {string} operation - Name of the operation
     * @param {Function} fn - The DOM operation to perform
     * @param {Object} context - Context info for logging
     * @returns {boolean} Success status
     */
    function safeDOMOperation(operation, fn, context = {}) {
        const opId = debugLog('DOM-OP', `Starting: ${operation}`, context);

        try {
            fn();
            debugLog('DOM-OP', `Completed: ${operation}`, { opId });
            return true;
        } catch (error) {
            debugError('DOM-OP', `Failed: ${operation}`, error, {
                opId,
                errorName: error.name,
                errorMessage: error.message,
                stack: error.stack,
                ...context,
            });

            // Additional diagnostics for removeChild errors
            if (error.message?.includes('removeChild')) {
                debugError('DOM-DIAG', 'removeChild failure diagnostics', null, {
                    parentInfo: context.parent ? getNodeDebugInfo(context.parent) : 'N/A',
                    childInfo: context.child ? getNodeDebugInfo(context.child) : 'N/A',
                    actualParent: context.child?.parentNode ? getNodeDebugInfo(context.child.parentNode) : 'N/A',
                    isChildOfParent: context.parent?.contains?.(context.child),
                });
            }

            return false;
        }
    }

    /**
     * Register an element for tracking state changes.
     */
    function registerElement(element, state) {
        if (!DEBUG_MODE) return;
        elementRegistry.set(element, {
            state,
            registeredAt: performance.now(),
            stack: new Error().stack,
        });
    }
    // ========================================

    /**
     * Initialize the page scanner.
     * @param {Object} config - Settings object with autoReplaceEnabled, autoReplaceLimit, etc.
     * @param {Object} ratesData - Exchange rates map
     */
    function init(config, ratesData) {
        debugLog('init', 'Initializing page scanner', {
            hostname: window.location.hostname,
            pathname: window.location.pathname,
            targetCurrency: config.targetCurrency,
            conversionMode: config.conversionMode,
            extensionEnabled: config.extensionEnabled,
            ratesCount: ratesData ? Object.keys(ratesData).length : 0,
        });

        settings = config;
        rates = ratesData;
        isEnabled = shouldBeEnabled(config);

        debugLog('init', `Scanner enabled: ${isEnabled}`);

        if (!isEnabled) {
            debugLog('init', 'Scanner disabled, cleaning up');
            cleanup();
            return;
        }

        replacementCount = 0;
        scanPage();
        setupMutationObserver();
        debugLog('init', 'Initialization complete');
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
        if (!isEnabled || !rates || isScanning) {
            debugLog('scanPage', 'Skipping scan', { isEnabled, hasRates: !!rates, isScanning });
            return;
        }

        debugLog('scanPage', 'Starting full page scan', {
            bodyChildren: document.body?.childElementCount,
            limit: settings?.autoReplaceLimit,
        });

        isScanning = true;
        const startTime = performance.now();

        try {
            scanNode(document.body);
        } finally {
            isScanning = false;
            const elapsed = (performance.now() - startTime).toFixed(2);
            debugLog('scanPage', 'Page scan complete', {
                elapsed: `${elapsed}ms`,
                replacementCount,
            });
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

        debugLog('scanCompositeElements', 'Found price candidates', {
            count: candidates.length,
            rootInfo: getNodeDebugInfo(root),
        });

        let processedCount = 0;
        let skippedCount = 0;

        // Track elements we'll process in this batch to skip their descendants
        // This prevents React conflicts by only modifying outermost containers
        const processedInBatch = new Set();

        for (const el of candidates) {
            if (replacementCount >= settings.autoReplaceLimit) {
                debugLog('scanCompositeElements', 'Reached limit', { processedCount, skippedCount });
                break;
            }
            if (el.classList && el.classList.contains(REPLACED_CLASS)) {
                skippedCount++;
                continue;
            }
            if (el.querySelector(`.${REPLACED_CLASS}`)) {
                skippedCount++;
                continue; // Already processed
            }

            // Skip if this element is nested inside an element we're already processing
            // This prevents React conflicts when we modify innerHTML of ancestor
            let isNestedInProcessed = false;
            for (const processed of processedInBatch) {
                if (processed.contains(el) && processed !== el) {
                    isNestedInProcessed = true;
                    debugLog('scanCompositeElements', 'Skipping nested element', {
                        skippedElement: el.className,
                        ancestorElement: processed.className,
                        reason: 'Ancestor already being processed - prevents React conflicts',
                    });
                    break;
                }
            }
            if (isNestedInProcessed) {
                skippedCount++;
                continue;
            }

            // Also check if any ancestor of this element is already marked for processing
            let ancestor = el.parentElement;
            while (ancestor && ancestor !== root) {
                if (processedInBatch.has(ancestor)) {
                    isNestedInProcessed = true;
                    debugLog('scanCompositeElements', 'Skipping nested element (ancestor check)', {
                        skippedElement: el.className,
                        ancestorElement: ancestor.className,
                    });
                    break;
                }
                ancestor = ancestor.parentElement;
            }
            if (isNestedInProcessed) {
                skippedCount++;
                continue;
            }

            // Mark this element as being processed before we actually process it
            processedInBatch.add(el);
            processCompositeElement(el);
            processedCount++;
        }

        debugLog('scanCompositeElements', 'Composite scan complete', {
            processedCount,
            skippedCount,
            currentReplacementCount: replacementCount,
        });
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
        const compositeOpId = debugLog('replaceCompositeElement', 'Starting composite replacement', {
            elementInfo: getNodeDebugInfo(element),
            detection: detection.original,
            fromCurrency,
            convertedAmount,
        });

        const fullOriginal = element.textContent.trim();
        const originalRect = element.getBoundingClientRect();
        const originalWidth = originalRect.width;

        // Add fade-out class and store original HTML
        const originalHTML = element.innerHTML;

        // Track element for debugging
        registerElement(element, 'composite-fading-out');

        element.classList.add('cc-fading-out');

        debugLog('replaceCompositeElement', 'Starting animation', {
            compositeOpId,
            originalHTML: originalHTML.substring(0, 100),
            originalWidth,
        });

        element.addEventListener('animationend', () => {
            debugLog('compositeAnimationend', 'Animation ended, starting content swap', {
                compositeOpId,
                elementInfo: getNodeDebugInfo(element),
                inDocument: document.contains(element),
                hasParent: !!element.parentNode,
            });

            // Guard: element may have been removed during animation
            if (!element.parentNode) {
                debugWarn('compositeAnimationend', 'Element has no parent, aborting', {
                    compositeOpId,
                    elementInfo: getNodeDebugInfo(element),
                    inDocument: document.contains(element),
                    possibleCause: 'React likely re-rendered this component during animation',
                });
                return;
            }

            // Additional check: is the element still in the document?
            if (!document.contains(element)) {
                debugWarn('compositeAnimationend', 'Element is no longer in document', {
                    compositeOpId,
                    elementInfo: getNodeDebugInfo(element),
                    parentInfo: getNodeDebugInfo(element.parentNode),
                    possibleCause: 'React removed the element tree during animation',
                });
                return;
            }

            element.classList.remove('cc-fading-out');
            element.classList.add(REPLACED_CLASS);
            element.dataset.original = fullOriginal;
            element.dataset.originalHtml = originalHTML;
            element.dataset.fromCurrency = fromCurrency;
            element.title = `Original: ${fullOriginal}`;

            // Standard horizontal layout
            const symbol = CURRENCY_CODE_TO_SYMBOL[settings.targetCurrency] || settings.targetCurrency;
            const newContent = `${formatAmount(convertedAmount, settings.targetCurrency)} ${symbol}`;

            debugLog('compositeAnimationend', 'About to set innerHTML', {
                compositeOpId,
                newContent,
                currentInnerHTML: element.innerHTML?.substring(0, 50),
            });

            // THIS IS A CRITICAL POINT - modifying innerHTML can conflict with React
            const setContentSuccess = safeDOMOperation(
                'innerHTML modification',
                () => { element.innerHTML = newContent; },
                {
                    element: element,
                    operation: 'composite-innerHTML-set',
                    newContent,
                    compositeOpId,
                }
            );

            if (!setContentSuccess) {
                debugError('compositeAnimationend', 'Failed to set innerHTML', null, { compositeOpId });
                return;
            }

            debugLog('compositeAnimationend', 'Content swap successful', {
                compositeOpId,
                newElementInfo: getNodeDebugInfo(element),
            });

            // Adjust font size intelligently based on available space ("Leg Stretching")
            adjustSizeIntelligently(element, originalRect);
        }, { once: true });

        debugLog('replaceCompositeElement', 'Composite replacement setup complete', { compositeOpId });
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
        if (!rates || !Number.isFinite(amount) || from === to) return null;

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
        const replaceOpId = debugLog('replaceInTextNode', 'Starting replacement', {
            textContent: textNode.textContent?.substring(0, 80),
            detection: detection.original,
            fromCurrency,
            convertedAmount,
            textNodeInfo: getNodeDebugInfo(textNode),
        });

        const text = textNode.textContent;
        let matchStart = text.indexOf(detection.original);
        if (matchStart === -1) {
            debugWarn('replaceInTextNode', 'Match not found in text', { text, original: detection.original });
            return;
        }

        const parent = textNode.parentNode;
        if (!parent) {
            debugWarn('replaceInTextNode', 'No parent node found', { textNodeInfo: getNodeDebugInfo(textNode) });
            return;
        }

        // Log parent chain for debugging React issues
        debugLog('replaceInTextNode', 'Parent node info', {
            parentInfo: getNodeDebugInfo(parent),
            grandparentInfo: getNodeDebugInfo(parent.parentNode),
            isTextNodeInDocument: document.contains(textNode),
            isParentInDocument: document.contains(parent),
        });

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
                    debugLog('replaceInTextNode', 'Found orphaned symbol', { symbol, fullOriginal });
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
            debugWarn('replaceInTextNode', 'Range measurement failed', { error: e.message });
        }


        // Split text around the full match (including any orphaned symbol)
        const before = text.substring(0, actualMatchStart);
        const after = text.substring(actualMatchStart + fullOriginal.length);

        // Create a temporary span to wrap the original text for fade-out
        const fadeOutSpan = document.createElement(WRAPPER_TAG);
        fadeOutSpan.className = 'cc-fading-out';
        fadeOutSpan.textContent = fullOriginal;

        // Track this element for debugging
        registerElement(fadeOutSpan, 'fadeOutSpan-created');

        // Build initial fragment with fade-out span
        const fragment = document.createDocumentFragment();
        if (before) fragment.appendChild(document.createTextNode(before));
        fragment.appendChild(fadeOutSpan);
        if (after) fragment.appendChild(document.createTextNode(after));

        // Replace original text node with fragment containing fade-out span
        // THIS IS A CRITICAL POINT WHERE REACT CONFLICTS CAN OCCUR
        const parentBeforeReplace = parent; // Capture for async callback
        const replaceSuccess = safeDOMOperation(
            'replaceChild (textNode -> fragment)',
            () => parent.replaceChild(fragment, textNode),
            {
                parent: parent,
                child: textNode,
                operation: 'initial-text-replacement',
                fullOriginal,
                replaceOpId,
            }
        );

        if (!replaceSuccess) {
            debugError('replaceInTextNode', 'Initial replacement failed, aborting', null, { replaceOpId });
            return;
        }

        debugLog('replaceInTextNode', 'Initial replacement successful, setting up animation listener', {
            fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
            replaceOpId,
        });

        // After fade-out animation completes, swap to converted value with fade-in
        fadeOutSpan.addEventListener('animationend', () => {
            debugLog('animationend', 'Animation ended, starting swap', {
                fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                inDocument: document.contains(fadeOutSpan),
                hasParent: !!fadeOutSpan.parentNode,
                replaceOpId,
            });

            // Guard: element may have been removed during animation
            if (!fadeOutSpan.parentNode) {
                debugWarn('animationend', 'fadeOutSpan has no parent, aborting swap', {
                    fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                    originalParentInfo: getNodeDebugInfo(parentBeforeReplace),
                    inDocument: document.contains(fadeOutSpan),
                    replaceOpId,
                    possibleCause: 'React likely re-rendered this component during animation',
                });
                return;
            }

            const currentParent = fadeOutSpan.parentNode;

            // Additional check: verify parent is still in document
            if (!document.contains(currentParent)) {
                debugWarn('animationend', 'Parent is no longer in document', {
                    parentInfo: getNodeDebugInfo(currentParent),
                    fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                    replaceOpId,
                    possibleCause: 'React removed the parent element during animation',
                });
                return;
            }

            const span = document.createElement(WRAPPER_TAG);
            span.className = REPLACED_CLASS;
            span.dataset.original = fullOriginal;
            span.dataset.fromCurrency = fromCurrency;
            span.title = `Original: ${fullOriginal}`;

            const symbol = CURRENCY_CODE_TO_SYMBOL[settings.targetCurrency] || settings.targetCurrency;
            span.textContent = `${formatAmount(convertedAmount, settings.targetCurrency)} ${symbol}`;

            // Track the new span
            registerElement(span, 'replacedSpan-created');

            // Double-check that fadeOutSpan is still a child of currentParent
            const isStillChild = Array.from(currentParent.childNodes).includes(fadeOutSpan);
            if (!isStillChild) {
                debugError('animationend', 'fadeOutSpan is not a child of its parentNode!', null, {
                    fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                    currentParentInfo: getNodeDebugInfo(currentParent),
                    actualParentInfo: getNodeDebugInfo(fadeOutSpan.parentNode),
                    parentChildren: Array.from(currentParent.childNodes).map(n => ({
                        type: n.nodeType,
                        text: n.textContent?.substring(0, 30),
                    })),
                    replaceOpId,
                    possibleCause: 'Race condition - DOM structure changed between checks',
                });
                return;
            }

            const swapSuccess = safeDOMOperation(
                'replaceChild (fadeOutSpan -> finalSpan)',
                () => currentParent.replaceChild(span, fadeOutSpan),
                {
                    parent: currentParent,
                    child: fadeOutSpan,
                    operation: 'animation-swap',
                    fullOriginal,
                    replaceOpId,
                }
            );

            if (swapSuccess) {
                debugLog('animationend', 'Swap successful', {
                    newSpanInfo: getNodeDebugInfo(span),
                    replaceOpId
                });
                // Adjust font size intelligently based on available space ("Leg Stretching")
                adjustSizeIntelligently(span, originalRect);
            }
        }, { once: true });

        debugLog('replaceInTextNode', 'Replacement setup complete', { replaceOpId });
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
        const restoreOpId = debugLog('restoreElement', 'Starting restore', {
            elementInfo: getNodeDebugInfo(element),
            original: element?.dataset?.original,
        });

        if (!element || !element.dataset.original) {
            debugWarn('restoreElement', 'Missing element or original data', { element: !!element });
            return;
        }

        if (!element.parentNode) {
            debugWarn('restoreElement', 'Element has no parent, cannot restore', {
                restoreOpId,
                elementInfo: getNodeDebugInfo(element),
                inDocument: document.contains(element),
            });
            return;
        }

        const textNode = document.createTextNode(element.dataset.original);

        const restoreSuccess = safeDOMOperation(
            'restoreElement replaceChild',
            () => element.parentNode.replaceChild(textNode, element),
            {
                parent: element.parentNode,
                child: element,
                operation: 'restore',
                original: element.dataset.original,
                restoreOpId,
            }
        );

        if (restoreSuccess) {
            replacementCount = Math.max(0, replacementCount - 1);
            debugLog('restoreElement', 'Restore successful', { restoreOpId });
        }
    }

    /**
     * Restore all replaced elements on the page.
     */
    function restoreAll() {
        debugLog('restoreAll', 'Starting restore of all replaced elements');
        const elements = document.querySelectorAll(`.${REPLACED_CLASS}`);
        debugLog('restoreAll', `Found ${elements.length} elements to restore`);
        elements.forEach(restoreElement);
        replacementCount = 0;
        debugLog('restoreAll', 'Restore all complete');
    }

    /**
     * Set up MutationObserver to handle dynamic content.
     */
    function setupMutationObserver() {
        if (observer) {
            debugLog('MutationObserver', 'Observer already exists, skipping setup');
            return;
        }

        debugLog('MutationObserver', 'Setting up MutationObserver');

        let pendingNodes = [];
        let debounceTimer = null;
        let mutationBatchId = 0;

        observer = new MutationObserver((mutations) => {
            if (!isEnabled) return;
            if (replacementCount >= settings.autoReplaceLimit) return;

            const batchId = ++mutationBatchId;
            let addedCount = 0;
            let removedCount = 0;

            // Track removed nodes - this might help identify React re-renders
            const removedNodes = [];

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // Track removed nodes for debugging
                    for (const node of mutation.removedNodes) {
                        removedCount++;
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if we modified this element
                            if (node.classList?.contains(REPLACED_CLASS) ||
                                node.classList?.contains('cc-fading-out')) {
                                removedNodes.push({
                                    type: 'replaced-element-removed',
                                    nodeInfo: getNodeDebugInfo(node),
                                    parentInfo: getNodeDebugInfo(mutation.target),
                                });
                            }
                            // Check if it contains replaced elements
                            const replacedInside = node.querySelectorAll?.(`.${REPLACED_CLASS}, .cc-fading-out`);
                            if (replacedInside?.length) {
                                removedNodes.push({
                                    type: 'container-with-replaced-removed',
                                    containedCount: replacedInside.length,
                                    nodeInfo: getNodeDebugInfo(node),
                                    parentInfo: getNodeDebugInfo(mutation.target),
                                });
                            }
                        }
                    }

                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Skip nodes we've already processed
                            if (node.classList && node.classList.contains(REPLACED_CLASS)) continue;
                            if (node.classList && node.classList.contains('cc-fading-out')) continue;
                            pendingNodes.push(node);
                            addedCount++;
                        } else if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
                            pendingNodes.push(node);
                            addedCount++;
                        }
                    }
                }
            }

            // Log if React appears to be removing our modified elements
            if (removedNodes.length > 0) {
                debugWarn('MutationObserver', 'Detected removal of modified elements - possible React re-render', {
                    batchId,
                    removedNodes,
                    totalRemovedCount: removedCount,
                    possibleCause: 'React virtual DOM reconciliation',
                });
            }

            // Only log significant batches to avoid console spam
            if (addedCount > 0 || removedCount > 5) {
                debugLog('MutationObserver', 'Mutation batch received', {
                    batchId,
                    mutationCount: mutations.length,
                    addedCount,
                    removedCount,
                    pendingTotal: pendingNodes.length,
                });
            }

            // Debounce processing to batch rapid DOM changes
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (isScanning || pendingNodes.length === 0) return;

                const processBatchId = batchId;
                debugLog('MutationObserver', 'Processing pending nodes', {
                    processBatchId,
                    pendingCount: pendingNodes.length,
                    replacementCount,
                    limit: settings?.autoReplaceLimit,
                });

                // Capture current settings at processing time to avoid stale closure
                const currentSettings = settings;
                const currentLimit = currentSettings?.autoReplaceLimit ?? 100;

                const nodesToProcess = pendingNodes.slice();
                pendingNodes = [];

                let processedCount = 0;
                let skippedCount = 0;

                for (const node of nodesToProcess) {
                    if (replacementCount >= currentLimit) {
                        debugLog('MutationObserver', 'Reached replacement limit, stopping', {
                            processBatchId,
                            processedCount,
                            skippedCount,
                        });
                        break;
                    }

                    // Check if node is still in document
                    if (!document.contains(node)) {
                        skippedCount++;
                        continue; // Node was removed
                    }

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        scanNode(node);
                        processedCount++;
                    } else if (node.nodeType === Node.TEXT_NODE) {
                        processTextNode(node);
                        processedCount++;
                    }
                }

                debugLog('MutationObserver', 'Batch processing complete', {
                    processBatchId,
                    processedCount,
                    skippedCount,
                    newReplacementCount: replacementCount,
                });
            }, 100);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        debugLog('MutationObserver', 'Observer now active');
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
