import { register } from '@shopify/web-pixels-extension';

interface TestState {
  testId: string;
  activeCase: 'BASE' | 'TEST';
  productId: string;
  variantId?: string | null;
}

register(({ analytics, browser }) => {
  // Use correct API routes without base path
  const ROTATION_API = '/api/rotation-state';
  const TRACK_API = '/track';
  const STATE_KEY = 'ab_test_active';
  const SESSION_KEY = 'ab_test_session';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_';

  // Track product views
  analytics.subscribe('product_viewed', async event => {
    const productId = event.data?.product?.id;
    const variantId = event.data?.productVariant?.id ?? event.data?.productVariantId ?? null;

    if (!productId) {
      return;
    }

    await fetchAndStoreTestState(productId, variantId);
  });

  // Track add to cart events
  analytics.subscribe('product_added_to_cart', async event => {
    const state = getTestState();
    if (!state) return;

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
   * Fetch test state from the API and store it
   */
  async function fetchAndStoreTestState(
    productId: string,
    variantId: string | null
  ): Promise<void> {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) {
      return;
    }

    try {
      const query = new URLSearchParams({ productId });
      if (variantId) {
        query.set('variantId', variantId);
      }

      const response = await fetch(`${ROTATION_API}?${query.toString()}`);
      if (!response.ok) {
        return;
      }

      const result = await response.json();

      // No active test for this product
      if (!result?.testId || !result?.activeCase) {
        return;
      }

      const state: TestState = {
        testId: result.testId,
        activeCase: result.activeCase,
        productId,
        variantId: result.variantCase ? variantId : null,
      };

      // Store state for this session
      browser.sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

      // Track impression if not already tracked
      await trackImpression(state);
    } catch (error) {
      console.error('[A/B Test] Failed to fetch test state', error);
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
    if (!sessionId) return;

    try {
      const response = await fetch(TRACK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('[A/B Test] Failed to track event:', error);
      }
    } catch (error) {
      console.error('[A/B Test] Failed to track event', error);
    }
  }

  /**
   * Track impression (only once per session per test)
   */
  async function trackImpression(state: TestState) {
    const syncKey = `${IMPRESSION_SYNC_PREFIX}${state.testId}`;
    const alreadyTracked = browser.sessionStorage.getItem(syncKey);

    if (alreadyTracked === state.activeCase) {
      // Already tracked impression for this test and case
      return;
    }

    await trackEvent(state, 'IMPRESSION', {
      metadata: {
        referrer: document.referrer,
        pageUrl: window.location.href,
      },
    });

    // Mark as tracked
    browser.sessionStorage.setItem(syncKey, state.activeCase);
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