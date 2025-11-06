import { register } from '@shopify/web-pixels-extension';

interface RotationState {
  slotId: string;
  testId: string;
  productId: string;
  shopifyVariantId?: string | null;
  abVariant: 'A' | 'B';
  rotationVariant: 'CONTROL' | 'TEST';
}

register(({ analytics, browser }) => {
  const APP_PROXY_BASE = '/apps/model-swap';
  const STATE_KEY = 'ab_test_rotation_state';
  const SESSION_KEY = 'ab_test_session';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_synced_';

  analytics.subscribe('product_viewed', async event => {
    const productId = event.data?.product?.id;
    const variantId = event.data?.productVariant?.id ?? event.data?.productVariantId ?? null;

    if (!productId) {
      return;
    }

    await ensureRotationState(productId, variantId);
  });

  analytics.subscribe('product_added_to_cart', async event => {
    const state = getRotationState();
    if (!state) return;

    const revenue = undefined;
    await trackEvent(state, 'ADD_TO_CART', revenue, event.data?.variant?.id ?? null);
  });

  analytics.subscribe('checkout_completed', async event => {
    const state = getRotationState();
    if (!state) return;

    const revenueAmount = event.data?.checkout?.totalPrice?.amount;
    const revenue = revenueAmount ? parseFloat(revenueAmount) : undefined;

    await trackEvent(state, 'PURCHASE', revenue, null);

    browser.sessionStorage.removeItem(STATE_KEY);
    browser.sessionStorage.removeItem(`${IMPRESSION_SYNC_PREFIX}${state.testId}`);
  });

  async function ensureRotationState(productId: string, variantId: string | null): Promise<void> {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) {
      return;
    }

    try {
      const query = new URLSearchParams({ productId });
      if (variantId) {
        query.set('variantId', variantId);
      }

      const response = await fetch(`${APP_PROXY_BASE}/api/rotation-state?${query.toString()}`);
      if (!response.ok) {
        return;
      }

      const result = await response.json();

      if (!result?.testId || !result?.abVariant) {
        return;
      }

      const state: RotationState = {
        slotId: result.slotId,
        testId: result.testId,
        productId,
        shopifyVariantId: variantId,
        abVariant: result.abVariant,
        rotationVariant: result.rotationVariant,
      };

      browser.sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      await trackImpression(state);
    } catch (error) {
      console.error('[A/B Test] Failed to fetch rotation state', error);
    }
  }

  async function trackEvent(
    state: RotationState,
    eventType: 'IMPRESSION' | 'ADD_TO_CART' | 'PURCHASE',
    revenue?: number,
    variantId?: string | null,
  ) {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    try {
      await fetch(`${APP_PROXY_BASE}/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testId: state.testId,
          sessionId,
          eventType,
          productId: state.productId,
          shopifyVariantId: variantId ?? state.shopifyVariantId,
          revenue,
          occurredAt: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.error('[A/B Test] Failed to track event', error);
    }
  }

  async function trackImpression(state: RotationState) {
    const syncKey = `${IMPRESSION_SYNC_PREFIX}${state.testId}`;
    const existing = browser.sessionStorage.getItem(syncKey);

    if (existing === state.abVariant) {
      return;
    }

    await trackEvent(state, 'IMPRESSION');
    browser.sessionStorage.setItem(syncKey, state.abVariant);
  }

  function getRotationState(): RotationState | null {
    const raw = browser.sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as RotationState;
    } catch (error) {
      console.error('[A/B Test] Failed to parse rotation state', error);
      return null;
    }
  }

  function getOrCreateSessionId(): string | null {
    let sessionId = browser.localStorage.getItem(SESSION_KEY);

    if (sessionId) {
      return sessionId;
    }

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
