(function () {
	'use strict';

	// ============================================
	// CONFIGURATION & CONSTANTS
	// ============================================
	
	const DEBUG_MODE = window.location.search.includes('ab_debug=true');
	const APP_PROXY_BASE = '/apps/model-swap';
	const SESSION_STORAGE_KEY = 'ab_test_session';
	const SESSION_METADATA_KEY = 'ab_test_session_meta';
	const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
	const ACTIVE_TEST_KEY = 'ab_test_active';
	const CART_ATC_KEY_PREFIX = 'ab_test_atc_sent_';
	const AB_PROPERTY_KEY = 'ModelSwapAB';
	const MAX_RETRY_ATTEMPTS = 3;
	const RETRY_DELAY = 100;

	// State management
	let isReplacingImages = false;
	const processedImageUrls = new Set();
	let detectedTheme = null;
	let themeConfig = null;

	// ============================================
	// THEME CONFIGURATIONS
	// ============================================
	
	const THEME_CONFIGS = {
		'dawn': {
			name: 'Dawn',
			detection: {
				// Multiple detection strategies for reliability
				selectors: ['.product__media-list', 'media-gallery', '#MainProduct'],
				attributes: ['data-section="main-product"'],
				classes: ['product__media-item', 'product__media-wrapper']
			},
			gallery: {
				// Primary selectors for finding the gallery container
				containers: [
					'.product__media-list',
					'ul.product__media-list',
					'media-gallery .product__media-list'
				],
				// Selectors for individual items within the gallery
				items: [
					'.product__media-item',
					'li.product__media-item',
					'.product__media-list > li'
				],
				// Direct image selectors
				images: [
					'.product__media img',
					'.product__media-item img',
					'.product-media-container img'
				]
			},
			hiding: {
				// What to hide: 'item' (container), 'image' (img only), or 'both'
				strategy: 'item',
				// How to hide: 'display', 'visibility', or 'remove'
				method: 'display',
				// Additional cleanup selectors
				cleanupSelectors: ['.product__media-wrapper:empty']
			}
		},
		
		'horizon': {
			name: 'Horizon',
			detection: {
				selectors: ['media-gallery', 'slideshow-component', 'slideshow-slide'],
				attributes: ['data-presentation'],
				classes: ['media-gallery', 'slideshow-slide', 'product-media-container']
			},
			gallery: {
				containers: [
					'slideshow-slides',
					'media-gallery',
					'slideshow-container'
				],
				items: [
					'slideshow-slide',
					'.product-media-container'
				],
				images: [
					'slideshow-slide img',
					'.product-media__image',
					'.product-media img'
				]
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		},
		
		'debut': {
			name: 'Debut',
			detection: {
				selectors: ['.product-single__photos', '#ProductPhoto'],
				attributes: [],
				classes: ['product-single__photo']
			},
			gallery: {
				containers: ['.product-single__photos', '.product__main-photos'],
				items: ['.product-single__photo', '.product-single__photo-wrapper'],
				images: ['.product-single__photo img']
			},
			hiding: {
				strategy: 'item',
				method: 'visibility',
				cleanupSelectors: []
			}
		},
		
		'brooklyn': {
			name: 'Brooklyn',
			detection: {
				selectors: ['.product__slides'],
				attributes: [],
				classes: ['product__slide']
			},
			gallery: {
				containers: ['.product__slides'],
				items: ['.product__slide'],
				images: ['.product__slide img']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		},
		
		'prestige': {
			name: 'Prestige',
			detection: {
				selectors: ['.Product__Gallery', '.Product__Slideshow'],
				attributes: [],
				classes: ['Product__SlideItem']
			},
			gallery: {
				containers: ['.Product__Gallery', '.Product__Slideshow'],
				items: ['.Product__SlideItem'],
				images: ['.Product__SlideItem img', '.Image--lazyLoad']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		},
		
		'impulse': {
			name: 'Impulse',
			detection: {
				selectors: ['.product__photos'],
				attributes: [],
				classes: ['product__photo']
			},
			gallery: {
				containers: ['.product__photos'],
				items: ['.product__photo'],
				images: ['.product__photo img']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		},
		
		'turbo': {
			name: 'Turbo',
			detection: {
				selectors: ['.product-images', '.product-gallery'],
				attributes: [],
				classes: ['product-image', 'gallery-cell']
			},
			gallery: {
				containers: ['.product-images', '.product-gallery'],
				items: ['.product-image', '.gallery-cell'],
				images: ['.product-image img', '.gallery-cell img']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		},
		
		'narrative': {
			name: 'Narrative',
			detection: {
				selectors: ['.product__images'],
				attributes: [],
				classes: ['product__image']
			},
			gallery: {
				containers: ['.product__images'],
				items: ['.product__image'],
				images: ['.product__image img']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
				cleanupSelectors: []
			}
		}
	};

	// ============================================
	// UTILITY FUNCTIONS
	// ============================================
	
	function debugLog(...args) {
		if (DEBUG_MODE) {
			console.log('[A/B Test Debug]', ...args);
		}
	}

	// ============================================
	// THEME DETECTION
	// ============================================
	
	function detectTheme() {
		if (detectedTheme) return detectedTheme;

		console.log('[A/B Test] Starting advanced theme detection...');
		
		// Score each theme based on matches
		const themeScores = {};
		
		for (const [themeKey, config] of Object.entries(THEME_CONFIGS)) {
			let score = 0;
			
			// Check selectors (highest weight)
			for (const selector of config.detection.selectors) {
				if (document.querySelector(selector)) {
					score += 10;
					debugLog(`Theme ${config.name}: Found selector ${selector} (+10)`);
				}
			}
			
			// Check attributes (medium weight)
			for (const attr of config.detection.attributes) {
				if (document.querySelector(`[${attr}]`)) {
					score += 5;
					debugLog(`Theme ${config.name}: Found attribute ${attr} (+5)`);
				}
			}
			
			// Check classes (lower weight)
			for (const className of config.detection.classes) {
				if (document.getElementsByClassName(className).length > 0) {
					score += 3;
					debugLog(`Theme ${config.name}: Found class ${className} (+3)`);
				}
			}
			
			if (score > 0) {
				themeScores[themeKey] = score;
			}
		}
		
		// Find the theme with highest score
		let bestTheme = null;
		let bestScore = 0;
		
		for (const [theme, score] of Object.entries(themeScores)) {
			if (score > bestScore) {
				bestScore = score;
				bestTheme = theme;
			}
		}
		
		if (bestTheme) {
			detectedTheme = bestTheme;
			themeConfig = THEME_CONFIGS[bestTheme];
			console.log(`[A/B Test] Theme detected: ${themeConfig.name} (confidence score: ${bestScore})`);
		} else {
			detectedTheme = 'adaptive';
			themeConfig = null;
			console.log('[A/B Test] No specific theme detected, using adaptive mode');
		}
		
		return detectedTheme;
	}

	// ============================================
	// GALLERY DETECTION
	// ============================================
	
	function findGalleryContainer() {
		const theme = detectTheme();
		
		// Try theme-specific detection first
		if (themeConfig) {
			debugLog(`Attempting ${themeConfig.name} theme-specific gallery detection`);
			
			// Try container selectors
			for (const containerSelector of themeConfig.gallery.containers) {
				const container = document.querySelector(containerSelector);
				if (container) {
					const gallery = analyzeGalleryStructure(container, themeConfig);
					if (gallery) {
						console.log(`[A/B Test] Gallery found using ${themeConfig.name} selector: ${containerSelector}`);
						return gallery;
					}
				}
			}
		}
		
		// Fallback to adaptive detection
		return findGalleryAdaptive();
	}
	
	function analyzeGalleryStructure(container, config) {
		let images = [];
		let validItems = [];
		
		// Try to find structured items first
		if (config && config.gallery.items) {
			const itemSelector = config.gallery.items.join(',');
			const allItems = Array.from(container.querySelectorAll(itemSelector));
			
			if (allItems.length > 0) {
				// Get images from items, only include items with valid images
				allItems.forEach(item => {
					const img = item.querySelector('img');
					if (img && isProductImage(img)) {
						images.push({ img, item });
						validItems.push(item);
					}
				});
			}
		}
		
		// If no structured items, get all product images
		if (images.length === 0) {
			const allImages = container.querySelectorAll('img');
			allImages.forEach(img => {
				if (isProductImage(img)) {
					images.push({ img, item: img.parentElement });
				}
			});
		}
		
		if (images.length >= 2) {
			return {
				container,
				images,
				items: validItems,
				theme: config ? config.name : 'adaptive',
				structured: validItems.length > 0
			};
		}
		
		return null;
	}
	
	function findGalleryAdaptive() {
		debugLog('Using adaptive gallery detection');
		
		// Comprehensive list of gallery patterns
		const patterns = [
			// Component selectors
			'media-gallery',
			'product-gallery',
			'slider-component',
			
			// Class patterns (using wildcards)
			'[class*="product"][class*="media"]',
			'[class*="product"][class*="gallery"]',
			'[class*="product"][class*="image"]',
			'[class*="product"][class*="photo"]',
			'[class*="product"][class*="slide"]',
			
			// Data attributes
			'[data-product-images]',
			'[data-product-gallery]',
			'[data-media-gallery]',
			'[data-gallery]',
			
			// Structural patterns
			'ul[class*="product"]',
			'div[class*="swiper"]',
			'div[class*="slider"]',
			'div[class*="carousel"]'
		];
		
		for (const pattern of patterns) {
			try {
				const containers = document.querySelectorAll(pattern);
				for (const container of containers) {
					const gallery = analyzeGalleryStructure(container, null);
					if (gallery) {
						debugLog(`Gallery found using adaptive pattern: ${pattern}`);
						return gallery;
					}
				}
			} catch (e) {
				// Invalid selector, skip
			}
		}
		
		// Final fallback: common parent detection
		return findCommonParentGallery();
	}
	
	function findCommonParentGallery() {
		debugLog('Using common parent detection');
		
		const productImages = Array.from(document.querySelectorAll('img')).filter(isProductImage);
		
		if (productImages.length < 2) return null;
		
		// Find the lowest common ancestor
		let parent = productImages[0].parentElement;
		let maxDepth = 10;
		let depth = 0;
		
		while (parent && depth < maxDepth) {
			const containedImages = productImages.filter(img => parent.contains(img));
			
			if (containedImages.length >= productImages.length * 0.8) {
				// Found a good parent
				const images = containedImages.map(img => ({
					img,
					item: findImageItem(img, parent)
				}));
				
				return {
					container: parent,
					images,
					items: [],
					theme: 'common-parent',
					structured: false
				};
			}
			
			parent = parent.parentElement;
			depth++;
		}
		
		return null;
	}
	
	function findImageItem(img, container) {
		// Try to find the most immediate item container
		let current = img.parentElement;
		let bestItem = current;
		
		while (current && current !== container) {
			const className = current.className || '';
			if (className.match(/item|slide|cell|wrapper|container/i)) {
				bestItem = current;
			}
			current = current.parentElement;
		}
		
		return bestItem;
	}
	
	function isProductImage(img) {
		const src = img.src || img.dataset.src || '';
		
		// Check if it's a Shopify product image
		if (src.includes('/products/') || src.includes('cdn.shopify.com') || src.includes('/cdn/shop/files/') || src.includes('.myshopify.com/cdn/')) {
			// Filter out tiny images (likely thumbnails)
			// Use naturalWidth/Height for hidden images (getBoundingClientRect returns 0 for hidden elements)
			const width = img.naturalWidth || img.offsetWidth || img.getBoundingClientRect().width;
			const height = img.naturalHeight || img.offsetHeight || img.getBoundingClientRect().height;
			
			if (width > 50 || height > 50) {
				return true;
			}
		}
		
		return false;
	}
	
	function isImageVisible(img) {
		if (!img || !img.offsetParent) return false;
		
		const style = window.getComputedStyle(img);
		if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
			return false;
		}
		
		const rect = img.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	// ============================================
	// IMAGE REPLACEMENT
	// ============================================
	
	function replaceImages(imageUrls, variantId) {
		if (!imageUrls || !imageUrls.length) return false;
		
		if (isReplacingImages) {
			debugLog('Already replacing images');
			return false;
		}
		
		const urlKey = imageUrls.join('|');
		if (processedImageUrls.has(urlKey)) {
			debugLog('Already processed these URLs');
			return true;
		}
		
		isReplacingImages = true;
		processedImageUrls.add(urlKey);
		
		try {
			console.log(`[A/B Test] Starting image replacement (${imageUrls.length} images)`);
			
			const gallery = findGalleryContainer();
			
			if (!gallery) {
				console.error('[A/B Test] No gallery found');
				return false;
			}
			
			console.log(`[A/B Test] Gallery found: ${gallery.theme} mode, ${gallery.images.length} images`);
			
			let replaced = 0;
			let hidden = 0;
			
			// Process each image
			gallery.images.forEach((imageData, index) => {
				if (index < imageUrls.length) {
					// Replace with variant image
					if (replaceImage(imageData, imageUrls[index], index)) {
						replaced++;
					}
				} else {
					// Hide extra images
					if (hideImage(imageData, index)) {
						hidden++;
					}
				}
			});
			
			// Clean up
			cleanupGallery(gallery);
			
			console.log(`[A/B Test] ✅ Replacement complete: ${replaced} replaced, ${hidden} hidden`);
			
			// Setup observer for dynamic content
			if (replaced > 0) {
				observeDynamicContent(imageUrls);
			}
			
			return replaced > 0;
			
		} finally {
			isReplacingImages = false;
		}
	}
	
	function replaceImage(imageData, newSrc, index) {
		const { img, item } = imageData;
		
		if (!img) return false;
		
		// Store original
		if (!img.dataset.originalSrc) {
			img.dataset.originalSrc = img.src;
			if (img.srcset) img.dataset.originalSrcset = img.srcset;
			if (img.dataset.src) img.dataset.originalDataSrc = img.dataset.src;
		}
		
		// Replace source
		img.src = newSrc;
		img.srcset = '';
		if (img.dataset.src) img.dataset.src = newSrc;
		
		// Force loading
		if (img.loading === 'lazy') img.loading = 'eager';
		
		// Mark as replaced
		img.dataset.abTestReplaced = 'true';
		img.dataset.abTestIndex = index.toString();
		
		// Ensure visibility
		img.style.removeProperty('display');
		img.style.removeProperty('visibility');
		img.style.removeProperty('opacity');
		
		// Ensure item visibility
		if (item && item !== img) {
			item.style.removeProperty('display');
			item.style.removeProperty('visibility');
			item.dataset.abTestVisible = 'true';
		}
		
		debugLog(`Replaced image ${index}`);
		return true;
	}
	
	function hideImage(imageData, index) {
		const { img, item } = imageData;
		const config = themeConfig || { hiding: { strategy: 'both', method: 'display' } };
		
		// Determine what to hide
		const targetElement = (config.hiding.strategy === 'image' || !item) ? img : item;
		
		if (!targetElement) return false;
		
		// Special handling for Horizon theme - use aggressive hiding
		if (config && config.name === 'Horizon') {
			// Use !important to override theme styles
			targetElement.style.cssText = 'display: none !important; visibility: hidden !important;';
			targetElement.setAttribute('aria-hidden', 'true');
			targetElement.setAttribute('hidden', '');
			
			// Also hide the parent slideshow-slide if it exists
			const slide = targetElement.closest('slideshow-slide');
			if (slide && slide !== targetElement) {
				slide.style.cssText = 'display: none !important; visibility: hidden !important;';
				slide.setAttribute('aria-hidden', 'true');
				slide.setAttribute('hidden', '');
				slide.dataset.abTestHidden = 'true';
			}
		} else {
			// Original hiding logic for other themes
			switch (config.hiding.method) {
				case 'remove':
					targetElement.remove();
					break;
				case 'visibility':
					targetElement.style.visibility = 'hidden';
					targetElement.style.position = 'absolute';
					targetElement.style.left = '-9999px';
					break;
				case 'display':
				default:
					targetElement.style.display = 'none';
					break;
			}
		}
		
		// Mark as hidden
		targetElement.dataset.abTestHidden = 'true';
		targetElement.dataset.abTestIndex = index.toString();
		
		debugLog(`Hidden image ${index} using ${config.hiding.method || 'Horizon aggressive'}`);
		return true;
	}
	
	function cleanupGallery(gallery) {
		if (!themeConfig || !themeConfig.hiding.cleanupSelectors) return;
		
		themeConfig.hiding.cleanupSelectors.forEach(selector => {
			const elements = document.querySelectorAll(selector);
			elements.forEach(el => {
				const hasVisible = Array.from(el.children).some(child => 
					child.dataset.abTestHidden !== 'true' && 
					child.style.display !== 'none'
				);
				
				if (!hasVisible) {
					el.style.display = 'none';
					debugLog('Hidden empty container:', selector);
				}
			});
		});
	}
	
	function observeDynamicContent(imageUrls) {
		if (!window.MutationObserver) return;
		
		let observerTimeout;
		const observer = new MutationObserver(() => {
			clearTimeout(observerTimeout);
			observerTimeout = setTimeout(() => {
				debugLog('Re-applying images after DOM mutation');
				replaceImages(imageUrls);
			}, 100);
		});
		
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		
		// Stop observing after 5 seconds
		setTimeout(() => observer.disconnect(), 5000);
	}

	// ============================================
	// TRACKING & SESSION MANAGEMENT
	// ============================================
	
	function getActiveTestData() {
		const testDataRaw = sessionStorage.getItem(ACTIVE_TEST_KEY);
		if (!testDataRaw) return null;
		
		try {
			const parsed = JSON.parse(testDataRaw);
			if (parsed && parsed.testId && parsed.productId && (parsed.variant === 'A' || parsed.variant === 'B')) {
				return parsed;
			}
		} catch (error) {
			debugLog('Failed to parse active test data');
		}
		return null;
	}
	
	function getSessionId() {
		const now = Date.now();
		let sessionId = localStorage.getItem(SESSION_STORAGE_KEY);
		let metadata;
		
		try {
			metadata = JSON.parse(localStorage.getItem(SESSION_METADATA_KEY) || '{}');
		} catch {
			metadata = {};
		}
		
		if (metadata.id && metadata.createdAt) {
			const age = now - Number(metadata.createdAt);
			if (age < SESSION_TTL_MS) {
				return metadata.id;
			}
		}
		
		// Generate new session
		sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + now.toString(36);
		metadata = { id: sessionId, createdAt: now };
		
		localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		localStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(metadata));
		
		debugLog('New session created:', sessionId);
		return sessionId;
	}
	
	function getProductId() {
		// Try multiple strategies
		const strategies = [
			() => window.ShopifyAnalytics?.meta?.product?.gid,
			() => window.__st?.rid ? `gid://shopify/Product/${window.__st.rid}` : null,
			() => {
				const meta = document.querySelector('meta[property="og:product:id"]');
				return meta?.content ? `gid://shopify/Product/${meta.content}` : null;
			},
			() => {
				const match = window.location.pathname.match(/\/products\/([^\/]+)/);
				return match?.[1] ? `handle:${match[1]}` : null;
			}
		];
		
		for (const strategy of strategies) {
			const productId = strategy();
			if (productId) {
				console.log('[A/B Test] Product ID:', productId);
				return productId;
			}
		}
		
		console.warn('[A/B Test] Could not detect product ID');
		return null;
	}
	
	async function fetchVariant(productId, attempt = 1) {
		const sessionId = getSessionId();
		const urlParams = new URLSearchParams(window.location.search);
		const forcedVariant = urlParams.get('variant');
		
		let url = `${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`;
		
		if (forcedVariant && /^[ab]$/i.test(forcedVariant)) {
			url += `&force=${forcedVariant.toUpperCase()}`;
			console.log('[A/B Test] Forcing variant:', forcedVariant.toUpperCase());
		}
		
		try {
			const response = await fetch(url, {
				method: 'GET',
				headers: {
					'Accept': 'application/json',
					'X-AB-Session': sessionId.substring(0, 32)
				}
			});
			
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			
			return await response.json();
		} catch (error) {
			if (attempt < MAX_RETRY_ATTEMPTS) {
				await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
				return fetchVariant(productId, attempt + 1);
			}
			throw error;
		}
	}

	// ============================================
	// ADD TO CART TRACKING
	// ============================================
	
	async function sendTrackingEvent(eventType, payload = {}) {
		const activeTest = getActiveTestData();
		if (!activeTest) {
			console.warn('[A/B Test] No active test for tracking');
			return false;
		}
		
		const sessionId = getSessionId();
		const body = {
			testId: activeTest.testId,
			sessionId,
			eventType,
			productId: activeTest.productId,
			variant: activeTest.variant,
			...payload
		};
		
		console.log('[A/B Test] Sending tracking event:', eventType);
		
		try {
			const response = await fetch(`${APP_PROXY_BASE}/track`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			
			return response.ok;
		} catch (error) {
			console.error('[A/B Test] Tracking failed:', error);
			return false;
		}
	}
	
	function wireAddToCartTracking() {
		// Find add to cart forms and buttons
		const forms = document.querySelectorAll('form[action*="/cart/add"]');
		const buttons = document.querySelectorAll([
			'button[name="add"]',
			'button[data-add-to-cart]',
			'.product-form__submit',
			'.add-to-cart',
			'#AddToCart'
		].join(','));
		
		// Track form submissions
		forms.forEach(form => {
			if (form.dataset.abTracked) return;
			form.dataset.abTracked = 'true';
			
			form.addEventListener('submit', () => {
				sendTrackingEvent('ADD_TO_CART', { source: 'form' });
			});
		});
		
		// Track button clicks
		buttons.forEach(button => {
			if (button.dataset.abTracked) return;
			button.dataset.abTracked = 'true';
			
			button.addEventListener('click', () => {
				setTimeout(() => {
					sendTrackingEvent('ADD_TO_CART', { source: 'button' });
				}, 0);
			});
		});
		
		debugLog(`Wired tracking: ${forms.length} forms, ${buttons.length} buttons`);
	}

	// ============================================
	// INITIALIZATION
	// ============================================
	
	async function init() {
		console.log('[A/B Test] Initializing enhanced image replacer');
		console.log('[A/B Test] Debug mode:', DEBUG_MODE ? 'ON' : 'OFF');
		
		// Detect theme early
		const theme = detectTheme();
		console.log('[A/B Test] Theme:', theme);
		
		if (!window.location.pathname.includes('/products/')) {
			debugLog('Not a product page');
			return;
		}
		
		const productId = getProductId();
		if (!productId) return;
		
		try {
			const data = await fetchVariant(productId);
			
			if (data?.variant && data?.imageUrls?.length && data?.testId) {
				console.log('[A/B Test] Test active:', {
					testId: data.testId,
					variant: data.variant,
					images: data.imageUrls.length
				});
				
				const success = replaceImages(data.imageUrls, data.variant);
				
				if (success) {
					// Store test info
					sessionStorage.setItem(ACTIVE_TEST_KEY, JSON.stringify({
						testId: data.testId,
						variant: data.variant,
						productId: productId
					}));
					
					// Wire tracking
					wireAddToCartTracking();
					
					// Monitor for dynamic content
					setTimeout(wireAddToCartTracking, 1000);
					setTimeout(wireAddToCartTracking, 3000);
					
				} else {
					console.warn('[A/B Test] Failed to replace images');
				}
			} else {
				console.log('[A/B Test] No active test');
			}
		} catch (error) {
			console.error('[A/B Test] Init failed:', error);
		}
	}
	
	// Start initialization
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		setTimeout(init, 0);
	}
	
	// Retry on window load
	window.addEventListener('load', () => {
		const testData = getActiveTestData();
		if (testData) {
			setTimeout(() => {
				const productId = getProductId();
				if (productId === testData.productId) {
					fetchVariant(productId).then(data => {
						if (data?.imageUrls) {
							replaceImages(data.imageUrls, data.variant);
						}
					});
				}
			}, 100);
		}
	});
	
	// Export for debugging
	window.__abTest = {
		detectTheme,
		findGalleryContainer,
		replaceImages,
		DEBUG_MODE,
		version: '2.0.0'
	};
	
})();
