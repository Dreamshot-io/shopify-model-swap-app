(function () {
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
	const SESSION_METADATA_KEY = 'ab_test_session_meta';
	const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
	const ACTIVE_TEST_KEY = 'ab_test_active';
	const CART_ATC_KEY_PREFIX = 'ab_test_atc_sent_';
	const CART_FALLBACK_SENT_FLAG = 'ab_test_atc_fallback_sent';
	const CART_ATTRIBUTE_SYNC_PREFIX = 'ab_test_cart_attr_synced_';
	const AB_PROPERTY_KEY = 'ModelSwapAB';
	const MAX_RETRY_ATTEMPTS = 3;
	const RETRY_DELAY = 100;

	// Re-entry guard to prevent infinite loops
	let isReplacingImages = false;
	const processedImageUrls = new Set();

	// Theme detection and configuration
	const THEME_CONFIGS = {
		'dawn': {
			name: 'Dawn',
			detection: {
				selectors: ['.product__media-list', '#MainProduct', '[data-section="main-product"]'],
				htmlPatterns: ['product__media-list', 'MainProduct', 'data-section="main-product"'],
				metaTags: []
			},
			selectors: {
				gallery: ['.product__media-list', 'ul.product__media-list'],
				items: ['.product__media-item', 'li.product__media-item'],
				images: ['.product__media img', '.product__media-item img'],
				wrappers: ['.product__media-item', '.product__media-wrapper'],
				mainContainer: ['media-gallery', '.product__column-sticky']
			},
			hideStrategy: 'item', // 'item' | 'image' | 'both'
			hideMethod: 'display' // 'display' | 'visibility' | 'remove'
		},
		'horizon': {
			name: 'Horizon',
			detection: {
				selectors: ['.product-media-gallery', '[data-product-media-gallery]'],
				htmlPatterns: ['product-media-gallery', 'data-product-media-gallery'],
				metaTags: []
			},
			selectors: {
				gallery: ['.product-media-gallery', '.product__media-list'],
				items: ['.product-media-item', '.product__media-item-wrapper'],
				images: ['.product-media-gallery img'],
				wrappers: ['.product-media-item'],
				mainContainer: ['.product-media-gallery']
			},
			hideStrategy: 'item',
			hideMethod: 'display'
		},
		'debut': {
			name: 'Debut',
			detection: {
				selectors: ['.product-single__photos', '#ProductPhoto'],
				htmlPatterns: ['product-single__photos', 'ProductPhoto'],
				metaTags: []
			},
			selectors: {
				gallery: ['.product-single__photos', '.product__main-photos'],
				items: ['.product-single__photo', '.product-single__photo-wrapper'],
				images: ['.product-single__photo img'],
				wrappers: ['.product-single__photo-wrapper'],
				mainContainer: ['.product-single__photos']
			},
			hideStrategy: 'item',
			hideMethod: 'visibility'
		},
		'brooklyn': {
			name: 'Brooklyn',
			detection: {
				selectors: ['.product__slides', '.product__slide'],
				htmlPatterns: ['product__slides', 'product__slide'],
				metaTags: []
			},
			selectors: {
				gallery: ['.product__slides'],
				items: ['.product__slide'],
				images: ['.product__slide img'],
				wrappers: ['.product__slide'],
				mainContainer: ['.product__slides']
			},
			hideStrategy: 'item',
			hideMethod: 'display'
		},
		'prestige': {
			name: 'Prestige',
			detection: {
				selectors: ['.Product__Gallery', '.Product__SlideItem'],
				htmlPatterns: ['Product__Gallery', 'Product__SlideItem'],
				metaTags: []
			},
			selectors: {
				gallery: ['.Product__Gallery', '.Product__Slideshow'],
				items: ['.Product__SlideItem'],
				images: ['.Product__SlideItem img', '.Image--lazyLoad'],
				wrappers: ['.Product__SlideItem'],
				mainContainer: ['.Product__Gallery']
			},
			hideStrategy: 'item',
			hideMethod: 'display'
		},
		'impulse': {
			name: 'Impulse',
			detection: {
				selectors: ['.product__photos', '.product__photo'],
				htmlPatterns: ['product__photos', 'product__photo'],
				metaTags: []
			},
			selectors: {
				gallery: ['.product__photos'],
				items: ['.product__photo'],
				images: ['.product__photo img'],
				wrappers: ['.product__photo'],
				mainContainer: ['.product__photos']
			},
			hideStrategy: 'item',
			hideMethod: 'display'
		}
	};

	// Detected theme cache
	let detectedTheme = null;
	let themeConfig = null;

	// Theme detection function
	function detectTheme() {
		if (detectedTheme) return detectedTheme;

		console.log('[A/B Test] Starting theme detection...');

		// Check each theme configuration
		for (const [themeKey, config] of Object.entries(THEME_CONFIGS)) {
			// Check CSS selectors
			for (const selector of config.detection.selectors) {
				if (document.querySelector(selector)) {
					console.log(`[A/B Test] Theme detected: ${config.name} (via selector: ${selector})`);
					detectedTheme = themeKey;
					themeConfig = config;
					return themeKey;
				}
			}

			// Check HTML patterns in page source
			const pageHTML = document.documentElement.innerHTML.substring(0, 10000); // Check first 10KB
			for (const pattern of config.detection.htmlPatterns) {
				if (pageHTML.includes(pattern)) {
					console.log(`[A/B Test] Theme detected: ${config.name} (via HTML pattern: ${pattern})`);
					detectedTheme = themeKey;
					themeConfig = config;
					return themeKey;
				}
			}
		}

		console.log('[A/B Test] No specific theme detected, using adaptive fallback');
		detectedTheme = 'default';
		themeConfig = null;
		return 'default';
	}

	// Enhanced gallery finding with theme-specific logic
	function findGalleryContainer() {
		const theme = detectTheme();
		
		// If we have a theme config, try theme-specific selectors first
		if (themeConfig) {
			debugLog('Using theme-specific selectors for:', themeConfig.name);
			
			// Try gallery selectors
			for (const selector of themeConfig.selectors.gallery) {
				const container = document.querySelector(selector);
				if (container) {
					// Look for images within items or directly
					let images = [];
					
					// First try to find structured items
					if (themeConfig.selectors.items) {
						const items = container.querySelectorAll(themeConfig.selectors.items.join(','));
						if (items.length > 0) {
							items.forEach(item => {
								const img = item.querySelector('img');
								if (img) {
									images.push(img);
									// Mark the item for easier hiding later
									item.setAttribute('data-ab-gallery-item', 'true');
								}
							});
						}
					}
					
					// If no items found, get all images
					if (images.length === 0) {
						images = Array.from(container.querySelectorAll('img'));
					}
					
					if (images.length >= 2) {
						console.log(`[A/B Test] Found gallery via theme selector (${themeConfig.name}):`, selector, 'with', images.length, 'images');
						return { 
							container, 
							images,
							theme: themeConfig.name,
							method: 'theme-specific'
						};
					}
				}
			}
		}

		// Fallback to adaptive detection
		return findGalleryContainerAdaptive();
	}

	// Adaptive gallery detection (theme-agnostic)
	function findGalleryContainerAdaptive() {
		debugLog('Using adaptive gallery detection');
		
		// Common gallery patterns
		const gallerySelectors = [
			// Generic patterns
			'[class*="product"][class*="media"][class*="list"]',
			'[class*="product"][class*="gallery"]',
			'[class*="product"][class*="images"]',
			'[class*="product"][class*="photos"]',
			'[class*="product"][class*="slides"]',
			
			// Data attributes
			'[data-product-images]',
			'[data-product-gallery]',
			'[data-media-gallery]',
			
			// Component patterns
			'media-gallery',
			'product-gallery',
			'slider-component',
			
			// List patterns
			'ul[class*="product"]',
			'div[class*="swiper"]',
			'div[class*="slider"]'
		];

		for (const selector of gallerySelectors) {
			try {
				const containers = document.querySelectorAll(selector);
				for (const container of containers) {
					const images = container.querySelectorAll('img');
					if (images.length >= 2) {
						// Check if images are product images
						const productImages = Array.from(images).filter(img => {
							const src = img.src || img.dataset.src || '';
							return src.includes('/products/') || src.includes('cdn.shopify.com');
						});
						
						if (productImages.length >= 2) {
							debugLog('Found gallery via adaptive selector:', selector, 'with', productImages.length, 'images');
							
							// Try to identify items
							const items = container.children;
							if (items.length > 0) {
								Array.from(items).forEach(item => {
									if (item.querySelector('img')) {
										item.setAttribute('data-ab-gallery-item', 'true');
									}
								});
							}
							
							return { 
								container, 
								images: productImages,
								theme: 'adaptive',
								method: 'adaptive'
							};
						}
					}
				}
			} catch (e) {
				// Ignore selector errors
			}
		}

		// Final fallback: find common parent of product images
		return findCommonParentGallery();
	}

	// Find common parent of product images
	function findCommonParentGallery() {
		const allImages = Array.from(document.querySelectorAll('img'));
		const productImages = allImages.filter(img => {
			const src = img.src || img.dataset.src || '';
			return src.includes('/products/') || src.includes('cdn.shopify.com');
		});

		if (productImages.length >= 2) {
			// Find common parent
			let commonParent = productImages[0].parentElement;
			let depth = 0;
			const maxDepth = 5;

			while (commonParent && depth < maxDepth) {
				const imagesInParent = commonParent.querySelectorAll('img');
				if (imagesInParent.length >= productImages.length * 0.8) {
					debugLog('Found gallery via common parent with', imagesInParent.length, 'images');
					
					// Mark potential items
					const children = commonParent.children;
					Array.from(children).forEach(child => {
						if (child.querySelector('img')) {
							child.setAttribute('data-ab-gallery-item', 'true');
						}
					});
					
					return { 
						container: commonParent, 
						images: Array.from(imagesInParent),
						theme: 'common-parent',
						method: 'common-parent'
					};
				}
				commonParent = commonParent.parentElement;
				depth++;
			}
		}

		debugLog('No gallery container found');
		return null;
	}

	// Enhanced image hiding with theme awareness
	function hideImage(img, index) {
		if (!img) return;
		
		const theme = detectTheme();
		
		// Mark as hidden
		img.dataset.abTestHidden = 'true';
		img.dataset.abTestIndex = index;
		
		// Find the item container
		let itemToHide = null;
		
		// First check if there's a marked gallery item
		itemToHide = img.closest('[data-ab-gallery-item]');
		
		// If not, try theme-specific item selectors
		if (!itemToHide && themeConfig && themeConfig.selectors.items) {
			itemToHide = img.closest(themeConfig.selectors.items.join(','));
		}
		
		// If still not found, try generic patterns
		if (!itemToHide) {
			itemToHide = img.closest('li, .slide, [class*="item"], [class*="slide"]');
		}
		
		// Decide what to hide based on theme config
		const hideStrategy = themeConfig?.hideStrategy || 'both';
		const hideMethod = themeConfig?.hideMethod || 'display';
		
		// Apply hiding
		if (itemToHide && hideStrategy !== 'image') {
			// Hide the item container
			applyHideMethod(itemToHide, hideMethod);
			itemToHide.dataset.abTestHidden = 'true';
			debugLog(`Hiding item container for image ${index}`);
		}
		
		if (hideStrategy !== 'item') {
			// Also hide the image itself
			applyHideMethod(img, hideMethod);
			debugLog(`Hiding image ${index}`);
		}
	}

	// Apply hiding method
	function applyHideMethod(element, method) {
		switch (method) {
			case 'remove':
				element.remove();
				break;
			case 'visibility':
				element.style.visibility = 'hidden';
				element.style.position = 'absolute';
				element.style.left = '-9999px';
				break;
			case 'display':
			default:
				element.style.display = 'none';
				break;
		}
	}

	// Enhanced image replacement
	function replaceImageSrc(img, newSrc, index) {
		if (!img) return;
		
		// Store original source
		if (!img.dataset.originalSrc) {
			img.dataset.originalSrc = img.src;
		}
		
		// Replace image source
		img.src = newSrc;
		
		// Clear srcset to prevent browser from loading original responsive images
		if (img.srcset) {
			img.dataset.originalSrcset = img.srcset;
			img.srcset = '';
		}
		
		// Handle lazy loading attributes
		if (img.dataset.src) {
			img.dataset.originalDataSrc = img.dataset.src;
			img.dataset.src = newSrc;
		}
		
		if (img.loading === 'lazy') {
			img.loading = 'eager';
		}
		
		// Ensure visibility
		img.style.display = '';
		img.style.visibility = '';
		img.dataset.abTestReplaced = 'true';
		img.dataset.abTestIndex = index;
		
		// Ensure parent item is visible if it exists
		const item = img.closest('[data-ab-gallery-item]');
		if (item) {
			item.style.display = '';
			item.style.visibility = '';
			item.dataset.abTestVisible = 'true';
		}
		
		debugLog(`Replaced image ${index} with variant image`);
	}

	// Main image replacement function
	function replaceImages(imageUrls, variantId) {
		if (!imageUrls || !imageUrls.length) return false;
		
		// Prevent re-entry
		if (isReplacingImages) {
			debugLog('Already replacing images, skipping');
			return false;
		}
		
		// Check if already processed
		const urlKey = imageUrls.join('|');
		if (processedImageUrls.has(urlKey)) {
			debugLog('Already processed these URLs');
			return true;
		}
		
		isReplacingImages = true;
		processedImageUrls.add(urlKey);
		
		try {
			const theme = detectTheme();
			console.log(`[A/B Test] Replacing images for theme: ${theme}`);
			
			let replaced = 0;
			let hidden = 0;
			
			// Find gallery
			const gallery = findGalleryContainer();
			
			if (gallery && gallery.images.length > 0) {
				console.log(`[A/B Test] Found gallery (${gallery.method}) with ${gallery.images.length} images`);
				
				// Process images
				gallery.images.forEach((img, index) => {
					if (index < imageUrls.length) {
						replaceImageSrc(img, imageUrls[index], index);
						replaced++;
					} else {
						hideImage(img, index);
						hidden++;
					}
				});
				
				console.log(`[A/B Test] Replacement complete: ${replaced} replaced, ${hidden} hidden`);
				
				// Clean up empty containers
				cleanupEmptyContainers();
				
				return replaced > 0;
			} else {
				console.warn('[A/B Test] No gallery found, trying direct image replacement');
				
				// Fallback: replace visible product images
				const productImages = Array.from(document.querySelectorAll('img')).filter(img => {
					const src = img.src || img.dataset.src || '';
					return (src.includes('/products/') || src.includes('cdn.shopify.com')) && isImageVisible(img);
				});
				
				productImages.forEach((img, index) => {
					if (index < imageUrls.length) {
						replaceImageSrc(img, imageUrls[index], index);
						replaced++;
					} else {
						hideImage(img, index);
						hidden++;
					}
				});
				
				return replaced > 0;
			}
		} finally {
			isReplacingImages = false;
		}
	}

	// Clean up empty containers after hiding images
	function cleanupEmptyContainers() {
		// Find all hidden items
		const hiddenItems = document.querySelectorAll('[data-ab-test-hidden="true"]');
		
		hiddenItems.forEach(item => {
			// Check if parent only contains hidden items
			const parent = item.parentElement;
			if (parent) {
				const siblings = Array.from(parent.children);
				const allHidden = siblings.every(child => 
					child.dataset.abTestHidden === 'true' || 
					child.style.display === 'none'
				);
				
				if (allHidden && parent !== document.body) {
					parent.style.display = 'none';
					debugLog('Hiding empty parent container');
				}
			}
		});
	}

	// Check if image is visible
	function isImageVisible(img) {
		if (!img || !img.offsetParent) return false;
		
		const style = window.getComputedStyle(img);
		if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
			return false;
		}
		
		const rect = img.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	// Initialize theme detection info
	function logThemeInfo() {
		const theme = detectTheme();
		const config = themeConfig;
		
		console.log('[A/B Test] Theme Detection Summary:');
		console.log('- Detected Theme:', theme);
		console.log('- Theme Config:', config ? config.name : 'Using adaptive detection');
		console.log('- Debug Mode:', DEBUG_MODE ? 'ON' : 'OFF');
		
		if (DEBUG_MODE && config) {
			console.log('- Theme Selectors:', config.selectors);
			console.log('- Hide Strategy:', config.hideStrategy);
			console.log('- Hide Method:', config.hideMethod);
		}
	}

	// Rest of the original script functions (session management, tracking, etc.)
	// ... [Include all the remaining functions from the original script here]

	// Generate or retrieve session ID
	function getSessionId() {
		const now = Date.now();
		let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
		let metadataRaw = localStorage.getItem(SESSION_METADATA_KEY);
		let metadata;

		if (metadataRaw) {
			try {
				metadata = JSON.parse(metadataRaw);
			} catch (error) {
				debugLog('Failed to parse session metadata, resetting');
				metadata = null;
			}
		}

		if (metadata && metadata.id && metadata.createdAt) {
			const age = now - Number(metadata.createdAt);
			if (age < SESSION_TTL_MS) {
				sessionId = metadata.id;
			} else {
				debugLog('Session TTL exceeded, rotating session ID');
				sessionId = null;
			}
		}

		if (!sessionId) {
			sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + now.toString(36);
			metadata = { id: sessionId, createdAt: now };
			debugLog('New session ID created:', sessionId);
		}

		localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		try {
			localStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(metadata));
		} catch (error) {
			debugLog('Unable to persist session metadata:', error);
		}

		return sessionId;
	}

	// Get product ID (keeping original logic)
	function getProductId() {
		debugLog('Attempting product ID detection...');

		if (window.ShopifyAnalytics?.meta?.product?.gid) {
			const productId = window.ShopifyAnalytics.meta.product.gid;
			console.log('[A/B Test] Product ID detected:', productId, '(via ShopifyAnalytics)');
			return productId;
		}

		if (window.__st?.rid) {
			const productId = 'gid://shopify/Product/' + window.__st.rid;
			console.log('[A/B Test] Product ID detected:', productId, '(via __st)');
			return productId;
		}

		const productIdMeta = document.querySelector('meta[property="og:product:id"]');
		if (productIdMeta?.content) {
			const productId = 'gid://shopify/Product/' + productIdMeta.content;
			console.log('[A/B Test] Product ID detected:', productId, '(via meta tag)');
			return productId;
		}

		const pathMatch = window.location.pathname.match(/\/products\/([^\/]+)/);
		if (pathMatch?.[1]) {
			const productId = 'handle:' + pathMatch[1];
			console.log('[A/B Test] Product ID detected:', productId, '(via URL - handle only)');
			return productId;
		}

		console.warn('[A/B Test] Could not detect product ID');
		return null;
	}

	// Fetch variant (keeping original logic)
	async function fetchVariant(productId, attempt = 1) {
		const sessionId = getSessionId();
		const urlParams = new URLSearchParams(window.location.search);
		const forcedVariant = urlParams.get('variant');

		let url = APP_PROXY_BASE + '/variant/' + encodeURIComponent(productId) + '?session=' + sessionId;

		if (forcedVariant && (forcedVariant.toLowerCase() === 'a' || forcedVariant.toLowerCase() === 'b')) {
			url += '&force=' + forcedVariant.toUpperCase();
			console.log('[A/B Test] Forcing variant:', forcedVariant.toUpperCase());
		}

		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					Accept: 'application/json',
					'X-AB-Session': sessionId.substring(0, 32),
				},
			});

			if (!response.ok) {
				throw new Error('HTTP ' + response.status);
			}

			const data = await response.json();
			debugLog('Variant data received:', data);
			return data;
		} catch (error) {
			if (attempt < MAX_RETRY_ATTEMPTS) {
				debugLog('Retrying... attempt', attempt + 1);
				await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
				return fetchVariant(productId, attempt + 1);
			}
			console.error('[A/B Test] Failed to fetch variant:', error);
			return null;
		}
	}

	// Main initialization
	async function init() {
		console.log('[A/B Test] Initializing...');
		
		// Log theme info
		logThemeInfo();

		// Check if on product page
		if (!window.location.pathname.includes('/products/')) {
			debugLog('Not a product page, skipping');
			return;
		}

		const productId = getProductId();
		if (!productId) {
			return;
		}

		try {
			const data = await fetchVariant(productId);

			if (data?.variant && data?.imageUrls && data?.testId) {
				console.log('[A/B Test] Active test found:', data.testId, 'Variant:', data.variant, 'Images:', data.imageUrls.length);

				const success = replaceImages(data.imageUrls, data.variant);

				if (success) {
					// Store test info for tracking
					sessionStorage.setItem(ACTIVE_TEST_KEY, JSON.stringify({
						testId: data.testId,
						variant: data.variant,
						productId: productId,
					}));

					console.log('[A/B Test] ✅ Images replaced successfully');
				} else {
					console.warn('[A/B Test] ⚠️ Failed to replace images');
					if (DEBUG_MODE) {
						console.log('[A/B Test] Enable debug mode with ?ab_debug=true for details');
					}
				}
			} else {
				console.log('[A/B Test] No active test for this product');
			}
		} catch (error) {
			console.error('[A/B Test] Initialization failed:', error);
		}
	}

	// Start when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		setTimeout(init, 0);
	}

	// Retry on window load for late-loading images
	window.addEventListener('load', function() {
		const testData = sessionStorage.getItem(ACTIVE_TEST_KEY);
		if (testData) {
			try {
				const data = JSON.parse(testData);
				setTimeout(function() {
					const productId = getProductId();
					if (productId === data.productId) {
						fetchVariant(productId).then(function(variantData) {
							if (variantData?.imageUrls) {
								replaceImages(variantData.imageUrls, variantData.variant);
							}
						});
					}
				}, 100);
			} catch (e) {
				// Ignore errors
			}
		}
	});
})();
