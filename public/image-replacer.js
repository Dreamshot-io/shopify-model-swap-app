(function () {
	'use strict';

	// ============================================
	// CONFIGURATION & CONSTANTS
	// ============================================

	const DEBUG_MODE = window.location.search.includes('ab-debug=true') || window.location.search.includes('ab_debug=true');
	const APP_PROXY_BASE = '/apps/model-swap';
	const SESSION_STORAGE_KEY = 'ab_test_session';
	const SESSION_METADATA_KEY = 'ab_test_session_meta';
	const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
	const ACTIVE_TEST_KEY = 'ab_test_active';
	const MAX_RETRY_ATTEMPTS = 3;
	const RETRY_DELAY = 100;

	// State management
	let isReplacingImages = false;
	const processedImageUrls = new Set();
	let detectedTheme = null;
	let themeConfig = null;
	let variantWatcher = null;
	let currentVariantId = null;
	let activeTestData = null;

	// ============================================
	// THEME CONFIGURATIONS
	// ============================================

	const THEME_CONFIGS = {
		'dawn': {
			name: 'Dawn',
			detection: {
				selectors: ['.product__media-list', 'media-gallery', '#MainProduct'],
				attributes: ['data-section="main-product"'],
				classes: ['product__media-item', 'product__media-wrapper']
			},
			gallery: {
				containers: [
					'.product__media-list',
					'ul.product__media-list',
					'media-gallery .product__media-list'
				],
				items: [
					'.product__media-item',
					'li.product__media-item',
					'.product__media-list > li'
				],
				images: [
					'.product__media img',
					'.product__media-item img',
					'.product-media-container img'
				],
				itemTemplate: 'li',
				itemClasses: ['product__media-item']
			},
			hiding: {
				strategy: 'item',
				method: 'display',
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
				],
				itemTemplate: 'slideshow-slide',
				itemClasses: []
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
				images: ['.product-single__photo img'],
				itemTemplate: 'div',
				itemClasses: ['product-single__photo']
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
				images: ['.product__slide img'],
				itemTemplate: 'div',
				itemClasses: ['product__slide']
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
				images: ['.Product__SlideItem img', '.Image--lazyLoad'],
				itemTemplate: 'div',
				itemClasses: ['Product__SlideItem']
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
				images: ['.product__photo img'],
				itemTemplate: 'div',
				itemClasses: ['product__photo']
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
				images: ['.product-image img', '.gallery-cell img'],
				itemTemplate: 'div',
				itemClasses: ['product-image']
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
				images: ['.product__image img'],
				itemTemplate: 'div',
				itemClasses: ['product__image']
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

	function getProductId() {
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
				debugLog('Product ID detected:', productId);
				return productId;
			}
		}

		console.warn('[A/B Test] Could not detect product ID');
		return null;
	}

	function getCurrentVariantId() {
		const urlParams = new URLSearchParams(window.location.search);
		const urlVariant = urlParams.get('variant');
		if (urlVariant) {
			return urlVariant;
		}

		const variantInput = document.querySelector('form[action*="/cart/add"] [name="id"]');
		if (variantInput && variantInput.value) {
			return variantInput.value;
		}

		if (window.ShopifyAnalytics?.meta?.selectedVariantId) {
			return window.ShopifyAnalytics.meta.selectedVariantId.toString();
		}

		if (window.theme?.product?.selected_variant) {
			return window.theme.product.selected_variant.toString();
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

		sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + now.toString(36);
		metadata = { id: sessionId, createdAt: now };

		localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		localStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(metadata));

		debugLog('New session created:', sessionId);
		return sessionId;
	}

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

	// ============================================
	// THEME DETECTION
	// ============================================

	function detectTheme() {
		if (detectedTheme) return detectedTheme;

		debugLog('Starting theme detection...');

		const themeScores = {};

		for (const [themeKey, config] of Object.entries(THEME_CONFIGS)) {
			let score = 0;

			for (const selector of config.detection.selectors) {
				if (document.querySelector(selector)) {
					score += 10;
					debugLog(`Theme ${config.name}: Found selector ${selector} (+10)`);
				}
			}

			for (const attr of config.detection.attributes) {
				if (document.querySelector(`[${attr}]`)) {
					score += 5;
					debugLog(`Theme ${config.name}: Found attribute ${attr} (+5)`);
				}
			}

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
			console.log(`[A/B Test] Theme detected: ${themeConfig.name} (confidence: ${bestScore})`);
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

		if (themeConfig) {
			debugLog(`Attempting ${themeConfig.name} theme-specific gallery detection`);

			for (const containerSelector of themeConfig.gallery.containers) {
				const container = document.querySelector(containerSelector);
				if (container) {
					const gallery = analyzeGalleryStructure(container, themeConfig);
					if (gallery) {
						console.log(`[A/B Test] Gallery found: ${themeConfig.name} - ${containerSelector}`);
						return gallery;
					}
				}
			}
		}

		return findGalleryAdaptive();
	}

	function analyzeGalleryStructure(container, config) {
		let images = [];
		let validItems = [];

		if (config && config.gallery.items) {
			const itemSelector = config.gallery.items.join(',');
			const allItems = Array.from(container.querySelectorAll(itemSelector));

			if (allItems.length > 0) {
				allItems.forEach(item => {
					const img = item.querySelector('img');
					if (img && isProductImage(img)) {
						images.push({ img, item });
						validItems.push(item);
					}
				});
			}
		}

		if (images.length === 0) {
			const allImages = container.querySelectorAll('img');
			allImages.forEach(img => {
				if (isProductImage(img)) {
					images.push({ img, item: img.parentElement });
				}
			});
		}

		if (images.length >= 1) {
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

		const patterns = [
			'media-gallery',
			'product-gallery',
			'slider-component',
			'[class*="product"][class*="media"]',
			'[class*="product"][class*="gallery"]',
			'[class*="product"][class*="image"]',
			'[class*="product"][class*="photo"]',
			'[class*="product"][class*="slide"]',
			'[data-product-images]',
			'[data-product-gallery]',
			'[data-media-gallery]',
			'[data-gallery]',
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

		return findCommonParentGallery();
	}

	function findCommonParentGallery() {
		debugLog('Using common parent detection');

		const productImages = Array.from(document.querySelectorAll('img')).filter(isProductImage);

		if (productImages.length < 1) return null;

		let parent = productImages[0].parentElement;
		let maxDepth = 10;
		let depth = 0;

		while (parent && depth < maxDepth) {
			const containedImages = productImages.filter(img => parent.contains(img));

			if (containedImages.length >= productImages.length * 0.8) {
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

		if (src.includes('/products/') || src.includes('cdn.shopify.com') || src.includes('/cdn/shop/files/') || src.includes('.myshopify.com/cdn/')) {
			const width = img.naturalWidth || img.offsetWidth || img.getBoundingClientRect().width;
			const height = img.naturalHeight || img.offsetHeight || img.getBoundingClientRect().height;

			if (width > 50 || height > 50) {
				return true;
			}
		}

		return false;
	}

	// ============================================
	// GALLERY RECONSTRUCTION
	// ============================================

	function rebuildGallery(gallery, imageUrls) {
		if (!gallery || !imageUrls || !imageUrls.length) {
			debugLog('Cannot rebuild gallery: missing gallery or images');
			return false;
		}

		debugLog('Rebuilding gallery with', imageUrls.length, 'images');

		const { container, images: originalImages } = gallery;
		const config = themeConfig;

		if (!config || !config.gallery.itemTemplate) {
			debugLog('No theme config for reconstruction, using simple replacement');
			return replaceImagesSimple(gallery, imageUrls);
		}

		try {
			const templateItem = originalImages.length > 0 ? originalImages[0].item : null;

			if (templateItem) {
				debugLog('Using existing item structure as template');
				return rebuildGalleryFromTemplate(container, templateItem, imageUrls, config);
			} else {
				debugLog('No template found, creating new structure');
				return rebuildGalleryFromScratch(container, imageUrls, config);
			}
		} catch (error) {
			console.error('[A/B Test] Gallery rebuild failed:', error);
			return replaceImagesSimple(gallery, imageUrls);
		}
	}

	function rebuildGalleryFromTemplate(container, templateItem, imageUrls, config) {
		debugLog('Rebuilding from template, removing all existing items');

		const allItems = Array.from(container.querySelectorAll(config.gallery.items.join(',')));
		const itemsToRemove = allItems.length > 0 ? allItems : Array.from(container.children);

		itemsToRemove.forEach(item => {
			if (item !== templateItem) {
				item.remove();
			}
		});

		const newItems = [];

		imageUrls.forEach((imageUrl, index) => {
			let newItem;

			if (index === 0 && templateItem) {
				newItem = templateItem;
				const img = newItem.querySelector('img');
				if (img) {
					if (!img.dataset.originalSrc) {
						img.dataset.originalSrc = img.src;
						if (img.srcset) img.dataset.originalSrcset = img.srcset;
						if (img.dataset.src) img.dataset.originalDataSrc = img.dataset.src;
					}
					img.src = imageUrl;
					img.srcset = '';
					if (img.dataset.src) img.dataset.src = imageUrl;
					img.loading = 'eager';
					img.dataset.abTestReplaced = 'true';
					img.dataset.abTestIndex = index.toString();
				}
			} else {
				newItem = templateItem.cloneNode(true);
				const img = newItem.querySelector('img');
				if (img) {
					img.src = imageUrl;
					img.srcset = '';
					if (img.dataset.src) img.dataset.src = imageUrl;
					img.loading = 'eager';
					img.dataset.abTestReplaced = 'true';
					img.dataset.abTestIndex = index.toString();
				}
				container.appendChild(newItem);
			}

			newItem.style.removeProperty('display');
			newItem.style.removeProperty('visibility');
			newItem.dataset.abTestVisible = 'true';
			newItems.push(newItem);
		});

		debugLog('Rebuilt gallery with', newItems.length, 'items');
		return true;
	}

	function rebuildGalleryFromScratch(container, imageUrls, config) {
		debugLog('Rebuilding from scratch, clearing container');

		container.innerHTML = '';

		const itemTag = config.gallery.itemTemplate || 'div';

		imageUrls.forEach((imageUrl, index) => {
			const item = document.createElement(itemTag);

			config.gallery.itemClasses.forEach(className => {
				item.classList.add(className);
			});

			const img = document.createElement('img');
			img.src = imageUrl;
			img.loading = index === 0 ? 'eager' : 'lazy';
			img.dataset.abTestReplaced = 'true';
			img.dataset.abTestIndex = index.toString();

			item.appendChild(img);
			container.appendChild(item);
			item.dataset.abTestVisible = 'true';
		});

		debugLog('Rebuilt gallery from scratch with', imageUrls.length, 'items');
		return true;
	}

	function replaceImagesSimple(gallery, imageUrls) {
		debugLog('Using simple replacement strategy');

		const { images } = gallery;
		let replaced = 0;

		images.forEach((imageData, index) => {
			if (index < imageUrls.length) {
				const { img, item } = imageData;

				if (!img.dataset.originalSrc) {
					img.dataset.originalSrc = img.src;
					if (img.srcset) img.dataset.originalSrcset = img.srcset;
					if (img.dataset.src) img.dataset.originalDataSrc = img.dataset.src;
				}

				img.src = imageUrls[index];
				img.srcset = '';
				if (img.dataset.src) img.dataset.src = imageUrls[index];
				img.loading = 'eager';
				img.dataset.abTestReplaced = 'true';
				img.dataset.abTestIndex = index.toString();

				img.style.removeProperty('display');
				img.style.removeProperty('visibility');

				if (item && item !== img) {
					item.style.removeProperty('display');
					item.style.removeProperty('visibility');
					item.dataset.abTestVisible = 'true';
				}

				replaced++;
			} else {
				const { img, item } = imageData;
				const targetElement = item || img;
				targetElement.style.display = 'none';
				targetElement.dataset.abTestHidden = 'true';
			}
		});

		return replaced > 0;
	}

	function replaceImages(imageUrls, variantId) {
		if (!imageUrls || !imageUrls.length) {
			debugLog('No images to replace');
			return false;
		}

		if (isReplacingImages) {
			debugLog('Already replacing images, skipping');
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

			console.log(`[A/B Test] Gallery found: ${gallery.theme} mode, ${gallery.images.length} original images`);

			const success = rebuildGallery(gallery, imageUrls);

			if (success) {
				console.log(`[A/B Test] ✅ Replacement complete`);
				cleanupGallery(gallery);
				observeDynamicContent(imageUrls);
			} else {
				console.warn('[A/B Test] Gallery rebuild failed');
			}

			return success;

		} finally {
			isReplacingImages = false;
		}
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
				processedImageUrls.delete(imageUrls.join('|'));
				replaceImages(imageUrls);
			}, 100);
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true
		});

		setTimeout(() => observer.disconnect(), 5000);
	}

	// ============================================
	// TEST FETCHING & VARIANT HANDLING
	// ============================================

	async function fetchVariant(productId, variantId = null, attempt = 1) {
		const sessionId = getSessionId();
		const urlParams = new URLSearchParams(window.location.search);
		const forcedVariant = urlParams.get('variant');

		let url = `${APP_PROXY_BASE}/variant/${encodeURIComponent(productId)}?session=${sessionId}`;

		if (variantId) {
			url += `&variantId=${encodeURIComponent(variantId)}`;
			debugLog('Fetching with variantId:', variantId);
		}

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

			const data = await response.json();
			debugLog('Variant data received:', data);
			return data;
		} catch (error) {
			if (attempt < MAX_RETRY_ATTEMPTS) {
				await new Promise(r => setTimeout(r, RETRY_DELAY * attempt));
				return fetchVariant(productId, variantId, attempt + 1);
			}
			console.error('[A/B Test] Failed to fetch variant:', error);
			throw error;
		}
	}

	async function applyTest(productId, variantId = null) {
		try {
			debugLog('Fetching test for product:', productId, 'variant:', variantId);

			const data = await fetchVariant(productId, variantId);

			if (data?.variant && data?.imageUrls?.length && data?.testId) {
				console.log('[A/B Test] Test active:', {
					testId: data.testId,
					variant: data.variant,
					images: data.imageUrls.length,
					variantId: variantId || 'product-wide'
				});

				const success = replaceImages(data.imageUrls, data.variant);

				if (success) {
					activeTestData = {
						testId: data.testId,
						variant: data.variant,
						productId: productId,
						variantId: variantId
					};

					sessionStorage.setItem(ACTIVE_TEST_KEY, JSON.stringify(activeTestData));

					wireAddToCartTracking();

					return true;
				} else {
					console.warn('[A/B Test] Failed to replace images');
					return false;
				}
			} else {
				debugLog('No active test for this product/variant');
				return false;
			}
		} catch (error) {
			console.error('[A/B Test] Apply test failed:', error);
			return false;
		}
	}

	function watchVariantChanges(callback) {
		let lastVariantId = getCurrentVariantId();

		const checkInterval = setInterval(() => {
			const newVariantId = getCurrentVariantId();
			if (newVariantId && newVariantId !== lastVariantId) {
				lastVariantId = newVariantId;
				debugLog('Variant changed to:', newVariantId);
				callback(newVariantId);
			}
		}, 500);

		document.addEventListener('change', function(e) {
			if (e.target.name === 'id' || e.target.matches('[data-variant-selector]')) {
				setTimeout(() => {
					const newVariantId = getCurrentVariantId();
					if (newVariantId && newVariantId !== lastVariantId) {
						lastVariantId = newVariantId;
						debugLog('Variant changed via form:', newVariantId);
						callback(newVariantId);
					}
				}, 100);
			}
		});

		const variantEvents = ['variant:change', 'variant-change', 'variantChange'];
		variantEvents.forEach(eventName => {
			document.addEventListener(eventName, function(e) {
				const variantId = e.detail?.variant?.id || e.detail?.id || e.detail?.variantId;
				if (variantId && variantId !== lastVariantId) {
					lastVariantId = variantId.toString();
					debugLog('Variant changed via event:', lastVariantId);
					callback(lastVariantId);
				}
			});
		});

		return () => clearInterval(checkInterval);
	}

	// ============================================
	// TRACKING
	// ============================================

	async function sendTrackingEvent(eventType, payload = {}) {
		const activeTest = getActiveTestData();
		if (!activeTest) {
			debugLog('No active test for tracking');
			return false;
		}

		const sessionId = getSessionId();
		const body = {
			testId: activeTest.testId,
			sessionId,
			eventType,
			productId: activeTest.productId,
			variant: activeTest.variant,
			variantId: activeTest.variantId || null,
			...payload
		};

		debugLog('Sending tracking event:', eventType, body);

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
		const forms = document.querySelectorAll('form[action*="/cart/add"]');
		const buttons = document.querySelectorAll([
			'button[name="add"]',
			'button[data-add-to-cart]',
			'.product-form__submit',
			'.add-to-cart',
			'#AddToCart'
		].join(','));

		forms.forEach(form => {
			if (form.dataset.abTracked) return;
			form.dataset.abTracked = 'true';
			form.addEventListener('submit', () => {
				sendTrackingEvent('ADD_TO_CART', { source: 'form' });
			});
		});

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
		console.log('[A/B Test] Initializing unified image replacer');
		console.log('[A/B Test] Debug mode:', DEBUG_MODE ? 'ON' : 'OFF');

		if (!window.location.pathname.includes('/products/')) {
			debugLog('Not a product page');
			return;
		}

		const theme = detectTheme();
		console.log('[A/B Test] Theme:', theme);

		const productId = getProductId();
		if (!productId) {
			console.warn('[A/B Test] Could not detect product ID');
			return;
		}

		currentVariantId = getCurrentVariantId();
		debugLog('Initial variant ID:', currentVariantId || 'none (simple product)');

		const success = await applyTest(productId, currentVariantId);

		if (success) {
			variantWatcher = watchVariantChanges((newVariantId) => {
				debugLog('Variant changed, applying new test');
				currentVariantId = newVariantId;
				processedImageUrls.clear();
				applyTest(productId, newVariantId);
			});

			setTimeout(wireAddToCartTracking, 1000);
			setTimeout(wireAddToCartTracking, 3000);
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		setTimeout(init, 0);
	}

	window.addEventListener('load', () => {
		const testData = getActiveTestData();
		if (testData) {
			setTimeout(() => {
				const productId = getProductId();
				if (productId === testData.productId) {
					const variantId = getCurrentVariantId();
					processedImageUrls.clear();
					applyTest(productId, variantId);
				}
			}, 100);
		}
	});

	window.__abTest = {
		detectTheme,
		findGalleryContainer,
		replaceImages,
		getCurrentVariantId,
		getProductId,
		DEBUG_MODE,
		version: '3.0.0-unified'
	};

})();
