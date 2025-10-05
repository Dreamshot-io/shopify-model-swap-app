(function() {
  'use strict';

  // Debug mode - enabled via ?ab_debug=true URL parameter
  const DEBUG_MODE = window.location.search.includes('ab_debug=true');

  // Debug logging helper
  function debugLog(...args) {
    if (DEBUG_MODE) {
      console.log('[A/B Test Debug]', ...args);
    }
  }

  // Configuration
  const APP_PROXY_BASE = '/apps/model-swap';
  const SESSION_STORAGE_KEY = 'ab_test_session';
  const ACTIVE_TEST_KEY = 'ab_test_active';
  const MAX_RETRY_ATTEMPTS = 3;
  const RETRY_DELAY = 100;

  // Log script initialization
  console.log('[A/B Test] Script loaded and initialized', DEBUG_MODE ? '(debug mode ON)' : '');

  // Generate or retrieve session ID
  function getSessionId() {
    let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) {
      sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      debugLog('New session ID created:', sessionId);
    } else {
      debugLog('Existing session ID:', sessionId);
    }
    return sessionId;
  }

  // Detect product ID using multiple strategies
  function getProductId() {
    debugLog('Attempting product ID detection...');

    // Strategy 1: ShopifyAnalytics global
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product && window.ShopifyAnalytics.meta.product.gid) {
      const productId = window.ShopifyAnalytics.meta.product.gid;
      console.log('[A/B Test] Product ID detected:', productId, '(via ShopifyAnalytics)');
      return productId;
    }

    // Strategy 2: __st global object
    if (window.__st && window.__st.rid) {
      const productId = 'gid://shopify/Product/' + window.__st.rid;
      console.log('[A/B Test] Product ID detected:', productId, '(via __st)');
      return productId;
    }

    // Strategy 3: meta tags
    const productIdMeta = document.querySelector('meta[property="og:product:id"]');
    if (productIdMeta && productIdMeta.content) {
      const productId = 'gid://shopify/Product/' + productIdMeta.content;
      console.log('[A/B Test] Product ID detected:', productId, '(via meta tag)');
      return productId;
    }

    // Strategy 4: Cart form
    const productForm = document.querySelector('form[action*="/cart/add"]');
    if (productForm) {
      const productIdInput = productForm.querySelector('input[name="id"]');
      if (productIdInput && productIdInput.value) {
        // This is actually a variant ID, but we can try to use it
        const productId = 'gid://shopify/Product/' + productIdInput.value;
        console.log('[A/B Test] Product ID detected:', productId, '(via cart form - may be variant ID)');
        return productId;
      }
    }

    // Strategy 5: URL pattern
    const pathMatch = window.location.pathname.match(/\/products\/([^\/]+)/);
    if (pathMatch && pathMatch[1]) {
      // This is a handle, not an ID, but we'll return it as a fallback
      const productId = 'handle:' + pathMatch[1];
      console.log('[A/B Test] Product ID detected:', productId, '(via URL - handle only)');
      return productId;
    }

    console.warn('[A/B Test] Could not detect product ID using any strategy');
    debugLog('Available globals:', {
      ShopifyAnalytics: !!window.ShopifyAnalytics,
      __st: !!window.__st,
      metaTags: document.querySelectorAll('meta[property*="product"]').length
    });
    return null;
  }

  // Replace images with multiple selector strategies
  function replaceImages(imageUrls) {
    if (!imageUrls || !imageUrls.length) return false;

    // Comprehensive list of selectors for different themes
    const selectors = [
      // Dawn theme (default Shopify theme)
      '.product__media img',
      '.product__media-image-wrapper img',
      '.product-media-container img',

      // Debut theme (legacy)
      '.product-single__photo img',
      '.product-single__photo-wrapper img',
      '.product__main-photos img',

      // Brooklyn theme (OS 1.0)
      '.product__slides img',
      '.product__photo img',

      // Common custom theme patterns
      '.product-image img',
      '.product-images img',
      '.product-photo img',
      '.product-photos img',
      '.product-gallery img',
      '.product-slider img',
      '.main-product-image img',

      // Data attribute selectors
      '[data-product-image]',
      '[data-product-featured-image]',
      '[data-image-id] img',

      // Generic product selectors
      '.product img[src*="/products/"]',
      '.product-wrapper img',
      '.product-container img',

      // Slick slider
      '.slick-slide img',
      '.slick-track img',

      // Swiper
      '.swiper-slide img',

      // Flickity
      '.flickity-viewport img',

      // Generic gallery selectors
      '.gallery img',
      '.image-gallery img',
      '.product-thumbnails img'
    ];

    let replaced = 0;
    const processedImages = new Set();

    // Try each selector strategy
    selectors.forEach(selector => {
      try {
        const images = document.querySelectorAll(selector);
        images.forEach((img, index) => {
          // Skip if already processed
          if (processedImages.has(img)) return;

          if (index < imageUrls.length) {
            // Store original source
            if (!img.dataset.originalSrc) {
              img.dataset.originalSrc = img.src;
            }

            // Replace image source
            img.src = imageUrls[index];

            // Clear srcset to prevent browser from loading original responsive images
            if (img.srcset) {
              img.dataset.originalSrcset = img.srcset;
              img.srcset = '';
            }

            // Handle lazy loading attributes
            if (img.dataset.src) {
              img.dataset.originalDataSrc = img.dataset.src;
              img.dataset.src = imageUrls[index];
            }

            if (img.loading === 'lazy') {
              img.loading = 'eager'; // Force immediate loading
            }

            processedImages.add(img);
            replaced++;
          }
        });
      } catch (e) {
        // Silently handle selector errors
      }
    });

    // Handle lazy-loaded images that might appear later
    if (replaced > 0) {
      observeLazyImages(imageUrls);
    }

    return replaced > 0;
  }

  // Observe for lazy-loaded images
  function observeLazyImages(imageUrls) {
    if (!window.MutationObserver) return;

    let observerTimeout;
    const observer = new MutationObserver(function(mutations) {
      clearTimeout(observerTimeout);
      observerTimeout = setTimeout(function() {
        replaceImages(imageUrls);
      }, 50);
    });

    // Observe for a limited time (5 seconds)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src']
    });

    setTimeout(function() {
      observer.disconnect();
    }, 5000);
  }

  // Fetch variant assignment from app proxy
  async function fetchVariant(productId, attempt = 1) {
    const sessionId = getSessionId();
    const url = APP_PROXY_BASE + '/variant/' + encodeURIComponent(productId) + '?session=' + sessionId;

    debugLog('Fetching variant from:', url, 'Attempt:', attempt);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      debugLog('Response status:', response.status);

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const data = await response.json();
      debugLog('Variant data received:', data);
      return data;
    } catch (error) {
      // Retry logic with exponential backoff
      if (attempt < MAX_RETRY_ATTEMPTS) {
        debugLog('Retrying... attempt', attempt + 1);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
        return fetchVariant(productId, attempt + 1);
      }

      console.error('[A/B Test] Failed to fetch variant after', MAX_RETRY_ATTEMPTS, 'attempts:', error);
      return null;
    }
  }

  // Main initialization
  async function init() {
    console.log('[A/B Test] Initializing on page:', window.location.pathname);

    // Check if we're on a product page
    if (!window.location.pathname.includes('/products/')) {
      debugLog('Not a product page, skipping A/B test');
      return;
    }

    const productId = getProductId();
    if (!productId) {
      // Error already logged in getProductId()
      return;
    }

    try {
      const data = await fetchVariant(productId);

      if (data && data.variant && data.imageUrls && data.testId) {
        console.log('[A/B Test] Active test found:', data.testId, 'Variant:', data.variant, 'Images:', data.imageUrls.length);

        const success = replaceImages(data.imageUrls);

        if (success) {
          // Store test information for tracking (Web Pixels will use this)
          sessionStorage.setItem(ACTIVE_TEST_KEY, JSON.stringify({
            testId: data.testId,
            variant: data.variant,
            productId: productId
          }));

          console.log('[A/B Test] ✅ Images replaced successfully');
        } else {
          console.warn('[A/B Test] ⚠️ Failed to replace images - selectors may not match theme');
          debugLog('Image URLs attempted:', data.imageUrls);
        }
      } else {
        console.log('[A/B Test] No active test for this product');
        debugLog('API response:', data);
      }
    } catch (error) {
      console.error('[A/B Test] ❌ Initialization failed:', error);
    }
  }

  // Wait for DOM and start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded, but wait a tick for other scripts
    setTimeout(init, 0);
  }

  // Also try on window load for images that load late
  window.addEventListener('load', function() {
    const testData = sessionStorage.getItem(ACTIVE_TEST_KEY);
    if (testData) {
      try {
        const data = JSON.parse(testData);
        // Re-apply images in case some loaded late
        setTimeout(function() {
          const productId = getProductId();
          if (productId === data.productId) {
            fetchVariant(productId).then(function(variantData) {
              if (variantData && variantData.imageUrls) {
                replaceImages(variantData.imageUrls);
              }
            });
          }
        }, 100);
      } catch (e) {
        // Ignore parse errors
      }
    }
  });

})();