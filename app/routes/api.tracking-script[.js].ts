import type { LoaderFunctionArgs } from '@remix-run/node';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { origin } = new URL(request.url);
  const appUrl = origin;

  // The tracking script that will run on the storefront
  const script = `
(function() {
  console.log('[A/B Test Tracker] Initializing...');

  const APP_URL = '${appUrl}';
  const ROTATION_API = APP_URL + '/api/rotation-state';
  const TRACK_API = APP_URL + '/track';
  const STATE_KEY = 'ab_test_active';
  const SESSION_KEY = 'ab_test_session';
  const IMPRESSION_SYNC_PREFIX = 'ab_test_impression_';

  // Get or create session ID
  function getOrCreateSessionId() {
    let sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 'session_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  }

  // Get stored test state
  function getTestState() {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  // Track event to backend
  async function trackEvent(state, eventType, options = {}) {
    const sessionId = getOrCreateSessionId();
    if (!sessionId) return;

    try {
      const payload = {
        testId: state.testId,
        sessionId: sessionId,
        eventType: eventType,
        activeCase: state.activeCase,
        productId: state.productId,
        variantId: options.variantId || state.variantId,
        revenue: options.revenue,
        quantity: options.quantity,
        metadata: {
          ...options.metadata,
          source: 'script_tag',
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          pageUrl: window.location.href
        }
      };

      console.log('[A/B Test Tracker] Tracking event:', eventType, payload);

      const response = await fetch(TRACK_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[A/B Test Tracker] Event tracked:', result);
      }
    } catch (error) {
      console.error('[A/B Test Tracker] Failed to track event:', error);
    }
  }

  // Fetch test state from API
  async function fetchTestState(productId) {
    try {
      const url = ROTATION_API + '?productId=' + encodeURIComponent(productId);
      const response = await fetch(url);

      if (!response.ok) return null;

      const result = await response.json();
      console.log('[A/B Test Tracker] Test state:', result);

      if (!result.testId || !result.activeCase) {
        return null;
      }

      return {
        testId: result.testId,
        activeCase: result.activeCase,
        productId: productId
      };
    } catch (error) {
      console.error('[A/B Test Tracker] Failed to fetch test state:', error);
      return null;
    }
  }

  // Track impression if not already tracked
  async function trackImpression(state) {
    const syncKey = IMPRESSION_SYNC_PREFIX + state.testId;
    const alreadyTracked = sessionStorage.getItem(syncKey);

    if (alreadyTracked === state.activeCase) {
      console.log('[A/B Test Tracker] Impression already tracked for this case');
      return;
    }

    await trackEvent(state, 'IMPRESSION', {
      metadata: {
        referrer: document.referrer,
        pageUrl: window.location.href
      }
    });

    sessionStorage.setItem(syncKey, state.activeCase);
  }

  // Track product view on page load
  async function trackProductView() {
    // Check if we're on a product page
    if (!window.location.pathname.includes('/products/')) return;

    // Try to get product ID from meta tags or page data
    const productId = getProductId();
    if (!productId) {
      console.log('[A/B Test Tracker] No product ID found');
      return;
    }

    console.log('[A/B Test Tracker] Product page detected:', productId);

    // Fetch test state
    const state = await fetchTestState(productId);
    if (!state) {
      console.log('[A/B Test Tracker] No active test for this product');
      return;
    }

    // Store state
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));

    // Track impression
    await trackImpression(state);
  }

  // Get product ID from page
  function getProductId() {
    // Try meta tag
    const metaProduct = document.querySelector('meta[property="product:id"]');
    if (metaProduct) {
      return metaProduct.getAttribute('content');
    }

    // Try Shopify global
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      return 'gid://shopify/Product/' + window.ShopifyAnalytics.meta.product.id;
    }

    // Try from URL
    const match = window.location.pathname.match(/\\/products\\/([\w-]+)/);
    if (match) {
      // This is the handle, we'd need to convert to ID
      // For now, return null as we need the actual ID
      console.log('[A/B Test Tracker] Found product handle:', match[1]);
    }

    return null;
  }

  // Listen for add to cart events
  function listenForAddToCart() {
    // Intercept fetch requests to cart endpoints
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const [url, options] = args;

      if (typeof url === 'string' && url.includes('/cart/add')) {
        console.log('[A/B Test Tracker] Add to cart detected');

        const state = getTestState();
        if (state) {
          // Track add to cart
          trackEvent(state, 'ADD_TO_CART', {
            metadata: {
              cartUrl: url,
              method: options?.method || 'POST'
            }
          });
        }
      }

      return originalFetch.apply(this, args);
    };

    // Also listen for form submissions
    document.addEventListener('submit', function(e) {
      const form = e.target;
      if (form.action && form.action.includes('/cart/add')) {
        console.log('[A/B Test Tracker] Add to cart form submitted');

        const state = getTestState();
        if (state) {
          trackEvent(state, 'ADD_TO_CART', {
            metadata: {
              formAction: form.action
            }
          });
        }
      }
    });
  }

  // Initialize
  function init() {
    console.log('[A/B Test Tracker] Script loaded on:', window.location.href);

    // Track product view if on product page
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', trackProductView);
    } else {
      trackProductView();
    }

    // Listen for add to cart events
    listenForAddToCart();

    // Also track on route changes (for SPA)
    let lastUrl = window.location.href;
    new MutationObserver(() => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[A/B Test Tracker] Route changed:', currentUrl);
        trackProductView();
      }
    }).observe(document, { subtree: true, childList: true });
  }

  init();
})();
`;

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
};
