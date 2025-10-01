(function() {
  'use strict';

  // Configuration
  const APP_PROXY_BASE = '/apps/model-swap';
  const SESSION_STORAGE_KEY = 'ab_test_session';
  
  // Utility functions
  function generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
  }

  function getSessionId() {
    let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!sessionId) {
      sessionId = generateSessionId();
      localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    }
    return sessionId;
  }

  function getProductId() {
    // Try multiple methods to get product ID
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      return window.ShopifyAnalytics.meta.product.gid;
    }
    
    // Fallback: check for product form
    const productForm = document.querySelector('form[action*="/cart/add"]');
    if (productForm) {
      const productIdInput = productForm.querySelector('input[name="id"]');
      if (productIdInput) {
        return 'gid://shopify/Product/' + productIdInput.value;
      }
    }

    // Fallback: check for product data in script tags
    const productScripts = document.querySelectorAll('script[type="application/json"]');
    for (const script of productScripts) {
      try {
        const data = JSON.parse(script.textContent);
        if (data.id && (data.type === 'product' || data.product_type)) {
          return 'gid://shopify/Product/' + data.id;
        }
      } catch (e) {
        // Continue searching
      }
    }

    return null;
  }

  function replaceProductImages(imageUrls) {
    // Find main product image containers
    const imageSelectors = [
      '.product__media img',
      '.product-single__photo img', 
      '.product-image img',
      '.product-photos img',
      '[data-product-image]',
      '.product__photo img'
    ];

    let imagesReplaced = 0;
    
    imageSelectors.forEach(selector => {
      const images = document.querySelectorAll(selector);
      images.forEach((img, index) => {
        if (index < imageUrls.length) {
          // Store original src for fallback
          if (!img.dataset.originalSrc) {
            img.dataset.originalSrc = img.src;
          }
          
          // Replace with A/B test variant
          img.src = imageUrls[index];
          img.srcset = ''; // Clear srcset to prevent conflicts
          imagesReplaced++;
        }
      });
    });

    // Also try to replace featured images in galleries/sliders
    const galleryImages = document.querySelectorAll('.product-gallery img, .product-slider img');
    galleryImages.forEach((img, index) => {
      if (index < imageUrls.length) {
        if (!img.dataset.originalSrc) {
          img.dataset.originalSrc = img.src;
        }
        img.src = imageUrls[index];
        img.srcset = '';
        imagesReplaced++;
      }
    });

    console.log(`[A/B Test] Replaced ${imagesReplaced} product images`);
    return imagesReplaced > 0;
  }

  function trackEvent(testId, eventType, revenue = null) {
    const sessionId = getSessionId();
    const productId = getProductId();
    
    if (!testId || !productId) return;

    fetch(`${APP_PROXY_BASE}/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        testId,
        sessionId,
        eventType,
        productId,
        revenue
      })
    }).catch(error => {
      console.error('[A/B Test] Failed to track event:', error);
    });
  }

  function setupAddToCartTracking(testId) {
    // Track add to cart events
    const addToCartForms = document.querySelectorAll('form[action*="/cart/add"]');
    
    addToCartForms.forEach(form => {
      form.addEventListener('submit', function(e) {
        trackEvent(testId, 'ADD_TO_CART');
      });
    });

    // Track AJAX add to cart (common pattern)
    const addToCartButtons = document.querySelectorAll('.btn--add-to-cart, [data-add-to-cart], .add-to-cart, .product-form__cart-submit');
    
    addToCartButtons.forEach(button => {
      button.addEventListener('click', function(e) {
        // Small delay to ensure the click is processed
        setTimeout(() => {
          trackEvent(testId, 'ADD_TO_CART');
        }, 100);
      });
    });
  }

  function initABTest() {
    const productId = getProductId();
    if (!productId) {
      console.log('[A/B Test] No product ID found, skipping A/B test');
      return;
    }

    const sessionId = getSessionId();
    
    // Fetch variant for this user/product combination
    fetch(`${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`)
      .then(response => response.json())
      .then(data => {
        if (data.variant && data.imageUrls && data.testId) {
          console.log(`[A/B Test] Running test ${data.testId}, variant ${data.variant}`);
          
          // Replace product images
          const success = replaceProductImages(data.imageUrls);
          
          if (success) {
            // Track impression
            trackEvent(data.testId, 'IMPRESSION');
            
            // Setup conversion tracking
            setupAddToCartTracking(data.testId);
            
            // Store test info for potential purchase tracking
            sessionStorage.setItem('ab_test_active', JSON.stringify({
              testId: data.testId,
              variant: data.variant,
              productId: productId
            }));
          }
        } else if (data.variant === null) {
          console.log('[A/B Test] No active test for this product');
        } else {
          console.log('[A/B Test] Invalid response from variant endpoint');
        }
      })
      .catch(error => {
        console.error('[A/B Test] Failed to fetch variant:', error);
      });
  }

  // Initialize A/B test when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initABTest);
  } else {
    // DOM is already loaded
    initABTest();
  }

  // Track purchases on checkout completion (if on thank you page)
  if (window.location.pathname.includes('/thank_you') || window.location.pathname.includes('/orders/')) {
    const testData = sessionStorage.getItem('ab_test_active');
    if (testData) {
      try {
        const { testId } = JSON.parse(testData);
        
        // Try to extract order value from Shopify analytics
        let revenue = null;
        if (window.Shopify && window.Shopify.checkout) {
          revenue = window.Shopify.checkout.total_price / 100; // Convert from cents
        }
        
        trackEvent(testId, 'PURCHASE', revenue);
        sessionStorage.removeItem('ab_test_active');
      } catch (e) {
        console.error('[A/B Test] Error processing purchase tracking:', e);
      }
    }
  }

})();