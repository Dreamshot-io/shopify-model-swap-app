# Shopify Variant Selection Events Reference

## Overview
This document details methods for detecting variant selection changes in Shopify storefronts across different themes and implementations.

## Standard Detection Methods

### 1. URL Parameter Monitoring
Most Shopify themes update the URL when a variant is selected:
```javascript
// Monitor URL for variant parameter
function watchUrlForVariant() {
  let currentVariant = new URLSearchParams(window.location.search).get('variant');
  
  // Use MutationObserver for pushState/replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    checkVariantChange();
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    checkVariantChange();
  };
  
  window.addEventListener('popstate', checkVariantChange);
  
  function checkVariantChange() {
    const newVariant = new URLSearchParams(window.location.search).get('variant');
    if (newVariant !== currentVariant) {
      currentVariant = newVariant;
      handleVariantChange(newVariant);
    }
  }
}
```

### 2. Form Input Monitoring
Variant selectors typically use a hidden input field:
```javascript
// Monitor variant selector form inputs
function watchVariantFormInputs() {
  // Primary variant input
  const variantInput = document.querySelector('[name="id"]');
  if (variantInput) {
    variantInput.addEventListener('change', (e) => {
      handleVariantChange(e.target.value);
    });
  }
  
  // Option selectors (dropdowns, radio buttons)
  const optionSelectors = document.querySelectorAll('.variant-selector, [data-variant-selector]');
  optionSelectors.forEach(selector => {
    selector.addEventListener('change', () => {
      // Get selected variant from form
      const form = selector.closest('form');
      const variantId = form?.querySelector('[name="id"]')?.value;
      if (variantId) handleVariantChange(variantId);
    });
  });
}
```

### 3. Shopify Global Objects
Some themes expose variant data through global objects:
```javascript
// Access current variant through Shopify globals
function getCurrentVariantFromGlobals() {
  // Method 1: ShopifyAnalytics
  if (window.ShopifyAnalytics?.meta?.selectedVariantId) {
    return window.ShopifyAnalytics.meta.selectedVariantId;
  }
  
  // Method 2: Theme global
  if (window.theme?.product?.variants?.selected) {
    return window.theme.product.variants.selected.id;
  }
  
  // Method 3: Product global
  if (window.product?.selected_variant) {
    return window.product.selected_variant;
  }
  
  return null;
}
```

### 4. Custom Theme Events
Many themes dispatch custom events:
```javascript
// Listen for theme-specific events
function listenForThemeEvents() {
  // Dawn theme
  document.addEventListener('variant:change', (e) => {
    handleVariantChange(e.detail.variant.id);
  });
  
  // Debut theme
  document.addEventListener('variant-change', (e) => {
    handleVariantChange(e.detail.variant.id);
  });
  
  // Generic variant update event
  document.addEventListener('variantUpdate', (e) => {
    handleVariantChange(e.detail.id || e.detail.variantId);
  });
}
```

### 5. DOM Mutation Observer
Fallback method for themes without events:
```javascript
// Watch for DOM changes that indicate variant switch
function watchDomForVariantChanges() {
  const observer = new MutationObserver((mutations) => {
    // Check if price changed (common indicator)
    const priceElement = document.querySelector('[data-price], .product__price');
    if (priceElement) {
      const currentPrice = priceElement.textContent;
      if (currentPrice !== lastKnownPrice) {
        lastKnownPrice = currentPrice;
        // Price changed, check for variant change
        const variantId = getCurrentVariant();
        if (variantId !== lastVariantId) {
          lastVariantId = variantId;
          handleVariantChange(variantId);
        }
      }
    }
    
    // Check if variant image changed
    const mainImage = document.querySelector('.product__main-image img');
    if (mainImage && mainImage.src !== lastImageSrc) {
      lastImageSrc = mainImage.src;
      checkForVariantChange();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data-variant-id']
  });
}
```

## Universal Detection Strategy

