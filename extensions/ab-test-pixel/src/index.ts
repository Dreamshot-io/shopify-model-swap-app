import { register } from '@shopify/web-pixels-extension';

interface TestState {
  testId: string;
  activeCase: 'BASE' | 'TEST';
  productId: string;
  variantId?: string | null;
}

register(({ analytics, browser, settings, init }) => {
  // Get app URL from settings, fallback to relative paths for development
  const APP_URL = settings.app_url || '';
  const ROTATION_API = `${APP_URL}/api/rotation-state`;
  const TRACK_API = `${APP_URL}/track`;
  const STATE_KEY = 'ab_test_active';
  const SESSION_KEY = 'ab_test_session';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_';

  // Get shop domain from init data (provided by Shopify)
  const SHOP_DOMAIN = init.data?.shop?.myshopifyDomain || '';
  
  // Always log shop domain for debugging (temporary)
  console.log('[A/B Test Pixel] Shop domain:', SHOP_DOMAIN, 'init.data.shop:', init.data?.shop);

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

  // Track product views - Simplified: always track, server assigns test
  analytics.subscribe('product_viewed', async event => {
    // Extract productId from event structure
    let productId: string | null = null;

    // Try the actual Shopify structure first (most common)
    if (event.data?.productVariant?.product?.id) {
      productId = String(event.data.productVariant.product.id);
    } else if (event.data?.product?.id) {
      productId = String(event.data.product.id);
    } else if (event.data?.productId) {
      productId = String(event.data.productId);
    } else if (event.productId) {
      productId = String(event.productId);
    }

    if (!productId) {
      console.warn('[A/B Test Pixel] No productId found, skipping');
      return;
    }

    // Normalize to GID format
    if (!productId.startsWith('gid://shopify/Product/')) {
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      } else {
        console.warn('[A/B Test Pixel] ProductId format not recognized:', productId);
        return;
      }
    }

    // Extract variantId
    let variantId: string | null = null;
    if (event.data?.productVariant?.id) {
      variantId = String(event.data.productVariant.id);
      if (/^\d+$/.test(variantId)) {
        variantId = `gid://shopify/ProductVariant/${variantId}`;
      }
    }

    // Track impression directly - server will assign test if active
    await trackEventDirectly('IMPRESSION', productId, variantId);
  });

  // Note: Can't use page_viewed fallback because we can't access window.location in worker context
  // Must rely on product_viewed event having the correct data structure

  // Track add to cart events - Simplified: always track, server assigns test
  analytics.subscribe('product_added_to_cart', async event => {
    // Extract productId
    let productId: string | null = null;
    if (event.data?.cartLine?.merchandise?.product?.id) {
      productId = String(event.data.cartLine.merchandise.product.id);
    } else if (event.data?.product?.id) {
      productId = String(event.data.product.id);
    }

    if (!productId) {
      console.warn('[A/B Test Pixel] Add-to-cart: No productId found');
      return;
    }

    // Normalize to GID format
    if (!productId.startsWith('gid://shopify/Product/')) {
      if (/^\d+$/.test(productId)) {
        productId = `gid://shopify/Product/${productId}`;
      } else {
        return;
      }
    }

    // Extract variantId
    let variantId: string | null = null;
    if (event.data?.cartLine?.merchandise?.id) {
      variantId = String(event.data.cartLine.merchandise.id);
      if (/^\d+$/.test(variantId)) {
        variantId = `gid://shopify/ProductVariant/${variantId}`;
      }
    }

    const quantity = event.data?.cartLine?.quantity ?? 1;

    // Track directly - server will assign test if active
    await trackEventDirectly('ADD_TO_CART', productId, variantId, {
      quantity,
      metadata: {
        price: event.data?.cartLine?.cost?.totalAmount?.amount,
        currency: event.data?.cartLine?.cost?.totalAmount?.currencyCode,
      },
    });
  });

  // Track completed purchases - Simplified: always track, server assigns test
  analytics.subscribe('checkout_completed', async event => {
    // Track purchase event for each line item
    for (const lineItem of event.data?.checkout?.lineItems || []) {
      let productId = lineItem?.variant?.product?.id;

      if (!productId) continue;

      // Normalize to GID format
      productId = String(productId);
      if (!productId.startsWith('gid://shopify/Product/')) {
        if (/^\d+$/.test(productId)) {
          productId = `gid://shopify/Product/${productId}`;
        } else {
          continue;
        }
      }

      let variantId = lineItem?.variant?.id;
      if (variantId) {
        variantId = String(variantId);
        if (/^\d+$/.test(variantId)) {
          variantId = `gid://shopify/ProductVariant/${variantId}`;
        }
      }

      // Track directly - server will assign test if active
      await trackEventDirectly('PURCHASE', productId, variantId, {
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
    const sessionId = await getOrCreateSessionId();
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

      // Always log API response (not just in debug mode) for troubleshooting
      console.log('[A/B Test Pixel] API Response:', {
        url,
        status: response.status,
        productId,
        result
      });

      log('Test state result', result);

      // No active test for this product
      if (!result?.testId || !result?.activeCase) {
        console.warn('[A/B Test Pixel] ⚠️ No active test found for product', {
          productId,
          productIdFormat: productId.startsWith('gid://') ? 'GID' : 'numeric',
          apiResponse: result,
          apiUrl: url,
          suggestion: 'Check if test exists and productId matches exactly'
        });
        log('No active test for this product', { productId, result });
        return;
      }

      // Success - log it
      console.log('[A/B Test Pixel] ✅ Test found:', {
        testId: result.testId,
        activeCase: result.activeCase,
        productId
      });

      const state: TestState = {
        testId: result.testId,
        activeCase: result.activeCase,
        productId,
        variantId: result.variantCase ? variantId : null,
      };

      log('Storing test state', state);

      // Store state for this session
      await browser.sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

      // Track impression if not already tracked
      await trackImpression(state);
    } catch (error) {
      console.error('[A/B Test Pixel] Failed to fetch test state', error);
      log('Error details', error);
    }
  }

  /**
   * Track event directly without test state - server will assign test if active
   */
  async function trackEventDirectly(
    eventType: 'IMPRESSION' | 'ADD_TO_CART' | 'PURCHASE',
    productId: string,
    variantId: string | null,
    options?: {
      revenue?: number;
      quantity?: number;
      metadata?: any;
    }
  ) {
    const sessionId = await getOrCreateSessionId();
    if (!sessionId) {
      console.warn('[A/B Test Pixel] Cannot track event: missing session ID', { eventType, productId });
      return;
    }

    if (!APP_URL || APP_URL.trim() === '') {
      console.error('[A/B Test Pixel] Cannot track event: app_url is not configured', { eventType, productId });
      return;
    }

    try {
      // Simplified payload - server will find and assign test
      const payload = {
        sessionId,
        eventType,
        productId,
        variantId: variantId || null,
        shopDomain: SHOP_DOMAIN || null,
        revenue: options?.revenue,
        quantity: options?.quantity,
        metadata: {
          ...options?.metadata,
          timestamp: new Date().toISOString(),
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
        console.error('[A/B Test Pixel] Failed to track event after retries', { eventType, productId });
        return;
      }

      if (!response.ok) {
        let error;
        try {
          error = await response.json();
        } catch {
          error = { message: `HTTP ${response.status}: ${response.statusText}` };
        }
        console.error('[A/B Test Pixel] Failed to track event:', error, { eventType, productId });
      } else {
        const result = await response.json();
        console.log('[A/B Test Pixel] ✅ Track API Success:', {
          eventType,
          productId,
          testId: result.testId || 'none',
          response: result
        });
      }
    } catch (error) {
      console.error('[A/B Test Pixel] Failed to track event', error, { eventType, productId });
    }
  }

  /**
   * Track an event to the backend (legacy - kept for compatibility)
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
    const sessionId = await getOrCreateSessionId();
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
          // Note: Can't access navigator/window in worker context
          // Browser info not available in web pixel worker
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
        console.log('[A/B Test Pixel] ✅ Track API Success:', {
          eventType,
          testId: state.testId,
          productId: state.productId,
          response: result
        });
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
    // Simplified: Track every page visit, no deduplication
    console.log('[A/B Test Pixel] 📊 Tracking IMPRESSION:', {
      testId: state.testId,
      activeCase: state.activeCase,
      productId: state.productId
    });

    log('Tracking impression for test', state.testId, 'case', state.activeCase);

    await trackEvent(state, 'IMPRESSION', {
      metadata: {
        // Note: Can't access document.referrer or window.location in worker context
        // Event should contain URL info if needed
      },
    });

    console.log('[A/B Test Pixel] ✅ Impression tracked');
    log('Impression tracked');
  }

  /**
   * Get stored test state
   * Note: browser.sessionStorage methods are async in web worker context
   */
  async function getTestState(): Promise<TestState | null> {
    try {
      const raw = await browser.sessionStorage.getItem(STATE_KEY);
      if (!raw) return null;

      return JSON.parse(raw) as TestState;
    } catch (error) {
      console.error('[A/B Test] Failed to parse test state', error);
      return null;
    }
  }

  /**
   * Get or create a persistent session ID
   * Note: browser.localStorage methods are async in web worker context
   */
  async function getOrCreateSessionId(): Promise<string | null> {
    try {
      let sessionId = await browser.localStorage.getItem(SESSION_KEY);

      if (sessionId) {
        return sessionId;
      }

      // Generate new session ID
      sessionId = `session_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

      await browser.localStorage.setItem(SESSION_KEY, sessionId);
      return sessionId;
    } catch (error) {
      console.error('[A/B Test] Unable to get/create session id', error);
      return null;
    }
  }
});
