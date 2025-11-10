import { register } from '@shopify/web-pixels-extension';

interface TestState {
  testId: string;
  activeCase: 'BASE' | 'TEST';
  productId: string;
  variantId?: string | null;
}

register(({ analytics, browser, settings }) => {
  // Get app URL from settings, fallback to relative paths for development
  const APP_URL = settings.app_url || '';
  const ROTATION_API = `${APP_URL}/api/rotation-state`;
  const TRACK_API = `${APP_URL}/track`;
  const STATE_KEY = 'ab_test_active';
  const SESSION_KEY = 'ab_test_session';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_';

  // Debug logging if enabled
  const DEBUG = settings.debug === 'true' || settings.debug === '1';
  const log = (...args: any[]) => {
    if (DEBUG) {
      console.log('[A/B Test Pixel]', ...args);
    }
  };

  // Validate pixel configuration
  if (!APP_URL || APP_URL.trim() === '') {
    console.warn('[A/B Test Pixel] Warning: app_url setting is missing or empty. Tracking may fail.');
    console.warn('[A/B Test Pixel] Please configure app_url in pixel settings.');
  } else {
    log('Initialized', { APP_URL, ROTATION_API, TRACK_API });
  }

  // Track product views
  analytics.subscribe('product_viewed', async event => {
    const productId = event.data?.product?.id;
    const variantId = event.data?.productVariant?.id ?? event.data?.productVariantId ?? null;

    log('Product viewed', { productId, variantId });

    if (!productId) {
      log('No productId, skipping');
      return;
    }

    await fetchAndStoreTestState(productId, variantId);
  });

  // Track add to cart events
  analytics.subscribe('product_added_to_cart', async event => {
    let state = getTestState();

    // Recovery: If state is missing, try to fetch it from the event data
    if (!state) {
      const productId = event.data?.cartLine?.merchandise?.product?.id ??
                       event.data?.product?.id ??
                       null;

      if (productId) {
        log('Add-to-cart: Missing test state, attempting recovery for product', productId);
        const variantId = event.data?.cartLine?.merchandise?.id ?? null;
        await fetchAndStoreTestState(productId, variantId);
        state = getTestState();

        if (!state) {
          console.warn('[A/B Test Pixel] Add-to-cart: Could not recover test state for product', productId);
          return;
        }
        log('Add-to-cart: Successfully recovered test state', state);
      } else {
        console.warn('[A/B Test Pixel] Add-to-cart: Missing test state and productId, skipping tracking');
        return;
      }
    }

    const variantId = event.data?.cartLine?.merchandise?.id ?? null;
    const quantity = event.data?.cartLine?.quantity ?? 1;

    await trackEvent(state, 'ADD_TO_CART', {
      variantId,
      quantity,
      metadata: {
        price: event.data?.cartLine?.cost?.totalAmount?.amount,
        currency: event.data?.cartLine?.cost?.totalAmount?.currencyCode,
      },
    });
  });

  // Track completed purchases
  analytics.subscribe('checkout_completed', async event => {
    const state = getTestState();
    if (!state) return;

    // Track purchase event for each line item with the test
    for (const lineItem of event.data?.checkout?.lineItems || []) {
      const lineProductId = lineItem?.variant?.product?.id;

      if (lineProductId === state.productId) {
        await trackEvent(state, 'PURCHASE', {
          variantId: lineItem?.variant?.id,
          revenue: lineItem?.cost?.totalAmount?.amount
            ? parseFloat(lineItem.cost.totalAmount.amount)
            : undefined,
          quantity: lineItem?.quantity,
          metadata: {
            orderId: event.data?.checkout?.order?.id,
            orderNumber: event.data?.checkout?.orderStatusUrl,
            currency: event.data?.checkout?.totalPrice?.currencyCode,
          },
        });
      }
    }

    // Clear state after purchase
    browser.sessionStorage.removeItem(STATE_KEY);
    browser.sessionStorage.removeItem(`${IMPRESSION_SYNC_PREFIX}${state.testId}`);
  });

  /**
   * Fetch with retry logic (exponential backoff)
   */
  async function fetchWithRetry(
    url: string,
    options: RequestInit = {},
    maxRetries: number = 2
  ): Promise<Response | null> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok || attempt === maxRetries) {
          return response;
        }

        // Exponential backoff: 100ms, 200ms
        if (attempt < maxRetries) {
          const delay = 100 * Math.pow(2, attempt);
          log(`Fetch failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        if (attempt === maxRetries) {
          console.error('[A/B Test Pixel] Fetch failed after retries', error);
          return null;
        }
        const delay = 100 * Math.pow(2, attempt);
        log(`Fetch error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return null;
  }

  /**
   * Fetch test state from the API and store it
   */
  async function fetchAndStoreTestState(
    productId: string,
    variantId: string | null
  ): Promise<void> {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) {
      log('No session ID, cannot fetch test state');
      console.warn('[A/B Test Pixel] Cannot fetch test state: missing session ID');
      return;
    }

    if (!APP_URL || APP_URL.trim() === '') {
      console.error('[A/B Test Pixel] Cannot fetch test state: app_url is not configured');
      return;
    }

    try {
      const query = new URLSearchParams({ productId });
      if (variantId) {
        query.set('variantId', variantId);
      }

      const url = `${ROTATION_API}?${query.toString()}`;
      log('Fetching test state from', url);

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response) {
        console.error('[A/B Test Pixel] Failed to fetch test state after retries');
        return;
      }

      log('Response status', response.status);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[A/B Test Pixel] Response not OK', response.status, response.statusText, errorText);
        log('Response not OK', response.status, response.statusText);
        return;
      }

      const result = await response.json();
      log('Test state result', result);

      // No active test for this product
      if (!result?.testId || !result?.activeCase) {
        log('No active test for this product');
        return;
      }

      const state: TestState = {
        testId: result.testId,
        activeCase: result.activeCase,
        productId,
        variantId: result.variantCase ? variantId : null,
      };

      log('Storing test state', state);

      // Store state for this session
      browser.sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

      // Track impression if not already tracked
      await trackImpression(state);
    } catch (error) {
      console.error('[A/B Test Pixel] Failed to fetch test state', error);
      log('Error details', error);
    }
  }

  /**
   * Track an event to the backend
   */
  async function trackEvent(
    state: TestState,
    eventType: 'IMPRESSION' | 'ADD_TO_CART' | 'PURCHASE',
    options?: {
      variantId?: string | null;
      revenue?: number;
      quantity?: number;
      metadata?: any;
    }
  ) {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) {
      console.warn('[A/B Test Pixel] Cannot track event: missing session ID', { eventType, productId: state.productId });
      log('No session ID for tracking event');
      return;
    }

    if (!APP_URL || APP_URL.trim() === '') {
      console.error('[A/B Test Pixel] Cannot track event: app_url is not configured', { eventType, productId: state.productId });
      return;
    }

    try {
      const payload = {
        testId: state.testId,
        sessionId,
        eventType,
        activeCase: state.activeCase,
        productId: state.productId,
        variantId: options?.variantId ?? state.variantId,
        revenue: options?.revenue,
        quantity: options?.quantity,
        metadata: {
          ...options?.metadata,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
        },
      };

      log('Tracking event', eventType, 'to', TRACK_API, payload);

      const response = await fetchWithRetry(TRACK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response) {
        console.error('[A/B Test Pixel] Failed to track event after retries', { eventType, productId: state.productId, testId: state.testId });
        return;
      }

      log('Track response status', response.status);

      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch {
          error = { message: `HTTP ${response.status}: ${response.statusText}` };
        }
        console.error('[A/B Test Pixel] Failed to track event:', error, { eventType, productId: state.productId, testId: state.testId });
        log('Track error response', error);
      } else {
        const result = await response.json();
        log('Track success', result);
      }
    } catch (error) {
      console.error('[A/B Test Pixel] Failed to track event', error, { eventType, productId: state.productId, testId: state.testId });
      log('Track error details', error);
    }
  }

  /**
   * Track impression (only once per session per test)
   */
  async function trackImpression(state: TestState) {
    const syncKey = `${IMPRESSION_SYNC_PREFIX}${state.testId}`;
    const alreadyTracked = browser.sessionStorage.getItem(syncKey);

    log('Checking impression tracking', { syncKey, alreadyTracked, currentCase: state.activeCase });

    if (alreadyTracked === state.activeCase) {
      // Already tracked impression for this test and case
      log('Impression already tracked for this case');
      return;
    }

    log('Tracking impression for test', state.testId, 'case', state.activeCase);

    await trackEvent(state, 'IMPRESSION', {
      metadata: {
        referrer: document.referrer,
        pageUrl: window.location.href,
      },
    });

    // Mark as tracked
    browser.sessionStorage.setItem(syncKey, state.activeCase);
    log('Marked impression as tracked');
  }

  /**
   * Get stored test state
   */
  function getTestState(): TestState | null {
    const raw = browser.sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as TestState;
    } catch (error) {
      console.error('[A/B Test] Failed to parse test state', error);
      return null;
    }
  }

  /**
   * Get or create a persistent session ID
   */
  function getOrCreateSessionId(): string | null {
    let sessionId = browser.localStorage.getItem(SESSION_KEY);

    if (sessionId) {
      return sessionId;
    }

    // Generate new session ID
    sessionId = `session_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    try {
      browser.localStorage.setItem(SESSION_KEY, sessionId);
    } catch (error) {
      console.error('[A/B Test] Unable to persist session id', error);
      return null;
    }

    return sessionId;
  }
});