```javascript
class VariantDetector {
  constructor(callback) {
    this.callback = callback;
    this.currentVariant = null;
    this.detectionMethods = [];
    
    this.init();
  }
  
  init() {
    // Try all detection methods
    this.watchUrl();
    this.watchFormInputs();
    this.watchThemeEvents();
    this.watchDomChanges();
    this.pollForChanges(); // Fallback
  }
  
  watchUrl() {
    // URL monitoring implementation
    let lastVariant = this.getVariantFromUrl();
    
    const checkUrl = () => {
      const variant = this.getVariantFromUrl();
      if (variant !== lastVariant) {
        lastVariant = variant;
        this.onVariantChange(variant);
      }
    };
    
    // Monitor history changes
    ['pushState', 'replaceState'].forEach(method => {
      const original = history[method];
      history[method] = function() {
        original.apply(history, arguments);
        setTimeout(checkUrl, 0);
      };
    });
    
    window.addEventListener('popstate', checkUrl);
  }
  
  watchFormInputs() {
    // Delegate to catch dynamically added elements
    document.addEventListener('change', (e) => {
      if (e.target.matches('[name="id"], .variant-selector, [data-variant-selector]')) {
        const form = e.target.closest('form');
        const variantInput = form?.querySelector('[name="id"]');
        if (variantInput) {
          this.onVariantChange(variantInput.value);
        }
      }
    });
  }
  
  watchThemeEvents() {
    // Common theme events
    const events = [
      'variant:change',
      'variant-change',
      'variantChange',
      'variant.change',
      'product:variant-change'
    ];
    
    events.forEach(eventName => {
      document.addEventListener(eventName, (e) => {
        const variantId = e.detail?.variant?.id || 
                         e.detail?.id || 
                         e.detail?.variantId ||
                         e.detail;
        if (variantId) {
          this.onVariantChange(variantId);
        }
      });
    });
  }
  
  watchDomChanges() {
    // Minimal DOM observation
    const targetNode = document.querySelector('.product-single, .product, [data-product]');
    if (!targetNode) return;
    
    const observer = new MutationObserver(() => {
      this.checkCurrentVariant();
    });
    
    observer.observe(targetNode, {
      attributes: true,
      attributeFilter: ['data-variant', 'data-variant-id'],
      childList: true,
      subtree: true
    });
  }
  
  pollForChanges() {
    // Last resort - poll every 500ms
    setInterval(() => {
      this.checkCurrentVariant();
    }, 500);
  }
  
  checkCurrentVariant() {
    const variant = this.getCurrentVariant();
    if (variant && variant !== this.currentVariant) {
      this.onVariantChange(variant);
    }
  }
  
  getCurrentVariant() {
    // Try multiple sources
    return this.getVariantFromUrl() ||
           this.getVariantFromForm() ||
           this.getVariantFromGlobals() ||
           this.getVariantFromDom();
  }
  
  getVariantFromUrl() {
    return new URLSearchParams(window.location.search).get('variant');
  }
  
  getVariantFromForm() {
    return document.querySelector('form[action*="/cart/add"] [name="id"]')?.value;
  }
  
  getVariantFromGlobals() {
    return window.ShopifyAnalytics?.meta?.selectedVariantId ||
           window.theme?.product?.selected_variant?.id ||
           window.product?.selected_variant;
  }
  
  getVariantFromDom() {
    return document.querySelector('[data-variant-id]')?.dataset.variantId ||
           document.querySelector('.product')?.dataset.selectedVariant;
  }
  
  onVariantChange(variantId) {
    if (variantId && variantId !== this.currentVariant) {
      this.currentVariant = variantId;
      console.log('[Variant Detector] Variant changed to:', variantId);
      this.callback(variantId);
    }
  }
}

// Usage
const detector = new VariantDetector((variantId) => {
  console.log('Variant selected:', variantId);
  // Fetch and update images for this variant
  updateImagesForVariant(variantId);
});
```

