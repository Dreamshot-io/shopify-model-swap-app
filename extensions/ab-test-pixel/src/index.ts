import { register } from '@shopify/web-pixels-extension';

interface ABTestData {
  testId: string;
  variant: string;
  productId: string;
}

/**
 * Web Pixels extension for A/B Test Tracking
 *
 * This extension runs in a sandboxed worker and handles ONLY tracking events:
 * - Add to cart events
 * - Checkout/purchase events
 *
 * Image replacement is handled by the theme app extension (ab-test-loader)
 * which injects /public/image-replacer.js into the storefront.
 *
 * The theme extension sets sessionStorage['ab_test_active'] with test data
 * that this extension reads to track conversions.
 */
register(({ analytics, browser, settings }) => {
  const APP_PROXY_BASE = '/apps/model-swap';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_synced_';

  // Utility: Track event to backend
  async function trackEvent(
    testId: string,
    eventType: string,
    productId: string,
    revenue?: number,
    variant?: 'A' | 'B'
  ): Promise<void> {
    const sessionId = browser.localStorage.getItem('ab_test_session');

    if (!sessionId) {
      console.log('[A/B Test] No session ID found for tracking');
      return;
    }

    try {
      await fetch(`${APP_PROXY_BASE}/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          testId,
          sessionId,
          eventType,
          productId,
          revenue,
          variant,
        }),
      });
    } catch (error) {
      console.error('[A/B Test] Failed to track event:', error);
    }
  }

  async function ensureImpressionSync(): Promise<void> {
    const testDataStr = browser.sessionStorage.getItem('ab_test_active');

    if (!testDataStr) {
      return;
    }

    try {
      const testData: ABTestData = JSON.parse(testDataStr);

      if (!testData?.testId || (testData.variant !== 'A' && testData.variant !== 'B')) {
        return;
      }

      const syncKey = `${IMPRESSION_SYNC_PREFIX}${testData.testId}`;
      const alreadySynced = browser.sessionStorage.getItem(syncKey);

      if (alreadySynced === testData.variant) {
        return;
      }

      await trackEvent(testData.testId, 'IMPRESSION', testData.productId, undefined, testData.variant);
      browser.sessionStorage.setItem(syncKey, testData.variant);
      console.log('[A/B Test] Synced impression fallback for test:', testData.testId);
    } catch (error) {
      console.error('[A/B Test] Error syncing impression fallback:', error);
    }
  }

  // Handle add to cart events
  analytics.subscribe('product_added_to_cart', async (event) => {
    const testDataStr = browser.sessionStorage.getItem('ab_test_active');

    if (!testDataStr) {
      return;
    }

    try {
      const testData: ABTestData = JSON.parse(testDataStr);
      await trackEvent(testData.testId, 'ADD_TO_CART', testData.productId);
      console.log('[A/B Test] Tracked add to cart for test:', testData.testId);
    } catch (error) {
      console.error('[A/B Test] Error tracking add to cart:', error);
    }
  });

  // Handle checkout completion
  analytics.subscribe('checkout_completed', async (event) => {
    const testDataStr = browser.sessionStorage.getItem('ab_test_active');

    if (!testDataStr) {
      return;
    }

    try {
      const testData: ABTestData = JSON.parse(testDataStr);
      const revenue = event.data?.checkout?.totalPrice?.amount;

      await trackEvent(
        testData.testId,
        'PURCHASE',
        testData.productId,
        revenue ? parseFloat(revenue) : undefined
      );

      console.log('[A/B Test] Tracked purchase for test:', testData.testId);

      // Clean up
      browser.sessionStorage.removeItem('ab_test_active');
      browser.sessionStorage.removeItem(`${IMPRESSION_SYNC_PREFIX}${testData.testId}`);
    } catch (error) {
      console.error('[A/B Test] Error tracking purchase:', error);
    }
  });

  // Fallback for impressions using web pixel analytics events
  analytics.subscribe('product_viewed', ensureImpressionSync);
});
