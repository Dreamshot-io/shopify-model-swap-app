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
	const processedImageUrls = new Set(); // Track which image URLs we've already applied

	// Log script initialization
	console.log('[A/B Test] Script loaded and initialized', DEBUG_MODE ? '(debug mode ON)' : '');

	function getActiveTestData() {
		const testDataRaw = sessionStorage.getItem(ACTIVE_TEST_KEY);
		if (!testDataRaw) return null;
		try {
			const parsed = JSON.parse(testDataRaw);
			if (
				parsed &&
				typeof parsed.testId === 'string' &&
				typeof parsed.productId === 'string' &&
				(parsed.variant === 'A' || parsed.variant === 'B')
			) {
				return parsed;
			}
		} catch (error) {
			debugLog('Failed to parse active test payload', error);
		}
		return null;
	}

	async function persistCartMetadata(activeTest) {
		if (!activeTest || !activeTest.testId || !activeTest.variant) {
			return false;
		}

		const sessionId = getSessionId();
		const metadata = {
			testId: activeTest.testId,
			variant: activeTest.variant,
			productId: activeTest.productId,
			sessionId,
			assignedAt: new Date().toISOString(),
		};

		try {
			const payload = {
				attributes: {
					[AB_PROPERTY_KEY]: JSON.stringify(metadata),
				},
			};

			const response = await fetch('/cart/update.js', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				credentials: 'include',
				body: JSON.stringify(payload),
			});

			debugLog('Cart metadata persisted', metadata, 'status:', response.status);
			return response.ok;
		} catch (error) {
			console.error('[A/B Test] Failed to persist cart metadata', error);
			return false;
		}
	}

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
				if (!sessionId) {
					debugLog('Metadata missing session id, regenerating');
				}
			} else {
				debugLog('Session TTL exceeded, rotating session ID');
				sessionId = null;
			}
		} else if (sessionId) {
			metadata = { id: sessionId, createdAt: now };
		}

		if (!sessionId) {
			sessionId = 'session_' + Math.random().toString(36).substr(2, 16) + now.toString(36);
			metadata = { id: sessionId, createdAt: now };
			debugLog('New session ID created:', sessionId, 'at', new Date(now).toISOString());
		}

		localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
		try {
			localStorage.setItem(SESSION_METADATA_KEY, JSON.stringify(metadata));
		} catch (error) {
			debugLog('Unable to persist session metadata:', error);
		}

		return sessionId;
	}

	async function sendTrackingEvent(eventType, payload = {}) {
		const activeTest = getActiveTestData();
		if (!activeTest) {
			return false;
		}

		if (typeof payload !== 'object' || payload === null) {
			return false;
		}

		const { skipCartAttach = false, ...extraPayload } = payload;
		const syncKey = CART_ATTRIBUTE_SYNC_PREFIX + activeTest.testId + '_' + activeTest.variant;

		if (!skipCartAttach && !sessionStorage.getItem(syncKey)) {
			try {
				persistCartMetadata(activeTest);
				sessionStorage.setItem(syncKey, '1');
			} catch (error) {
				debugLog('Failed to persist cart metadata', error);
			}
		}

		const sessionId = getSessionId();
		const url = APP_PROXY_BASE + '/track';
		const body = {
			testId: activeTest.testId,
			sessionId,
			eventType,
			productId: activeTest.productId,
			variant: activeTest.variant,
			...extraPayload,
		};
		const requestPayload = JSON.stringify(body);

		if (eventType === 'ADD_TO_CART' && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
			try {
				const beaconSent = navigator.sendBeacon(url, new Blob([requestPayload], { type: 'application/json' }));
				if (beaconSent) {
					return true;
				}
			} catch (error) {
				debugLog('sendBeacon failed, falling back to fetch', error);
			}
		}

		try {
			await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				keepalive: eventType === 'ADD_TO_CART',
				body: requestPayload,
			});
			return true;
		} catch (error) {
			console.error('[A/B Test] Theme tracking failed:', eventType, error);
			return false;
		}
	}

	let isCartFallbackInitialized = false;
	let lastManualAddToCartTimestamp = 0;

	function initAddToCartFallback() {
		if (isCartFallbackInitialized) return;
		isCartFallbackInitialized = true;

		const CART_ENDPOINT_REGEX = /\/cart\/(add|update)/;
		const TRACK_ENDPOINT_REGEX = /\/apps\/model-swap\/track/;

		function shouldMonitorRequest(resource) {
			if (!resource) return false;
			const url = typeof resource === 'string' ? resource : resource.url || '';
			return CART_ENDPOINT_REGEX.test(url) && !TRACK_ENDPOINT_REGEX.test(url);
		}

		function handleSuccessfulCartMutation(source) {
			const activeTest = getActiveTestData();
			if (!activeTest) return;
			const dedupeKey = CART_ATC_KEY_PREFIX + activeTest.testId + '_' + activeTest.variant;
			if (sessionStorage.getItem(dedupeKey) === 'true') {
				debugLog('ATC fallback already sent for this session/test');
				return;
			}
			sessionStorage.setItem(dedupeKey, 'true');
			sessionStorage.setItem(CART_FALLBACK_SENT_FLAG, source);
			sendTrackingEvent('ADD_TO_CART').then((success) => {
				if (success) {
					console.log('[A/B Test] Fallback add to cart tracked via', source);
				} else {
					sessionStorage.removeItem(dedupeKey);
				}
			});
		}

		if (window.fetch) {
			const originalFetch = window.fetch;
			window.fetch = function (input, init) {
				const args = arguments;
				const shouldTrack = shouldMonitorRequest(input);
				return originalFetch.apply(this, args).then(function (response) {
					try {
						if (shouldTrack && response && response.ok) {
							response
								.clone()
								.text()
								.catch(function () {
									return '';
								})
								.finally(function () {
									handleSuccessfulCartMutation('fetch');
								});
						}
					} catch (error) {
						debugLog('Fetch fallback handler error', error);
					}
					return response;
				});
			};
		}

		if (window.XMLHttpRequest) {
			const send = window.XMLHttpRequest.prototype.send;
			window.XMLHttpRequest.prototype.send = function () {
				try {
					this.addEventListener('load', function () {
						try {
							const url = this.responseURL || '';
							if (CART_ENDPOINT_REGEX.test(url) && this.status >= 200 && this.status < 300) {
								handleSuccessfulCartMutation('xhr');
							}
						} catch (error) {
							debugLog('XHR fallback handler error', error);
						}
					});
				} catch (error) {
					debugLog('Failed to attach XHR fallback', error);
				}
				return send.apply(this, arguments);
			};
		}
	}

	const ADD_TO_CART_BUTTON_SELECTORS = [
		'button[name="add"]',
		'button[data-add-to-cart]',
		'button[data-action="add-to-cart"]',
		'[data-add-to-cart]',
		'.add-to-cart',
		'.add-to-cart-button',
		'.product-form__submit',
		'.product-form__cart-submit',
		'#AddToCart',
		'#ProductSubmitButton',
	];

	const ADD_TO_CART_THROTTLE_MS = 500;

	function recordManualAddToCart(source) {
		const now = Date.now();
		if (now - lastManualAddToCartTimestamp < ADD_TO_CART_THROTTLE_MS) {
			debugLog('Manual add to cart throttled', source);
			return;
		}

		lastManualAddToCartTimestamp = now;
		sendTrackingEvent('ADD_TO_CART', {
			source,
			skipCartAttach: true,
		});
	}

	function wireAddToCartTracking() {
		try {
			const forms = document.querySelectorAll('form[action*="/cart/add"]');
			forms.forEach((form) => {
				if (form.dataset.abAtcBound === 'true') {
					return;
				}
				form.dataset.abAtcBound = 'true';
				form.addEventListener('submit', function () {
					recordManualAddToCart('form-submit');
				});
			});

			const buttons = document.querySelectorAll(ADD_TO_CART_BUTTON_SELECTORS.join(', '));
			buttons.forEach((button) => {
				if (button.dataset.abAtcBound === 'true') {
					return;
				}
				button.dataset.abAtcBound = 'true';
				button.addEventListener('click', function () {
					// Defer slightly to allow theme scripts to process click handlers first
					setTimeout(function () {
						recordManualAddToCart('button-click');
					}, 0);
				});
			});
		} catch (error) {
			debugLog('Failed to wire add to cart tracking', error);
		}
	}

	let addToCartMutationObserver = null;

	function monitorAddToCartElements() {
		if (!window.MutationObserver || addToCartMutationObserver) {
			return;
		}

		addToCartMutationObserver = new MutationObserver(function (mutations) {
			let shouldRewire = false;
			for (const mutation of mutations) {
				if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
					shouldRewire = true;
					break;
				}
			}

			if (shouldRewire) {
				wireAddToCartTracking();
			}
		});

		addToCartMutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});

		setTimeout(function () {
			if (addToCartMutationObserver) {
				addToCartMutationObserver.disconnect();
				addToCartMutationObserver = null;
			}
		}, 5000);
	}

	// Detect product ID using multiple strategies
	function getProductId() {
		debugLog('Attempting product ID detection...');

		// Strategy 1: ShopifyAnalytics global
		if (
			window.ShopifyAnalytics &&
			window.ShopifyAnalytics.meta &&
			window.ShopifyAnalytics.meta.product &&
			window.ShopifyAnalytics.meta.product.gid
		) {
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
			metaTags: document.querySelectorAll('meta[property*="product"]').length,
		});
		return null;
	}

	// Check if an image is visible (not hidden by CSS or dimensions)
	function isImageVisible(img) {
		if (!img || !img.offsetParent) return false; // Element is hidden

		const style = window.getComputedStyle(img);
		if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
			return false;
		}

		// Check if image has dimensions
		const rect = img.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return false;

		return true;
	}

	// Score an image based on its likelihood of being a main product image
	function scoreProductImage(img) {
		let score = 0;

		// Check if image is visible (critical)
		if (!isImageVisible(img)) return -1000; // Heavily penalize hidden images

		const rect = img.getBoundingClientRect();
		const src = img.src || img.dataset.src || '';

		// Size scoring (larger images are more likely to be main images)
		const area = rect.width * rect.height;
		score += Math.min(area / 1000, 500); // Cap at 500 points

		// URL pattern scoring
		if (src.includes('/products/') || src.includes('cdn.shopify.com')) score += 100;
		if (src.includes('_grande') || src.includes('_large') || src.includes('_1024x')) score += 50;
		if (src.includes('_thumb') || src.includes('_small') || src.includes('_icon')) score -= 100;

		// Position scoring (images higher on page are more likely main images)
		const scrollY = window.pageYOffset || document.documentElement.scrollTop;
		const imageY = rect.top + scrollY;
		if (imageY < 1000) score += 50; // Bonus for images near top

		// Context scoring - check parent elements
		let element = img;
		for (let i = 0; i < 5 && element; i++) {
			const classList = element.classList ? Array.from(element.classList).join(' ') : '';
			const className = element.className || '';

			// Positive signals
			if (/product|gallery|media|featured|main|primary/i.test(className)) score += 30;
			if (/slider|carousel|swiper|slick|flickity/i.test(className)) score += 20;

			// Negative signals
			if (/thumb|thumbnail|nav|navigation|breadcrumb|footer|header/i.test(className)) score -= 50;

			element = element.parentElement;
		}

		// Check for data attributes
		if (img.dataset.productImage || img.dataset.productFeaturedImage) score += 50;

		debugLog('Image score:', score, 'src:', src.substring(0, 60), 'size:', rect.width, 'x', rect.height);

		return score;
	}

	// Find the product gallery container
	function findGalleryContainer() {
		// Common gallery container selectors for different themes
		const gallerySelectors = [
			// Horizon theme
			'.product__media-list',
			'.product-media-gallery',
			'.product__media-wrapper',

			// Dawn theme
			'.product__media-list',
			'.product__media-wrapper',

			// Debut theme
			'.product-single__photos',
			'.product__main-photos',

			// Brooklyn theme
			'.product__slides',

			// Generic patterns
			'.product-gallery',
			'.product-images',
			'.product-photos',
			'[data-product-images]',
			'[data-product-gallery]',
			'.gallery',
			'.image-gallery',
			'.product-media--image-container',
			'.product__media-item',
			'.product-media-item',
			'[data-media-id]',
			'.gallery__item',
			'.product-gallery__media-item',
			'.product__media-item-wrapper',
			'.product__media-group',
		];

		// Try each selector
		for (const selector of gallerySelectors) {
			const container = document.querySelector(selector);
			if (container) {
				const images = container.querySelectorAll('img');
				if (images.length >= 2) {
					// Must have at least 2 images to be a gallery
					debugLog('Found gallery container:', selector, 'with', images.length, 'images');
					return { container, images: Array.from(images) };
				}
			}
		}

		// Fallback: Find element containing multiple product images
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
					debugLog('Found common parent container with', imagesInParent.length, 'images');
					return { container: commonParent, images: Array.from(imagesInParent) };
				}
				commonParent = commonParent.parentElement;
				depth++;
			}
		}

		debugLog('No gallery container found');
		return null;
	}

	// Find all product images using intelligent detection
	function findProductImages() {
		// Get all images on the page
		const allImages = Array.from(document.querySelectorAll('img'));

		// Score and sort images
		const scoredImages = allImages
			.map(img => ({ img, score: scoreProductImage(img) }))
			.filter(item => item.score > 0) // Only positive scores
			.sort((a, b) => b.score - a.score); // Highest score first

		debugLog('Found', scoredImages.length, 'potential product images');

		return scoredImages.map(item => item.img);
	}

	// Hide an image and its container
	function hideImage(img) {
		if (!img) return;

		// Mark as hidden to prevent re-processing
		img.dataset.abTestHidden = 'true';
		img.style.display = 'none';
		img.style.visibility = 'hidden';

		// Also hide parent container if it's a wrapper
		const galleryWrapper = img.closest('[data-ab-gallery-wrapper]');
		if (galleryWrapper) {
			galleryWrapper.style.display = 'none';
			galleryWrapper.dataset.abTestHidden = 'true';
			debugLog('Hiding gallery wrapper via data attribute');
			return;
		}

		let parent = img.parentElement;
		let depth = 0;
		while (parent && depth < 3) {
			const parentClass = parent.className || '';

			if (
				/media-item|slide|photo-item|image-item|gallery-item|product__media-item|product-media-item|product__media|product__image|main-product-image/i.test(
					parentClass,
				)
			) {
				parent.style.display = 'none';
				parent.dataset.abTestHidden = 'true';
				debugLog('Hiding parent container:', parentClass);
				break;
			}

			parent = parent.parentElement;
			depth++;
		}

		if (parent && parent.dataset && parent.dataset.mediaId) {
			parent.style.display = 'none';
			parent.dataset.abTestHidden = 'true';
			debugLog('Hiding parent dataset mediaId:', parent.dataset.mediaId);
			return;
		}
	}

	// Replace a single image
	function replaceImageSrc(img, newSrc) {
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
			img.loading = 'eager'; // Force immediate loading
		}

		// Ensure image is visible
		img.style.display = '';
		img.style.visibility = '';
		img.dataset.abTestReplaced = 'true';
	}

	// Replace images with intelligent detection + fallback selectors
	function replaceImages(imageUrls, variantId) {
		if (!imageUrls || !imageUrls.length) return false;

		if (DEBUG_MODE) {
			console.group('[A/B Test Debug] replaceImages');
			console.debug('Variant ID:', variantId);
			console.debug('Incoming image URLs:', imageUrls);
		}

		// Re-entry guard: prevent infinite loops from MutationObserver
		if (isReplacingImages) {
			debugLog('Skipping replaceImages - already in progress');
			if (DEBUG_MODE) {
				console.debug('replaceImages exiting early because another run is active');
				console.groupEnd();
			}
			return false;
		}

		// Check if we've already processed these exact URLs
		const urlKey = imageUrls.join('|');
		if (processedImageUrls.has(urlKey)) {
			debugLog('Skipping replaceImages - already processed these URLs');
			if (DEBUG_MODE) {
				console.debug('URL key already processed; returning success');
				console.groupEnd();
			}
			return true; // Return true since we successfully processed them before
		}

		const currentVisible = Array.from(document.querySelectorAll('img[data-abtest-replaced="true"]')).map(
			img => img.src,
		);

		if (DEBUG_MODE) {
			console.debug('Currently visible variant images:', currentVisible);
			console.debug('Current URL key:', urlKey);
			console.debug('Processed URL keys:', Array.from(processedImageUrls));
		}

		if (currentVisible.join('|') !== urlKey) {
			debugLog('Detected variant change; clearing previous processed URLs');
			if (DEBUG_MODE) {
				console.debug('Variant switch detected, clearing processedImageUrls cache');
			}
			processedImageUrls.clear();
		}

		isReplacingImages = true;
		processedImageUrls.add(urlKey);

		try {
			let replaced = 0;
			let hidden = 0;
			let visibleReplaced = 0;

			// PHASE 1: Try to find product gallery container (theme-agnostic approach)
			const gallery = findGalleryContainer();

			if (gallery && gallery.images.length > 0) {
				displayGalleryDebugInfo(gallery);

				gallery.images.forEach(img => {
					const wrapper = img.parentElement;
					if (wrapper && wrapper !== gallery.container) {
						wrapper.setAttribute('data-ab-gallery-wrapper', 'true');
					}
				});

				// Filter to only visible images
				const visibleImages = gallery.images.filter(img => isImageVisible(img));
				displayVisibleImagesDebugInfo(visibleImages);
				debugLog('Visible images in gallery:', visibleImages.length);

				// PHASE 2: Replace first N images (where N = imageUrls.length)
				visibleImages.forEach((img, index) => {
					const parentWrapper = img.closest('[data-ab-gallery-wrapper]') || img.parentElement;
					if (index < imageUrls.length) {
						const wasVisible = isImageVisible(img);
						logReplacement(img, imageUrls[index], index);
						replaceImageSrc(img, imageUrls[index]);
						replaced++;
						if (wasVisible) visibleReplaced++;
					} else {
						hideImage(parentWrapper || img);
						reportHiddenImage(img, index);
						hidden++;
					}
				});

				// Also handle hidden images that might become visible later
				handleHiddenImages(gallery.images);
			} else {
				// Fallback: Use intelligent scoring
				debugLog('Using intelligent scoring approach (no gallery container found)');
				if (DEBUG_MODE) {
					console.debug('No gallery found; falling back to scoring heuristic');
				}
				const productImages = findProductImages();
				displayVisibleImagesDebugInfo(productImages);

				// Replace first N images
				productImages.forEach((img, index) => {
					if (index < imageUrls.length) {
						const wasVisible = isImageVisible(img);
						logReplacement(img, imageUrls[index], index);
						replaceImageSrc(img, imageUrls[index]);
						replaced++;
						if (wasVisible) visibleReplaced++;
					} else {
						// Hide extra images beyond variant count
						hideImage(img);
						reportHiddenImage(img, index);
						hidden++;
					}
				});
			}

			// Report results
			reportReplacementSummary(replaced, visibleReplaced, hidden, imageUrls.length);
			hideEmptyWrappers();

			// Handle lazy-loaded images that might appear later
			if (replaced > 0) {
				observeLazyImages(imageUrls);
			}

			// Only consider it successful if we replaced visible images
			return visibleReplaced > 0;
		} finally {
			// Always reset the flag, even if an error occurs
			isReplacingImages = false;
			if (DEBUG_MODE) {
				console.groupEnd();
			}
		}
	}

	function displayGalleryDebugInfo(gallery) {
		if (!DEBUG_MODE) return;
		console.debug('[A/B Test Debug] Gallery container located', {
			selectorAttempted: gallery.container?.className,
			totalImages: gallery.images.length,
			firstFive: gallery.images.slice(0, 5).map((img) => img.src),
		});
	}

	function displayVisibleImagesDebugInfo(images) {
		if (!DEBUG_MODE) return;
		console.debug('[A/B Test Debug] Candidate images after visibility filter', images.map((img) => ({
			src: img.src,
			visible: isImageVisible(img),
		})));
	}

	function logReplacement(img, newSrc, index) {
		debugLog('Replacing image', index, 'with', newSrc);
		if (DEBUG_MODE) {
			console.debug('[A/B Test Debug] Image details before replace', {
				originalSrc: img.src,
				index,
				classes: img.className,
				parentClasses: img.parentElement?.className,
			});
		}
	}

	function reportHiddenImage(img, index) {
		debugLog('Hiding image index', index);
		if (DEBUG_MODE) {
			console.debug('[A/B Test Debug] Hidden image details', {
				src: img.src,
				index,
				classes: img.className,
				parentClasses: img.parentElement?.className,
			});
		}
	}

	function handleHiddenImages(images) {
		const hiddenImages = images.filter((img) => !isImageVisible(img));
		if (DEBUG_MODE && hiddenImages.length) {
			console.debug('[A/B Test Debug] Hidden images to process', hiddenImages.map((img) => img.src));
		}
		hiddenImages.forEach((img) => {
			if (!img.dataset.abTestReplaced) {
				hideImage(img);
				if (DEBUG_MODE) {
					console.debug('[A/B Test Debug] Lazy image forced hidden', img.src);
				}
			}
		});
	}

	function reportReplacementSummary(replaced, visibleReplaced, hidden, expected) {
		console.log('[A/B Test] Replacement summary:', {
			replaced,
			visible: visibleReplaced,
			hidden,
			expected,
		});
	}

	function hideEmptyWrappers() {
		const containers = document.querySelectorAll('[data-ab-gallery-wrapper]');
		containers.forEach((container) => {
			const imgs = Array.from(container.querySelectorAll('img'));
			const hasVariantImage = imgs.some((img) => img.dataset.abTestReplaced === 'true');
			if (!hasVariantImage) {
				container.style.display = 'none';
				container.dataset.abTestHidden = 'true';
				debugLog('Hiding gallery wrapper with no variant images');
				if (DEBUG_MODE) {
					console.debug('[A/B Test Debug] Wrapper hidden because no active images remain', container);
				}
			}
		});
	}

	// Observe for lazy-loaded images
	function observeLazyImages(imageUrls) {
		if (!window.MutationObserver) return;

		let observerTimeout;
		let triggerCount = 0;
		const MAX_TRIGGERS = 3; // Limit number of times observer can trigger

		const observer = new MutationObserver(function (mutations) {
			// Check if we've triggered too many times
			if (triggerCount >= MAX_TRIGGERS) {
				debugLog('Observer reached max triggers, disconnecting');
				observer.disconnect();
				return;
			}

			// Only trigger if new <img> elements were actually added
			let hasNewImages = false;
			for (const mutation of mutations) {
				if (mutation.type === 'childList') {
					for (const node of mutation.addedNodes) {
						if (
							node.tagName === 'IMG' ||
							(node.querySelectorAll && node.querySelectorAll('img').length > 0)
						) {
							hasNewImages = true;
							break;
						}
					}
				}
				if (hasNewImages) break;
			}

		if (!hasNewImages) {
			debugLog('No new images detected, skipping');
			return;
		}

		wireAddToCartTracking();
		monitorAddToCartElements();

			triggerCount++;
			debugLog('Observer detected new images, trigger count:', triggerCount);

			clearTimeout(observerTimeout);
			observerTimeout = setTimeout(function () {
				replaceImages(imageUrls);
			}, 100);
		});

		// Only watch for new child elements, NOT attribute changes
		// This prevents triggering when we modify src attributes
		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		// Disconnect after 5 seconds
		setTimeout(function () {
			debugLog('Observer timeout reached, disconnecting');
			observer.disconnect();
		}, 5000);
	}

	// Fetch variant assignment from app proxy
	async function fetchVariant(productId, attempt = 1) {
		const sessionId = getSessionId();

		// Check for forced variant in URL (for testing: ?variant=a or ?variant=b)
		const urlParams = new URLSearchParams(window.location.search);
		const forcedVariant = urlParams.get('variant');

		let url = APP_PROXY_BASE + '/variant/' + encodeURIComponent(productId) + '?session=' + sessionId;

		// Add forced variant parameter if present
		if (forcedVariant && (forcedVariant.toLowerCase() === 'a' || forcedVariant.toLowerCase() === 'b')) {
			url += '&force=' + forcedVariant.toUpperCase();
			console.log('[A/B Test] 🔧 Forcing variant:', forcedVariant.toUpperCase());
		}

		debugLog('Fetching variant from:', url, 'Attempt:', attempt);

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Accept: 'application/json',
				'X-AB-Session': sessionId.substring(0, 32),
			},
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

		initAddToCartFallback();
		wireAddToCartTracking();
		monitorAddToCartElements();

		const productId = getProductId();
		if (!productId) {
			// Error already logged in getProductId()
			return;
		}

		try {
			const data = await fetchVariant(productId);

			if (data && data.variant && data.imageUrls && data.testId) {
				console.log(
					'[A/B Test] Active test found:',
					data.testId,
					'Variant:',
					data.variant,
					'Images:',
					data.imageUrls.length,
				);
				if (DEBUG_MODE) {
					console.debug('[A/B Test Debug] Variant payload', data);
				}

				const success = replaceImages(data.imageUrls, data.variant);

				if (success) {
					// Store test information for tracking (Web Pixels will use this)
					sessionStorage.setItem(
						ACTIVE_TEST_KEY,
						JSON.stringify({
							testId: data.testId,
							variant: data.variant,
							productId: productId,
						}),
					);

					console.log('[A/B Test] ✅ Visible images replaced successfully');
					wireAddToCartTracking();
					monitorAddToCartElements();
				} else {
					console.warn('[A/B Test] ⚠️ Failed to replace visible images');
					console.warn('[A/B Test] This may indicate theme compatibility issues');
					console.warn('[A/B Test] Enable debug mode with ?ab_debug=true for detailed logs');
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
	window.addEventListener('load', function () {
		const testData = sessionStorage.getItem(ACTIVE_TEST_KEY);
		if (testData) {
			try {
				const data = JSON.parse(testData);
				// Re-apply images in case some loaded late
				setTimeout(function () {
					const productId = getProductId();
					if (productId === data.productId) {
						fetchVariant(productId).then(function (variantData) {
						if (variantData && variantData.imageUrls) {
							replaceImages(variantData.imageUrls, variantData.variant);
							wireAddToCartTracking();
							monitorAddToCartElements();
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