## Theme-Specific Implementations

### Dawn (Shopify's Reference Theme)
```javascript
// Dawn dispatches a custom event
document.addEventListener('variant:change', (event) => {
  const variant = event.detail.variant;
  console.log('Dawn variant changed:', variant.id);
});
```

### Debut
```javascript
// Debut uses a different event name
document.addEventListener('variant-change', (event) => {
  const variantId = event.detail.variant.id;
  console.log('Debut variant changed:', variantId);
});
```

### Brooklyn
```javascript
// Brooklyn updates a global object
if (window.theme && window.theme.updateVariant) {
  const original = window.theme.updateVariant;
  window.theme.updateVariant = function(variant) {
    original.call(this, variant);
    console.log('Brooklyn variant changed:', variant.id);
  };
}
```

### Custom Themes
```javascript
// For custom themes, combine multiple strategies
function setupCustomThemeDetection() {
  // 1. Try to hook into theme's variant selection function
  if (window.selectVariant) {
    const original = window.selectVariant;
    window.selectVariant = function(variant) {
      const result = original.apply(this, arguments);
      handleVariantChange(variant);
      return result;
    };
  }
  
  // 2. Monitor option dropdowns/swatches
  document.querySelectorAll('.product-option, .swatch, [data-option-selector]')
    .forEach(element => {
      element.addEventListener('click', () => {
        setTimeout(() => {
          const variantId = getCurrentVariant();
          handleVariantChange(variantId);
        }, 100);
      });
    });
}
```

## Testing Variant Detection

```javascript
// Test function to verify variant detection
function testVariantDetection() {
  console.log('=== Variant Detection Test ===');
  
  // Check URL
  const urlVariant = new URLSearchParams(window.location.search).get('variant');
  console.log('URL variant:', urlVariant);
  
  // Check form
  const formVariant = document.querySelector('[name="id"]')?.value;
  console.log('Form variant:', formVariant);
  
  // Check globals
  console.log('ShopifyAnalytics:', window.ShopifyAnalytics?.meta?.selectedVariantId);
  console.log('Theme global:', window.theme?.product?.selected_variant);
  console.log('Product global:', window.product?.selected_variant);
  
  // Check DOM
  const domElements = document.querySelectorAll('[data-variant-id], [data-variant]');
  console.log('DOM elements with variant data:', domElements.length);
  
  console.log('=== End Test ===');
}

// Run test
testVariantDetection();
```

## Performance Considerations

1. **Debounce rapid changes**: Some themes fire multiple events during variant selection
2. **Cache variant data**: Store fetched variant images to avoid redundant API calls
3. **Lazy load images**: Only load images for selected variant
4. **Use requestAnimationFrame**: For smooth visual transitions

```javascript
// Debounced variant handler
const handleVariantChange = debounce((variantId) => {
  requestAnimationFrame(() => {
    updateImagesForVariant(variantId);
  });
}, 100);

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
```

## Troubleshooting

### Common Issues:
1. **Events not firing**: Theme may use proprietary event system
2. **Variant ID format**: Some themes use numeric IDs, others use full GIDs
3. **Timing issues**: Variant change may happen before DOM updates
4. **Multiple triggers**: Single selection may fire multiple events

### Debug Helper:
```javascript
// Enable debug mode to log all variant-related activity
window.DEBUG_VARIANTS = true;

if (window.DEBUG_VARIANTS) {
  // Log all events
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type.toLowerCase().includes('variant')) {
      console.log('[Debug] Event listener added:', type);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
  
  // Log all mutations
  new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.target.dataset?.variant || 
          mutation.target.dataset?.variantId ||
          mutation.attributeName?.includes('variant')) {
        console.log('[Debug] Variant-related mutation:', mutation);
      }
    });
  }).observe(document.body, {
    attributes: true,
    childList: true,
    subtree: true
  });
}
```
