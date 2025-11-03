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

  function getCurrentVariantId() {
    // 1. Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const urlVariant = urlParams.get('variant');
    if (urlVariant) {
      return urlVariant;
    }
    
    // 2. Check form input (most reliable for current selection)
    const variantInput = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (variantInput && variantInput.value) {
      return variantInput.value;
    }
    
    // 3. Check Shopify global objects
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.selectedVariantId) {
      return window.ShopifyAnalytics.meta.selectedVariantId.toString();
    }
    
    // 4. Check theme globals
    if (window.theme && window.theme.product && window.theme.product.selected_variant) {
      return window.theme.product.selected_variant.toString();
    }
    
    return null;
  }

  function watchVariantChanges(callback) {
    let currentVariantId = getCurrentVariantId();
    
    // Check for changes periodically
    const checkInterval = setInterval(() => {
      const newVariantId = getCurrentVariantId();
      if (newVariantId && newVariantId !== currentVariantId) {
        currentVariantId = newVariantId;
        console.log('[A/B Test] Variant changed to:', newVariantId);
        callback(newVariantId);
      }
    }, 500);
    
    // Also listen for form changes
    document.addEventListener('change', function(e) {
      if (e.target.name === 'id' || e.target.matches('[data-variant-selector]')) {
        setTimeout(() => {
          const newVariantId = getCurrentVariantId();
          if (newVariantId && newVariantId !== currentVariantId) {
            currentVariantId = newVariantId;
            console.log('[A/B Test] Variant changed via form:', newVariantId);
            callback(newVariantId);
          }
        }, 100);
      }
    });
    
    // Listen for common theme events
    const variantEvents = ['variant:change', 'variant-change', 'variantChange'];
    variantEvents.forEach(eventName => {
      document.addEventListener(eventName, function(e) {
        const variantId = e.detail?.variant?.id || e.detail?.id || e.detail?.variantId;
        if (variantId && variantId !== currentVariantId) {
          currentVariantId = variantId.toString();
          console.log('[A/B Test] Variant changed via event:', currentVariantId);
          callback(currentVariantId);
        }
      });
    });
    
    return () => clearInterval(checkInterval);
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

  function fetchAndApplyVariant(productId, variantId) {
    const sessionId = getSessionId();
    let url = `${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`;
    
    if (variantId) {
      url += `&variantId=${encodeURIComponent(variantId)}`;
      console.log('[A/B Test] Fetching with variantId:', variantId);
    }
    
    return fetch(url)
      .then(response => response.json())
      .then(data => {
        if (data.variant && data.imageUrls && data.testId) {
          console.log(`[A/B Test] Running test ${data.testId}, variant ${data.variant}`);
          
          // Replace product images
          const success = replaceProductImages(data.imageUrls);
          
          if (success) {
            // Track impression (only on first load, not on variant changes)
            if (!sessionStorage.getItem('ab_test_active')) {
              trackEvent(data.testId, 'IMPRESSION');
            }
            
            // Setup conversion tracking
            setupAddToCartTracking(data.testId);
            
            // Store test info for potential purchase tracking
            sessionStorage.setItem('ab_test_active', JSON.stringify({
              testId: data.testId,
              variant: data.variant,
              productId: productId,
              variantId: variantId
            }));
            
            return true;
          }
        } else if (data.variant === null) {
          console.log('[A/B Test] No active test for this product/variant');
        } else {
          console.log('[A/B Test] Invalid response from variant endpoint');
        }
        return false;
      })
      .catch(error => {
        console.error('[A/B Test] Failed to fetch variant:', error);
        return false;
      });
  }

  function initABTest() {
    const productId = getProductId();
    if (!productId) {
      console.log('[A/B Test] No product ID found, skipping A/B test');
      return;
    }

    // Get initial variant ID
    const initialVariantId = getCurrentVariantId();
    
    // Fetch and apply initial variant
    fetchAndApplyVariant(productId, initialVariantId).then(success => {
      if (success) {
        // Watch for variant changes
        watchVariantChanges((newVariantId) => {
          console.log('[A/B Test] Variant changed, fetching new images');
          fetchAndApplyVariant(productId, newVariantId);
        });
      }
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