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
    const observers = new Map();
    const scannerCreatedNodes = new WeakSet();
    // Page-owned text nodes we detached while converting, mapped to what we
    // rendered in their place. A site that kept a reference to one of these
    // nodes updates it with `nodeValue = ...`, which produces no mutation in
    // the connected tree, so the observers below are the only way to see it.
    const originGroups = new WeakMap();
    const compositeOrigins = new WeakMap();
    const compositeRendered = new WeakMap();
    const originObservers = new Set();
    let activeOrigin = null;
    let scanWork = [];
    let scheduledScanWork = null;
    let scanStartedAt = 0;
    let contextFragmentCache = null;

    // Elements to skip when scanning
    const SKIP_TAGS = new Set([
        'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'PRE',
        'SELECT', 'OPTION', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
        'SVG', 'CANVAS',
    ]);

    // Class used to mark replaced elements
    const REPLACED_CLASS = 'cc-auto-replaced';
    const WRAPPER_TAG = 'span';
    const MAX_DETECTIONS_PER_TEXT_NODE = 25;
    const MAX_CONTEXT_ANCESTORS = 12;
    const MAX_CONTEXT_TEXT_LENGTH = 2000;
    const MAX_CONTEXT_DETECTIONS = 50;
    const MAX_SCAN_ITEMS_PER_CHUNK = 150;
    const MIN_SCAN_ITEMS_PER_CHUNK = 20;
    const SCAN_IDLE_TIMEOUT_MS = 250;
    const ANIMATION_FALLBACK_MS = 500;
    const MUTATION_DEBOUNCE_MS = 100;
    const MUTATION_MAX_WAIT_MS = 500;
    const COMPOSITE_SELECTOR = '[class*="price"], [class*="Price"], [data-price], [itemprop="price"]';
    const MAX_SPLIT_PRICE_ANCESTORS = 3;
    const MIN_SPLIT_PRICE_MATCH_RATIO = 0.2;
    const CURRENCY_FRAGMENT_TOKENS = new Set([
        ...Object.keys(CURRENCY_SYMBOLS),
        ...Object.keys(CURRENCY_NAMES),
    ].map(token => token.toLowerCase()));
    const CONTEXT_AMBIGUOUS_TOKENS = new Set([
        '$', 'dollar', 'dollars', 'buck', 'bucks', 'greenback', 'greenbacks',
        '¥', 'kr', 'fr',
    ]);
    const SHADOW_STYLE_ATTRIBUTE = 'data-cc-shadow-styles';
    const SHADOW_REPLACEMENT_STYLES = `
        @keyframes cc-fade-out {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(5px); }
        }
        @keyframes cc-fade-in {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .cc-fading-out {
            display: inline-block;
            animation: cc-fade-out 0.2s ease-in forwards;
        }
        .cc-auto-replaced {
            display: inline-block;
            animation: cc-fade-in 0.3s ease-out forwards;
        }
        .cc-auto-replaced.cc-no-animation {
            animation: none;
        }
    `;

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

    function createDebugData(factory, enabled = DEBUG_MODE) {
        return enabled ? factory() : undefined;
    }

    function isNodeConnected(node) {
        return !!node?.isConnected;
    }

    function shouldAnimate(config = settings) {
        return !config?.disableAnimations;
    }

    function onAnimationOrNow(element, callback, config = settings) {
        if (!shouldAnimate(config)) {
            callback();
            return;
        }

        let completed = false;
        let fallbackTimer = null;
        const complete = () => {
            if (completed) return;
            completed = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            element.removeEventListener?.('animationend', complete);
            callback();
        };

        element.addEventListener('animationend', complete, { once: true });
        fallbackTimer = setTimeout(complete, ANIMATION_FALLBACK_MS);
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
            inDocument: isNodeConnected(node),
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
     * @param {Function} contextFactory - Creates context info only when needed
     * @returns {boolean} Success status
     */
    function safeDOMOperation(operation, fn, contextFactory = () => ({})) {
        let context = createDebugData(contextFactory);
        const opId = debugLog('DOM-OP', `Starting: ${operation}`, context);

        try {
            fn();
            debugLog('DOM-OP', `Completed: ${operation}`, { opId });
            return true;
        } catch (error) {
            context = context || contextFactory();
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

    function drainScanWork(
        queue,
        processItem,
        deadline,
        maxItems = MAX_SCAN_ITEMS_PER_CHUNK,
    ) {
        let processed = 0;
        while (
            processed < queue.length &&
            processed < maxItems &&
            (
                processed < MIN_SCAN_ITEMS_PER_CHUNK ||
                !deadline?.timeRemaining ||
                deadline.timeRemaining() > 1
            )
        ) {
            processItem(queue[processed]);
            processed++;
        }
        if (processed > 0) queue.splice(0, processed);
        return queue.length;
    }

    function drainDomTraversal(
        traversal,
        visitNode,
        deadline,
        maxItems = MAX_SCAN_ITEMS_PER_CHUNK,
    ) {
        let processed = 0;

        while (
            processed < maxItems &&
            (
                processed < MIN_SCAN_ITEMS_PER_CHUNK ||
                !deadline?.timeRemaining ||
                deadline.timeRemaining() > 1
            )
        ) {
            let node = null;
            if (traversal.rootPending) {
                traversal.rootPending = false;
                node = traversal.root;
            } else {
                node = traversal.walker?.nextNode() || null;
            }

            if (!node) {
                return { processed, done: true };
            }

            visitNode(node);
            processed++;
        }

        return { processed, done: false };
    }

    function scheduleIdleWork(callback) {
        if (typeof requestIdleCallback === 'function') {
            return {
                type: 'idle',
                id: requestIdleCallback(callback, { timeout: SCAN_IDLE_TIMEOUT_MS }),
            };
        }

        return {
            type: 'timeout',
            id: setTimeout(() => callback({ timeRemaining: () => 8 }), 0),
        };
    }

    function cancelIdleWork(handle) {
        if (!handle) return;
        if (handle.type === 'idle' && typeof cancelIdleCallback === 'function') {
            cancelIdleCallback(handle.id);
            return;
        }
        clearTimeout(handle.id);
    }

    function compactPendingNodes(nodes) {
        const uniqueNodes = Array.from(new Set(nodes));
        const queuedNodes = new Set(uniqueNodes);

        return uniqueNodes.filter((node) => {
            let ancestor = node?.parentNode || null;
            while (ancestor) {
                if (queuedNodes.has(ancestor)) return false;
                ancestor = ancestor.parentNode || ancestor.getRootNode?.().host || null;
            }
            return true;
        });
    }
    // ========================================

    /**
     * Initialize the page scanner.
     * @param {Object} config - Settings object with autoReplaceEnabled, autoReplaceLimit, etc.
     * @param {Object} ratesData - Exchange rates map
     */
    function init(config, ratesData) {
        debugLog('init', 'Initializing page scanner', createDebugData(() => ({
            hostname: getSiteHostname(window.location),
            pathname: window.location.pathname,
            targetCurrency: config.targetCurrency,
            conversionMode: config.conversionMode,
            extensionEnabled: config.extensionEnabled,
            ratesCount: ratesData ? Object.keys(ratesData).length : 0,
        })));

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
            oldSettings.defaultYenCurrency !== config.defaultYenCurrency ||
            oldSettings.defaultKrCurrency !== config.defaultKrCurrency ||
            oldSettings.defaultFrCurrency !== config.defaultFrCurrency ||
            oldSettings.numberFormat !== config.numberFormat ||
            oldSettings.outputFormat !== config.outputFormat ||
            oldSettings.disableAnimations !== config.disableAnimations
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
            setupMutationObserver();
        }
    }

    function shouldBeEnabled(config) {
        // Must be globally enabled AND in auto mode
        if (!config.extensionEnabled || config.conversionMode !== 'auto') return false;

        if (isSensitiveEmbeddedFrame(document, window)) return false;

        // Check if current site is disabled
        if (config.disabledDomains && config.disabledDomains.includes(getSiteHostname(window.location))) {
            return false;
        }

        return true;
    }

    function isSensitiveEmbeddedFrame(frameDocument, frameWindow) {
        if (!frameWindow || frameWindow.top === frameWindow.self) return false;

        const sensitiveFieldSelector = [
            'input[type="password"]',
            'input[autocomplete="current-password"]',
            'input[autocomplete="new-password"]',
            'input[autocomplete^="cc-"]',
            'input[autocomplete="one-time-code"]',
        ].join(', ');

        try {
            return !!frameDocument?.querySelector(sensitiveFieldSelector);
        } catch {
            return true;
        }
    }

    /**
     * Clean up observer and state.
     */
    function cleanup() {
        cancelIdleWork(scheduledScanWork);
        scheduledScanWork = null;
        scanWork = [];
        contextFragmentCache = null;
        disconnectOriginObservers();
        for (const state of observers.values()) {
            state.observer.disconnect();
        }
        observers.clear();
    }

    /**
     * Scan the entire page for currency amounts.
     */
    function scanPage() {
        if (!isEnabled || !rates) {
            debugLog('scanPage', 'Skipping scan', { isEnabled, hasRates: !!rates });
            return;
        }

        debugLog('scanPage', 'Starting full page scan', createDebugData(() => ({
            bodyChildren: document.body?.childElementCount,
            limit: settings?.autoReplaceLimit,
        })));

        cancelIdleWork(scheduledScanWork);
        scheduledScanWork = null;
        scanWork = [];
        scanStartedAt = DEBUG_MODE ? performance.now() : 0;
        scanNode(document.body);
    }

    /**
     * Scan a specific node and its descendants.
     * Handles both single text nodes and composite elements (prices split across children).
     * @param {Node} root - Root node to scan
     */
    function scanNode(root) {
        if (!root || replacementCount >= settings.autoReplaceLimit) return;

        const walker = root.nodeType === Node.TEXT_NODE
            ? null
            : document.createTreeWalker(
                root,
                NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
            );
        scanWork.push({
            root,
            rootPending: true,
            walker,
            candidates: [],
            candidateSet: new Set(),
            phase: 'discover',
        });
        scheduleScanQueue();
    }

    function queueScanRoot(root) {
        scanNode(root);
    }

    function scheduleScanQueue() {
        if (scheduledScanWork || scanWork.length === 0 || !isEnabled) return;
        scheduledScanWork = scheduleIdleWork(processScanQueue);
    }

    function queueScanCandidate(traversal, node) {
        if (!node || traversal.candidateSet.has(node)) return;
        traversal.candidateSet.add(node);
        traversal.candidates.push(node);
    }

    function isCurrencyFragment(text) {
        return CURRENCY_FRAGMENT_TOKENS.has(text.trim().toLowerCase());
    }

    function isCompactSplitPriceText(text, detection) {
        return (
            !!detection &&
            text.length <= 50 &&
            detection.original.length / text.length >= MIN_SPLIT_PRICE_MATCH_RATIO
        );
    }

    function findSplitPriceCandidate(textNode) {
        if (!isCurrencyFragment(textNode.textContent)) return null;

        let bestCandidate = null;
        let ancestor = textNode.parentElement;

        for (
            let depth = 0;
            depth < MAX_SPLIT_PRICE_ANCESTORS && ancestor;
            depth++
        ) {
            const text = ancestor.textContent.trim();
            if (text.length > 50) break;

            if (ancestor.childElementCount > 0) {
                const detection = detectCompositeCurrency(text);
                if (
                    isCompactSplitPriceText(text, detection) &&
                    (
                        !bestCandidate ||
                        detection.original.length > bestCandidate.detection.original.length
                    )
                ) {
                    bestCandidate = { element: ancestor, detection };
                }
            }

            ancestor = ancestor.parentElement || ancestor.getRootNode?.().host || null;
        }

        return bestCandidate?.element || null;
    }

    function collectDiscoveredNode(traversal, node) {
        if (
            !isEnabled ||
            replacementCount >= settings.autoReplaceLimit ||
            node?.isConnected === false
        ) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim() && !shouldSkipNode(node)) {
                queueScanCandidate(traversal, node);
                queueScanCandidate(traversal, findSplitPriceCandidate(node));
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(COMPOSITE_SELECTOR)) {
            queueScanCandidate(traversal, node);
        }

        if (node.shadowRoot) {
            ensureShadowStyles(node.shadowRoot);
            scanNode(node.shadowRoot);
            setupMutationObserver(node.shadowRoot);
        }
    }

    function processScanCandidate(node) {
        if (
            !isEnabled ||
            replacementCount >= settings.autoReplaceLimit ||
            node?.isConnected === false
        ) {
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            processTextNode(node);
            return;
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            processCompositeElement(node);
        }
    }

    function processScanQueue(deadline) {
        scheduledScanWork = null;
        contextFragmentCache = new WeakMap();
        let processed = 0;

        while (
            scanWork.length > 0 &&
            processed < MAX_SCAN_ITEMS_PER_CHUNK &&
            (
                processed < MIN_SCAN_ITEMS_PER_CHUNK ||
                !deadline?.timeRemaining ||
                deadline.timeRemaining() > 1
            )
        ) {
            const remainingLimit = MAX_SCAN_ITEMS_PER_CHUNK - processed;
            const currentWork = scanWork[0];

            if (currentWork.phase === 'discover') {
                const result = drainDomTraversal(
                    currentWork,
                    node => collectDiscoveredNode(currentWork, node),
                    deadline,
                    remainingLimit,
                );
                processed += result.processed;

                if (!result.done) break;

                currentWork.phase = 'process';
                currentWork.walker = null;
            }

            const candidatesBefore = currentWork.candidates.length;
            const candidateLimit = MAX_SCAN_ITEMS_PER_CHUNK - processed;
            drainScanWork(
                currentWork.candidates,
                processScanCandidate,
                deadline,
                candidateLimit,
            );
            processed += candidatesBefore - currentWork.candidates.length;

            if (currentWork.candidates.length === 0) {
                scanWork.shift();
                continue;
            }
            break;
        }

        contextFragmentCache = null;

        if (!isEnabled || replacementCount >= settings.autoReplaceLimit) {
            scanWork = [];
            if (replacementCount >= settings.autoReplaceLimit) {
                for (const state of observers.values()) {
                    state.observer.disconnect();
                    state.active = false;
                }
            }
            return;
        }

        if (scanWork.length > 0) {
            scheduleScanQueue();
            return;
        }

        if (scanStartedAt) {
            debugLog('scanPage', 'Page scan complete', createDebugData(() => ({
                elapsed: `${(performance.now() - scanStartedAt).toFixed(2)}ms`,
                replacementCount,
            })));
            scanStartedAt = 0;
        }
    }

    function collectOpenShadowRoots(root) {
        if (!root?.querySelectorAll) return [];

        const shadowRoots = [];
        if (root.shadowRoot) shadowRoots.push(root.shadowRoot);
        for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) shadowRoots.push(element.shadowRoot);
        }
        return shadowRoots;
    }

    function ensureShadowStyles(shadowRoot) {
        if (shadowRoot.querySelector(`style[${SHADOW_STYLE_ATTRIBUTE}]`)) return;

        const style = document.createElement('style');
        style.setAttribute(SHADOW_STYLE_ATTRIBUTE, '');
        style.textContent = SHADOW_REPLACEMENT_STYLES;
        shadowRoot.prepend(style);
    }

    function scanOpenShadowRoots(root) {
        for (const shadowRoot of collectOpenShadowRoots(root)) {
            ensureShadowStyles(shadowRoot);
            scanNode(shadowRoot);
            setupMutationObserver(shadowRoot);
        }
    }

    /**
     * Scan for composite price elements where the price is split across child elements.
     * Common on Amazon, eBay, etc. where "$29.99" becomes multiple spans.
     */
    function collectCompositeElements(root) {
        if (!root?.querySelectorAll) return [];

        // Look for elements that might contain composite prices
        // These are typically small elements with few children containing a combined price
        const candidates = root.querySelectorAll('[class*="price"], [class*="Price"], [data-price], [itemprop="price"]');

        debugLog('scanCompositeElements', 'Found price candidates', createDebugData(() => ({
            count: candidates.length,
            rootInfo: getNodeDebugInfo(root),
        })));

        let skippedCount = 0;
        const elementsToProcess = [];

        // Track elements we'll process in this batch to skip their descendants
        // This prevents React conflicts by only modifying outermost containers
        const processedInBatch = new Set();

        for (const el of candidates) {
            if (replacementCount >= settings.autoReplaceLimit) {
                debugLog('scanCompositeElements', 'Reached limit', {
                    processedCount: elementsToProcess.length,
                    skippedCount,
                });
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
            elementsToProcess.push(el);
        }

        debugLog('scanCompositeElements', 'Composite scan complete', {
            processedCount: elementsToProcess.length,
            skippedCount,
            currentReplacementCount: replacementCount,
        });
        return elementsToProcess;
    }

    /**
     * Process an element that might contain a composite price.
     */
    function detectCompositeCurrency(text) {
        if (!text || text.length > 50) return null;

        return CurrencyDetector.detectCurrency(text, settings.numberFormat, {
            maxLength: 50,
            startIndex: 0,
        });
    }

    function isFocusedPriceText(text, detection) {
        return !(
            text.length > 15 &&
            detection.original.length < text.length * 0.5
        );
    }

    function findCompositeDetection(element) {
        const text = element.textContent.trim();
        const detection = detectCompositeCurrency(text);
        if (detection && isFocusedPriceText(text, detection)) {
            return { text, detection };
        }

        // Some storefronts render the visible price in an aria-hidden wrapper
        // and add a second screen-reader-only copy. Read the rendered wrapper,
        // but only let its nearest price-like ancestor own the replacement.
        for (const renderedPrice of element.querySelectorAll('[aria-hidden="true"]')) {
            const rect = renderedPrice.getBoundingClientRect();
            if (rect.width <= 0 && rect.height <= 0) continue;
            if (renderedPrice.closest(COMPOSITE_SELECTOR) !== element) continue;

            const renderedText = renderedPrice.textContent.trim();
            const renderedDetection = detectCompositeCurrency(renderedText);
            if (
                renderedDetection &&
                isFocusedPriceText(renderedText, renderedDetection)
            ) {
                return {
                    text: renderedText,
                    detection: renderedDetection,
                };
            }
        }

        return null;
    }

    function processCompositeElement(element) {
        if (shouldSkipNode(element)) return;

        const compositeDetection = findCompositeDetection(element);
        if (!compositeDetection) return;

        const { text, detection } = compositeDetection;

        const contextResult = detection.currencies.length > 1
            ? findScopedCurrencyContext(
                element,
                detection,
                settings.numberFormat,
                collectContextTextFragments,
                contextFragmentCache,
            )
            : null;
        const fromCurrency = resolveDetectedCurrency(detection, settings, contextResult);
        if (!fromCurrency) return;

        if (fromCurrency === settings.targetCurrency) return;

        const convertedAmount = convertCurrencyLocal(detection.amount, fromCurrency, settings.targetCurrency);
        if (convertedAmount === null) return;

        // Replace the entire element's content
        replaceCompositeElement(
            element,
            text,
            detection,
            fromCurrency,
            convertedAmount,
        );
        replacementCount++;
    }

    /**
     * Replace a composite element's content with converted value.
     */
    function replaceCompositeElement(
        element,
        compositeText,
        detection,
        fromCurrency,
        convertedAmount,
    ) {
        const compositeOpId = debugLog('replaceCompositeElement', 'Starting composite replacement', createDebugData(() => ({
            elementInfo: getNodeDebugInfo(element),
            detection: detection.original,
            fromCurrency,
            convertedAmount,
        })));

        const fullOriginal = element.textContent.trim();
        const originalRect = element.getBoundingClientRect();
        const originalWidth = originalRect.width;

        // Add fade-out class and store original HTML
        const originalHTML = element.innerHTML;

        // Track element for debugging
        registerElement(element, 'composite-fading-out');

        if (shouldAnimate()) {
            element.classList.add('cc-fading-out');
        }

        debugLog('replaceCompositeElement', 'Starting animation', createDebugData(() => ({
            compositeOpId,
            originalHTML: originalHTML.substring(0, 100),
            originalWidth,
        })));

        onAnimationOrNow(element, () => {
            debugLog('compositeAnimationend', 'Animation ended, starting content swap', createDebugData(() => ({
                compositeOpId,
                elementInfo: getNodeDebugInfo(element),
                inDocument: isNodeConnected(element),
                hasParent: !!element.parentNode,
            })));

            // Guard: element may have been removed during animation
            if (!element.parentNode) {
                debugWarn('compositeAnimationend', 'Element has no parent, aborting', {
                    compositeOpId,
                    elementInfo: getNodeDebugInfo(element),
                    inDocument: isNodeConnected(element),
                    possibleCause: 'React likely re-rendered this component during animation',
                });
                return;
            }

            // Additional check: is the element still in the document?
            if (!isNodeConnected(element)) {
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
            if (!shouldAnimate()) {
                element.classList.add('cc-no-animation');
            }
            element.dataset.original = fullOriginal;
            element.dataset.originalHtml = originalHTML;
            element.dataset.fromCurrency = fromCurrency;
            element.title = formatOriginalTitle(fullOriginal, fromCurrency);

            const replacement = formatReplacement(
                convertedAmount,
                settings.targetCurrency,
                detection.negativeStyle,
                detection.compact,
            );
            const newContent = [
                compositeText.slice(0, detection.start),
                replacement,
                compositeText.slice(detection.end),
            ].join('');

            debugLog('compositeAnimationend', 'About to set text content', createDebugData(() => ({
                compositeOpId,
                newContent,
                currentInnerHTML: element.innerHTML?.substring(0, 50),
            })));

            // Capture the site's own text nodes before textContent drops them.
            const retainedTextNodes = [];
            const retainWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            let retainedNode;
            while ((retainedNode = retainWalker.nextNode())) {
                retainedTextNodes.push(retainedNode);
            }

            const setContentSuccess = safeDOMOperation(
                'textContent modification',
                () => { element.textContent = newContent; },
                () => ({
                    element: element,
                    operation: 'composite-textContent-set',
                    newContent,
                    compositeOpId,
                }),
            );

            if (!setContentSuccess) {
                debugError('compositeAnimationend', 'Failed to set innerHTML', null, { compositeOpId });
                return;
            }

            compositeRendered.set(element, newContent);
            watchCompositeOrigins(element, retainedTextNodes);

            debugLog('compositeAnimationend', 'Content swap successful', createDebugData(() => ({
                compositeOpId,
                newElementInfo: getNodeDebugInfo(element),
            })));

            // Adjust font size intelligently based on available space ("Leg Stretching")
            adjustSizeIntelligently(element, originalRect);
        });

        debugLog('replaceCompositeElement', 'Composite replacement setup complete', { compositeOpId });
    }

    /**
     * Check if a node should be skipped.
     */
    function shouldSkipNode(node) {
        let current = node.tagName ? node : node.parentElement;
        while (current) {
            if (SKIP_TAGS.has(current.tagName)) return true;
            if (current.isContentEditable) return true;
            if (
                current.classList &&
                (
                    current.classList.contains(REPLACED_CLASS) ||
                    current.classList.contains('cc-fading-out')
                )
            ) {
                return true;
            }
            if (current.id === 'currency-converter-tooltip') return true;
            current = current.parentElement || current.getRootNode?.().host || null;
        }
        return false;
    }

    function isExtensionOwnedNode(node) {
        if (node && scannerCreatedNodes.has(node)) return true;
        let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        while (current) {
            if (
                current.classList?.contains(REPLACED_CLASS) ||
                current.classList?.contains('cc-fading-out') ||
                current.id === 'currency-converter-tooltip'
            ) {
                return true;
            }
            current = current.parentElement || current.getRootNode?.().host || null;
        }
        return false;
    }

    function noCurrencyContext() {
        return { status: 'none', currency: null };
    }

    /**
     * Find one explicit currency in text surrounding an ambiguous price.
     * Text fragments are joined with spaces so codes and amounts split across
     * sibling elements can still be read together.
     */
    function analyzeCurrencyContext(fragments, detection, numberFormat = 'auto') {
        if (
            !Array.isArray(fragments) ||
            !detection ||
            !Array.isArray(detection.currencies) ||
            detection.currencies.length < 2
        ) {
            return noCurrencyContext();
        }

        const text = fragments
            .map(fragment => String(fragment || '').trim())
            .filter(Boolean)
            .join(' ');
        if (!text || text.length > MAX_CONTEXT_TEXT_LENGTH) return noCurrencyContext();

        const possibleCurrencies = new Set(detection.currencies);
        const explicitCurrencies = new Set();
        let startIndex = 0;
        let detectionsProcessed = 0;

        for (const fragment of fragments) {
            const standaloneCode = String(fragment || '').trim().toUpperCase();
            if (possibleCurrencies.has(standaloneCode)) {
                explicitCurrencies.add(standaloneCode);
                if (explicitCurrencies.size > 1) {
                    return { status: 'conflict', currency: null };
                }
            }
        }

        while (
            startIndex < text.length &&
            detectionsProcessed < MAX_CONTEXT_DETECTIONS
        ) {
            const contextDetection = CurrencyDetector.detectCurrency(text, numberFormat, {
                maxLength: MAX_CONTEXT_TEXT_LENGTH,
                startIndex,
            });
            if (!contextDetection) break;

            const normalizedToken = String(contextDetection.symbol || '').trim().toLowerCase();
            const isExplicit = (
                contextDetection.currencies.length === 1 &&
                !CONTEXT_AMBIGUOUS_TOKENS.has(normalizedToken)
            );
            const currency = contextDetection.currencies[0];
            if (isExplicit && possibleCurrencies.has(currency)) {
                explicitCurrencies.add(currency);
                if (explicitCurrencies.size > 1) {
                    return { status: 'conflict', currency: null };
                }
            }

            startIndex = Math.max(contextDetection.end, startIndex + 1);
            detectionsProcessed++;
        }

        if (explicitCurrencies.size === 1) {
            return {
                status: 'resolved',
                currency: explicitCurrencies.values().next().value,
            };
        }
        return noCurrencyContext();
    }

    function isHiddenContextNode(node, scope) {
        let current = node.parentElement;
        while (current) {
            if (
                current.hidden ||
                current.getAttribute?.('aria-hidden') === 'true' ||
                current.style?.display === 'none' ||
                current.style?.visibility === 'hidden'
            ) {
                return true;
            }
            if (current === scope) break;
            current = current.parentElement || current.getRootNode?.().host || null;
        }
        return false;
    }

    function collectContextTextFragments(scope) {
        const ownerDocument = scope?.ownerDocument || document;
        if (!scope || !ownerDocument?.createTreeWalker) return [];

        const walker = ownerDocument.createTreeWalker(
            scope,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                    if (shouldSkipNode(node)) return NodeFilter.FILTER_REJECT;
                    if (isHiddenContextNode(node, scope)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                },
            },
        );

        const fragments = [];
        let totalLength = 0;
        let node;
        while ((node = walker.nextNode())) {
            const fragment = node.textContent.trim();
            totalLength += fragment.length + (fragments.length > 0 ? 1 : 0);
            if (totalLength > MAX_CONTEXT_TEXT_LENGTH) return null;
            fragments.push(fragment);
        }
        return fragments;
    }

    function getParentContextScope(scope) {
        if (scope.parentElement) return scope.parentElement;
        const root = scope.getRootNode?.();
        if (root?.host && root.host !== scope) return root.host;
        return null;
    }

    /**
     * Search from the price outward and stop at the first useful local scope.
     */
    function findScopedCurrencyContext(
        startNode,
        detection,
        numberFormat = 'auto',
        fragmentCollector = collectContextTextFragments,
        fragmentCache = null,
    ) {
        if (!startNode || !detection || detection.currencies?.length < 2) {
            return noCurrencyContext();
        }

        let scope = startNode.nodeType === 3 ? startNode.parentElement : startNode;
        let depth = 0;

        while (scope && depth < MAX_CONTEXT_ANCESTORS) {
            if (scope.tagName === 'BODY' || scope.tagName === 'HTML') break;

            let fragments;
            if (fragmentCache?.has(scope)) {
                fragments = fragmentCache.get(scope);
            } else {
                fragments = fragmentCollector(scope);
                fragmentCache?.set(scope, fragments);
            }
            if (fragments === null) break;

            const result = analyzeCurrencyContext(fragments, detection, numberFormat);
            if (result.status !== 'none') return result;

            scope = getParentContextScope(scope);
            depth++;
        }

        return noCurrencyContext();
    }

    function resolveDetectedCurrency(detection, config, contextResult) {
        if (!detection || !Array.isArray(detection.currencies)) return null;
        if (detection.currencies.length <= 1) {
            return chooseDetectedCurrency(detection, config);
        }
        if (contextResult?.status === 'resolved') return contextResult.currency;
        if (contextResult?.status === 'conflict') return null;
        return chooseDetectedCurrency(detection, config);
    }

    /**
     * Process a single text node, replacing any detected currencies.
     */
    function processTextNode(textNode) {
        let currentTextNode = textNode;
        let searchStart = 0;
        let detectionsProcessed = 0;

        while (
            currentTextNode &&
            detectionsProcessed < MAX_DETECTIONS_PER_TEXT_NODE &&
            replacementCount < settings.autoReplaceLimit
        ) {
            if (shouldSkipNode(currentTextNode)) return;
            const text = currentTextNode.textContent;
            if (!text || text.length > LIMITS.MAX_SELECTION_LENGTH * 2) return;

            const detection = CurrencyDetector.detectCurrency(text, settings.numberFormat, {
                maxLength: LIMITS.MAX_SELECTION_LENGTH * 2,
                startIndex: searchStart,
            });
            if (!detection) return;

            const contextResult = detection.currencies.length > 1
                ? findScopedCurrencyContext(
                    currentTextNode,
                    detection,
                    settings.numberFormat,
                    collectContextTextFragments,
                    contextFragmentCache,
                )
                : null;
            const fromCurrency = resolveDetectedCurrency(detection, settings, contextResult);
            if (!fromCurrency) {
                searchStart = detection.end;
                detectionsProcessed++;
                continue;
            }

            if (fromCurrency === settings.targetCurrency) {
                searchStart = detection.end;
                detectionsProcessed++;
                continue;
            }

            const convertedAmount = convertCurrencyLocal(detection.amount, fromCurrency, settings.targetCurrency);
            if (convertedAmount === null) {
                searchStart = detection.end;
                detectionsProcessed++;
                continue;
            }

            const trailingTextNode = replaceInTextNode(currentTextNode, detection, fromCurrency, convertedAmount);
            replacementCount++;
            detectionsProcessed++;

            currentTextNode = trailingTextNode;
            searchStart = 0;
        }
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
    function formatAmount(amount, currencyCode, compact = null) {
        return formatCompactCurrencyAmount(amount, currencyCode, compact, settings?.outputFormat);
    }

    function formatReplacement(amount, currencyCode, negativeStyle, compact) {
        const symbol = CURRENCY_CODE_TO_SYMBOL[currencyCode] || currencyCode;
        const value = negativeStyle === 'parentheses' ? Math.abs(amount) : amount;
        const label = `${formatAmount(value, currencyCode, compact)} ${symbol}`;
        return negativeStyle === 'parentheses' ? `(${label})` : label;
    }

    function formatOriginalTitle(original, fromCurrency) {
        return `Original: ${original} (${fromCurrency})`;
    }

    /**
     * Replace a currency match in a text node with a span showing converted value.
     * Also handles orphaned currency symbols adjacent to the match (e.g., "$69.99 CAD").
     * Animates: fade out original, then fade in converted.
     */
    function replaceInTextNode(textNode, detection, fromCurrency, convertedAmount) {
        const replaceOpId = debugLog('replaceInTextNode', 'Starting replacement', createDebugData(() => ({
            textContent: textNode.textContent?.substring(0, 80),
            detection: detection.original,
            fromCurrency,
            convertedAmount,
            textNodeInfo: getNodeDebugInfo(textNode),
        })));

        const text = textNode.textContent;
        let matchStart = -1;
        if (
            Number.isInteger(detection.start) &&
            Number.isInteger(detection.end) &&
            detection.start >= 0 &&
            detection.end <= text.length &&
            text.substring(detection.start, detection.end) === detection.original
        ) {
            matchStart = detection.start;
        } else {
            matchStart = text.indexOf(detection.original);
        }
        if (matchStart === -1) {
            debugWarn('replaceInTextNode', 'Match not found in text', { text, original: detection.original });
            return null;
        }

        const parent = textNode.parentNode;
        if (!parent) {
            debugWarn(
                'replaceInTextNode',
                'No parent node found',
                createDebugData(() => ({ textNodeInfo: getNodeDebugInfo(textNode) })),
            );
            return null;
        }

        // Log parent chain for debugging React issues
        debugLog('replaceInTextNode', 'Parent node info', createDebugData(() => ({
            parentInfo: getNodeDebugInfo(parent),
            grandparentInfo: getNodeDebugInfo(parent.parentNode),
            isTextNodeInDocument: isNodeConnected(textNode),
            isParentInDocument: isNodeConnected(parent),
        })));

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
        scannerCreatedNodes.add(fadeOutSpan);

        // Track this element for debugging
        registerElement(fadeOutSpan, 'fadeOutSpan-created');

        // Build initial fragment with fade-out span
        const fragment = document.createDocumentFragment();
        let trailingTextNode = null;
        let leadingTextNode = null;
        if (before) {
            leadingTextNode = document.createTextNode(before);
            scannerCreatedNodes.add(leadingTextNode);
            fragment.appendChild(leadingTextNode);
        }
        fragment.appendChild(fadeOutSpan);
        if (after) {
            trailingTextNode = document.createTextNode(after);
            scannerCreatedNodes.add(trailingTextNode);
            fragment.appendChild(trailingTextNode);
        }

        // Replace original text node with fragment containing fade-out span
        // THIS IS A CRITICAL POINT WHERE REACT CONFLICTS CAN OCCUR
        const parentBeforeReplace = parent; // Capture for async callback
        const replaceSuccess = safeDOMOperation(
            'replaceChild (textNode -> fragment)',
            () => parent.replaceChild(fragment, textNode),
            () => ({
                parent: parent,
                child: textNode,
                operation: 'initial-text-replacement',
                fullOriginal,
                replaceOpId,
            }),
        );

        if (!replaceSuccess) {
            debugError('replaceInTextNode', 'Initial replacement failed, aborting', null, { replaceOpId });
            return null;
        }

        debugLog('replaceInTextNode', 'Initial replacement successful, setting up animation listener', createDebugData(() => ({
            fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
            replaceOpId,
        })));

        // `textNode` is detached now, but the site may still hold a reference to
        // it and write the recalculated price into it later.
        const origin = activeOrigin || textNode;
        const originGroup = originGroups.get(origin) || { lastText: origin.nodeValue };
        originGroup.nodes = [leadingTextNode, fadeOutSpan, trailingTextNode].filter(Boolean);
        originGroup.span = fadeOutSpan;
        watchOriginTextNode(origin, originGroup);

        // After fade-out animation completes, swap to converted value with fade-in
        onAnimationOrNow(fadeOutSpan, () => {
            debugLog('animationend', 'Animation ended, starting swap', createDebugData(() => ({
                fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                inDocument: isNodeConnected(fadeOutSpan),
                hasParent: !!fadeOutSpan.parentNode,
                replaceOpId,
            })));

            // Guard: element may have been removed during animation
            if (!fadeOutSpan.parentNode) {
                debugWarn('animationend', 'fadeOutSpan has no parent, aborting swap', {
                    fadeOutSpanInfo: getNodeDebugInfo(fadeOutSpan),
                    originalParentInfo: getNodeDebugInfo(parentBeforeReplace),
                    inDocument: isNodeConnected(fadeOutSpan),
                    replaceOpId,
                    possibleCause: 'React likely re-rendered this component during animation',
                });
                return;
            }

            const currentParent = fadeOutSpan.parentNode;

            // Additional check: verify parent is still in document
            if (!isNodeConnected(currentParent)) {
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
            if (!shouldAnimate()) {
                span.classList.add('cc-no-animation');
            }
            scannerCreatedNodes.add(span);
            span.dataset.original = fullOriginal;
            span.dataset.fromCurrency = fromCurrency;
            span.title = formatOriginalTitle(fullOriginal, fromCurrency);

            span.textContent = formatReplacement(
                convertedAmount,
                settings.targetCurrency,
                detection.negativeStyle,
                detection.compact,
            );

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
                () => ({
                    parent: currentParent,
                    child: fadeOutSpan,
                    operation: 'animation-swap',
                    fullOriginal,
                    replaceOpId,
                }),
            );

            if (swapSuccess) {
                const liveGroup = originGroups.get(origin);
                if (liveGroup?.span === fadeOutSpan) {
                    liveGroup.nodes = liveGroup.nodes.map(
                        node => (node === fadeOutSpan ? span : node),
                    );
                    liveGroup.span = span;
                }
                debugLog('animationend', 'Swap successful', createDebugData(() => ({
                    newSpanInfo: getNodeDebugInfo(span),
                    replaceOpId
                })));
                // Adjust font size intelligently based on available space ("Leg Stretching")
                adjustSizeIntelligently(span, originalRect);
            }
        });

        debugLog('replaceInTextNode', 'Replacement setup complete', { replaceOpId });
        return trailingTextNode;
    }

    function observeOrigin(node, callback) {
        const observer = new MutationObserver(callback);
        observer.observe(node, { characterData: true });
        originObservers.add(observer);
        return observer;
    }

    function disconnectOriginObservers() {
        for (const observer of originObservers) {
            observer.disconnect();
        }
        originObservers.clear();
    }

    /**
     * Track a detached page-owned text node so late writes to it are noticed.
     */
    function watchOriginTextNode(origin, group) {
        originGroups.set(origin, group);
        if (group.observer) return;
        group.observer = observeOrigin(origin, () => onOriginTextChanged(origin));
    }

    /**
     * The site rewrote a value we had already converted. Re-render from the new
     * text, or hand the spot back to the site if it no longer holds a price.
     */
    function onOriginTextChanged(origin) {
        const group = originGroups.get(origin);
        if (!group) return;

        const newText = origin.nodeValue;
        if (newText === group.lastText) return;
        group.lastText = newText;

        const anchor = group.nodes.find(node => node?.parentNode);
        if (!anchor) {
            group.observer?.disconnect();
            originObservers.delete(group.observer);
            originGroups.delete(origin);
            return;
        }

        const parent = anchor.parentNode;
        const refreshed = document.createTextNode(newText);
        parent.insertBefore(refreshed, anchor);
        for (const node of group.nodes) {
            if (node?.parentNode) node.parentNode.removeChild(node);
        }

        // If nothing convertible remains, `refreshed` stays as the site's own
        // text: the native value, never a stale converted one.
        group.nodes = [refreshed];
        group.span = null;
        replacementCount = Math.max(0, replacementCount - 1);

        activeOrigin = origin;
        try {
            processTextNode(refreshed);
        } finally {
            activeOrigin = null;
        }
    }

    /**
     * Composite elements lose every child to `textContent = ...`. Keep the
     * child text nodes so the element's original text can be rebuilt from them
     * whenever the site writes to any one of them.
     */
    function watchCompositeOrigins(element, textNodes) {
        if (!textNodes.length) return;

        const state = {
            nodes: textNodes,
            lastText: textNodes.map(node => node.nodeValue).join(''),
            observers: [],
        };
        for (const node of textNodes) {
            state.observers.push(
                observeOrigin(node, () => onCompositeOriginChanged(element, state)),
            );
        }
        compositeOrigins.set(element, state);
    }

    function onCompositeOriginChanged(element, state) {
        const rebuilt = state.nodes.map(node => node.nodeValue).join('');
        if (rebuilt === state.lastText) return;
        state.lastText = rebuilt;

        if (!isNodeConnected(element)) {
            releaseCompositeElement(element);
            return;
        }

        const text = rebuilt.trim();
        const detection = detectCompositeCurrency(text);
        const fromCurrency = detection && isFocusedPriceText(text, detection)
            ? resolveDetectedCurrency(detection, settings, null)
            : null;
        const convertedAmount = fromCurrency && fromCurrency !== settings.targetCurrency
            ? convertCurrencyLocal(detection.amount, fromCurrency, settings.targetCurrency)
            : null;

        if (convertedAmount === null) {
            releaseCompositeElement(element, rebuilt);
            return;
        }

        element.dataset.original = text;
        element.dataset.fromCurrency = fromCurrency;
        element.title = formatOriginalTitle(text, fromCurrency);
        // The markup snapshot describes a layout the site has since replaced.
        delete element.dataset.originalHtml;

        const refreshed = [
            text.slice(0, detection.start),
            formatReplacement(
                convertedAmount,
                settings.targetCurrency,
                detection.negativeStyle,
                detection.compact,
            ),
            text.slice(detection.end),
        ].join('');
        element.textContent = refreshed;
        compositeRendered.set(element, refreshed);
    }

    /**
     * Stop owning a composite element and drop the markers that describe our
     * conversion, so no stale "Original: ..." label outlives the value it
     * described. Pass `restoreText` to put the site's own text back.
     */
    function releaseCompositeElement(element, restoreText = null) {
        const state = compositeOrigins.get(element);
        if (state) {
            for (const observer of state.observers) {
                observer.disconnect();
                originObservers.delete(observer);
            }
            compositeOrigins.delete(element);
        }
        compositeRendered.delete(element);

        if (typeof restoreText === 'string' && isNodeConnected(element)) {
            element.textContent = restoreText;
        }

        element.classList.remove(REPLACED_CLASS);
        element.classList.remove('cc-no-animation');
        element.removeAttribute('title');
        element.style.fontSize = '';
        delete element.dataset.original;
        delete element.dataset.originalHtml;
        delete element.dataset.fromCurrency;
        replacementCount = Math.max(0, replacementCount - 1);
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
            if (ratio >= 1) return;

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
        const restoreOpId = debugLog('restoreElement', 'Starting restore', createDebugData(() => ({
            elementInfo: getNodeDebugInfo(element),
            original: element?.dataset?.original,
        })));

        if (!element || !element.dataset.original) {
            debugWarn('restoreElement', 'Missing element or original data', { element: !!element });
            return;
        }

        if (!element.parentNode) {
            debugWarn('restoreElement', 'Element has no parent, cannot restore', {
                restoreOpId,
                elementInfo: getNodeDebugInfo(element),
                inDocument: isNodeConnected(element),
            });
            return;
        }

        const textNode = document.createTextNode(element.dataset.original);
        scannerCreatedNodes.add(textNode);

        const restoreSuccess = safeDOMOperation(
            'restoreElement replaceChild',
            () => element.parentNode.replaceChild(textNode, element),
            () => ({
                parent: element.parentNode,
                child: element,
                operation: 'restore',
                original: element.dataset.original,
                restoreOpId,
            }),
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
        disconnectOriginObservers();
        const observedShadowRoots = Array.from(observers.keys())
            .filter(root => root !== document.body);
        const roots = [document, ...observedShadowRoots];
        const elements = roots.flatMap(root => Array.from(root.querySelectorAll(`.${REPLACED_CLASS}`)));
        debugLog('restoreAll', `Found ${elements.length} elements to restore`);
        elements.forEach(restoreElement);
        replacementCount = 0;
        debugLog('restoreAll', 'Restore all complete');
    }

    /**
     * Set up MutationObserver to handle dynamic content.
     */
    function setupMutationObserver(root = document.body) {
        if (!root) return;

        const existingState = observers.get(root);
        if (existingState?.active) {
            debugLog('MutationObserver', 'Observer already exists, skipping setup');
            return;
        }

        if (existingState) {
            existingState.observer.observe(root, {
                childList: true,
                subtree: true,
            });
            existingState.active = true;
            debugLog('MutationObserver', 'Observer resumed');
            return;
        }

        debugLog('MutationObserver', 'Setting up MutationObserver');

        const pendingNodes = new Set();
        let debounceTimer = null;
        let firstPendingAt = 0;
        let mutationBatchId = 0;

        function flushPendingNodes(batchId) {
            debounceTimer = null;
            firstPendingAt = 0;
            if (!isEnabled || pendingNodes.size === 0) return;

            const nodesToProcess = compactPendingNodes(pendingNodes);
            pendingNodes.clear();

            debugLog('MutationObserver', 'Queueing pending nodes', {
                batchId,
                pendingCount: nodesToProcess.length,
                replacementCount,
                limit: settings?.autoReplaceLimit,
            });

            for (const node of nodesToProcess) {
                if (node?.isConnected === false || isExtensionOwnedNode(node)) continue;
                queueScanRoot(node);
            }
        }

        function schedulePendingFlush(batchId) {
            if (pendingNodes.size === 0) return;

            const now = Date.now();
            if (!firstPendingAt) firstPendingAt = now;
            if (debounceTimer) clearTimeout(debounceTimer);

            const maxWaitRemaining = Math.max(
                0,
                MUTATION_MAX_WAIT_MS - (now - firstPendingAt),
            );
            const delay = Math.min(MUTATION_DEBOUNCE_MS, maxWaitRemaining);
            debounceTimer = setTimeout(() => flushPendingNodes(batchId), delay);
        }

        const observer = new MutationObserver((mutations) => {
            if (!isEnabled) return;
            if (replacementCount >= settings.autoReplaceLimit) {
                observer.disconnect();
                const state = observers.get(root);
                if (state) state.active = false;
                return;
            }

            const batchId = ++mutationBatchId;
            let addedCount = 0;
            let removedCount = 0;

            const removedNodes = DEBUG_MODE ? [] : null;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    // The site rewrote a row we had converted. Give the row back
                    // before its old "Original: ..." label outlives the value it
                    // described, then let it be scanned again from scratch.
                    const target = mutation.target;
                    if (
                        target?.nodeType === Node.ELEMENT_NODE &&
                        compositeRendered.has(target) &&
                        target.textContent !== compositeRendered.get(target)
                    ) {
                        releaseCompositeElement(target);
                        pendingNodes.add(target);
                        addedCount++;
                    }

                    if (DEBUG_MODE) {
                        for (const node of mutation.removedNodes) {
                            removedCount++;
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (
                                    node.classList?.contains(REPLACED_CLASS) ||
                                    node.classList?.contains('cc-fading-out')
                                ) {
                                    removedNodes.push({
                                        type: 'replaced-element-removed',
                                        nodeInfo: getNodeDebugInfo(node),
                                        parentInfo: getNodeDebugInfo(mutation.target),
                                    });
                                }

                                const replacedInside = node.querySelectorAll?.(
                                    `.${REPLACED_CLASS}, .cc-fading-out`,
                                );
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
                    }

                    for (const node of mutation.addedNodes) {
                        if (isExtensionOwnedNode(node)) continue;
                        if (
                            node.nodeType !== Node.ELEMENT_NODE &&
                            !(
                                node.nodeType === Node.TEXT_NODE &&
                                node.textContent.trim()
                            )
                        ) {
                            continue;
                        }

                        pendingNodes.add(node);
                        addedCount++;
                    }
                }
            }

            if (removedNodes?.length > 0) {
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
                    pendingTotal: pendingNodes.size,
                });
            }

            schedulePendingFlush(batchId);
        });

        observer.observe(root, {
            childList: true,
            subtree: true,
        });
        observers.set(root, { observer, active: true });

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
        shouldSkipNode,
        isSensitiveEmbeddedFrame,
        collectOpenShadowRoots,
        analyzeCurrencyContext,
        findScopedCurrencyContext,
        resolveDetectedCurrency,
        formatOriginalTitle,
        drainScanWork,
        drainDomTraversal,
        compactPendingNodes,
        createDebugData,
        isNodeConnected,
        shouldAnimate,
        onAnimationOrNow,
    };
})();
