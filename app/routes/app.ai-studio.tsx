import { useEffect, useState } from 'react';
import type { LoaderFunctionArgs, ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useSearchParams, useFetcher, useNavigate } from '@remix-run/react';
import { Page, Text, BlockStack, Modal } from '@shopify/polaris';
import { TitleBar, useAppBridge } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import { checkAIProviderHealth } from '../services/ai-providers.server';
import { ImagePreviewModal } from '../features/ai-studio/components/ImagePreviewModal';
import { ImageGenerationHub } from '../features/ai-studio/components/ImageGenerationHub';
import { ProductGallery } from '../features/ai-studio/components/ProductGallery';
import { ProductSelector, ProductNavigationTabs } from '../features/shared/components';
import { handleGenerate } from '../features/ai-studio/handlers/generation.server';
import {
	handleSaveToLibrary,
	handleDeleteFromLibrary,
	handleUpload,
	handleGetStagedUpload,
	handleCompleteUpload,
} from '../features/ai-studio/handlers/library.server';
import { handlePublish, handleDeleteFromProduct } from '../features/ai-studio/handlers/product-media.server';
import { handlePublishWithVariants } from '../features/ai-studio/handlers/variant-media.server';
import { useAuthenticatedAppFetch } from '../hooks/useAuthenticatedAppFetch';
import type {
	LibraryItem,
	GeneratedImage,
	SelectedImage,
	BatchProcessingState,
	ActionErrorResponse,
} from '../features/ai-studio/types';

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const { admin, session } = await authenticate.admin(request);

	const url = new URL(request.url);
	const productId = url.searchParams.get('productId');

	if (!productId) {
		// Fetch products for selection
		const productsResponse = await admin.graphql(
			`#graphql
      query GetProducts($first: Int!) {
        products(first: $first, sortKey: UPDATED_AT, reverse: true) {
          edges {
            node {
              id
              title
              handle
              status
              featuredImage {
                url
                altText
              }
              variantsCount {
                count
              }
            }
          }
        }
      }`,
			{
				variables: { first: 50 },
			},
		);

		const productsJson = await productsResponse.json();
		const products = productsJson.data?.products?.edges?.map((edge: any) => edge.node) || [];

		return { product: null, products, shop: session.shop };
	}

	// Fetch product data
	const response = await admin.graphql(
		`#graphql
    query GetProductWithMedia($id: ID!) {
      product(id: $id) {
        id
        title
        descriptionHtml
        handle
        status
        metafield(namespace: "dreamshot", key: "ai_library") { value }
        variants(first: 100) {
          nodes {
            id
            title
            displayName
            sku
            selectedOptions {
              name
              value
            }
            image {
              url
              altText
            }
          }
        }
        media(first: 20) {
          nodes {
            id
            alt
            ... on MediaImage {
              image {
                url
                altText
                width
                height
              }
            }
          }
        }
      }
    }`,
		{
			variables: { id: productId },
		},
	);

	const responseJson = await response.json();

	return {
		product: responseJson.data?.product || null,
		products: [],
		shop: session.shop,
	};
};

export const action = async ({ request }: ActionFunctionArgs): Promise<Response> => {
	const requestId = crypto.randomUUID().slice(0, 8);
	console.log(`[ACTION:${requestId}] ===== ACTION START =====`);
	console.log(`[ACTION:${requestId}] Request received - URL:`, request.url);
	console.log(`[ACTION:${requestId}] Method:`, request.method);
	console.log(`[ACTION:${requestId}] Content-Type:`, request.headers.get('content-type'));
	console.log(`[ACTION:${requestId}] All Headers:`, Object.fromEntries(request.headers.entries()));

	try {
		// Attempt to parse form data
		let formData: FormData;
		try {
			console.log(`[ACTION:${requestId}] Parsing formData...`);
			formData = await request.formData();
			console.log(`[ACTION:${requestId}] FormData parsed successfully`);
		} catch (formError) {
			console.error(`[ACTION:${requestId}] Failed to parse formData:`, formError);
			return json(
				{
					ok: false,
					error: 'Failed to parse request data',
				},
				{ status: 400, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const intent = String(formData.get('intent') || 'generate');
		const productId = String(formData.get('productId') || '');

		console.log(`[ACTION:${requestId}] Intent: ${intent}, ProductId: ${productId}`);

		// Wrap authentication in try-catch to catch redirect responses
		let admin;
		let session;
		try {
			console.log(`[ACTION:${requestId}] Starting authentication...`);
			const authResult = await authenticate.admin(request);
			admin = authResult.admin;
			session = authResult.session;
			console.log(`[ACTION:${requestId}] Authentication successful - shop: ${session.shop}`);
		} catch (authError) {
			console.error(`[ACTION:${requestId}] Authentication failed:`, authError);
			// Catch redirect responses from authentication
			if (authError instanceof Response) {
				console.log(`[ACTION:${requestId}] Auth error is Response - returning 401 JSON`);
				return json(
					{
						ok: false,
						error: 'Session expired. Please refresh the page.',
						needsAuth: true,
					},
					{ status: 401, headers: { 'Content-Type': 'application/json' } },
				);
			}
			throw authError;
		}

		// Route to appropriate handler based on intent
		console.log(`[ACTION:${requestId}] Routing to handler: ${intent}`);
		switch (intent) {
			case 'publish':
				return handlePublish(formData, admin, session.shop);

			case 'publishWithVariants':
				return handlePublishWithVariants(formData, admin, session.shop);

			case 'deleteFromProduct':
				return handleDeleteFromProduct(formData, admin, session.shop);

			case 'saveToLibrary':
				return handleSaveToLibrary(formData, admin, session.shop);

			case 'deleteFromLibrary':
				return handleDeleteFromLibrary(formData, admin, session.shop);

			case 'upload':
				console.log(`[ACTION:${requestId}] Calling handleUpload...`);
				const uploadResult = await handleUpload(formData, admin, session.shop);
				console.log(`[ACTION:${requestId}] Upload handler completed`);
				return uploadResult;

			case 'getStagedUpload':
				console.log(`[ACTION:${requestId}] Calling handleGetStagedUpload...`);
				try {
					const stagedUploadResult = await handleGetStagedUpload(formData, admin, session.shop);
					console.log(`[ACTION:${requestId}] GetStagedUpload handler completed`);
					return stagedUploadResult;
				} catch (stagedUploadError: any) {
					console.error(`[ACTION:${requestId}] GetStagedUpload failed:`, stagedUploadError);
					return json(
						{
							ok: false,
							error: `Failed to create staged upload: ${stagedUploadError.message}`,
							debug:
								process.env.NODE_ENV === 'development'
									? {
											message: stagedUploadError.message,
											stack: stagedUploadError.stack,
										}
									: undefined,
						},
						{ status: 500, headers: { 'Content-Type': 'application/json' } },
					);
				}

			case 'completeUpload':
				console.log(`[ACTION:${requestId}] Calling handleCompleteUpload...`);
				const completeUploadResult = await handleCompleteUpload(formData, admin, session.shop);
				console.log(`[ACTION:${requestId}] CompleteUpload handler completed`);
				return completeUploadResult;

			case 'generate':
			default: {
				const healthCheck = checkAIProviderHealth();
				if (!healthCheck.healthy) {
					const errorResponse: ActionErrorResponse = {
						ok: false,
						error: `AI service unavailable: ${healthCheck.error}`,
					};
					return json(errorResponse, {
						status: 503,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				return handleGenerate(formData, session.shop, admin);
			}
		}
	} catch (globalError: any) {
		console.error('[action] Unexpected error:', globalError);

		const errorResponse: ActionErrorResponse = {
			ok: false,
			error: 'An unexpected error occurred. Please try again.',
			debug:
				process.env.NODE_ENV === 'development'
					? {
							message: globalError.message,
							stack: globalError.stack,
						}
					: undefined,
		};
		return json(errorResponse, {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};

export default function AIStudio() {
	const { product, products, shop } = useLoaderData<typeof loader>();
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const shopify = useAppBridge();
	const fetcher = useFetcher<typeof action>();
	const authenticatedAppFetch = useAuthenticatedAppFetch();

	// Variant state management
	const variants = (product?.variants?.nodes || []) as any[];

	// State management
	const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
	const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
	const [batchProcessingState, setBatchProcessingState] = useState<BatchProcessingState>({
		isProcessing: false,
		currentIndex: 0,
		totalImages: 0,
		completedImages: [],
		failedImages: [],
	});
	const [previewImage, setPreviewImage] = useState<string | null>(null);
	const [previewBase, setPreviewBase] = useState<string | null>(null);
	const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
	const [pendingAction, setPendingAction] = useState<
		null | 'generate' | 'publish' | 'saveToLibrary' | 'deleteFromLibrary' | 'deleteFromProduct'
	>(null);
	const [libraryItemToDelete, setLibraryItemToDelete] = useState<string | null>(null);

	// const productId = searchParams.get("productId");
	const selectedImageFromUrl = searchParams.get('selectedImage');

	// AI providers are initialized server-side only
	// No client-side initialization needed

	useEffect(() => {
		if (selectedImageFromUrl && product?.media?.nodes) {
			const matchingNode = product.media.nodes.find((node: any) => node.image?.url === selectedImageFromUrl);
			if (matchingNode) {
				setSelectedImages([
					{
						id: matchingNode.id,
						url: selectedImageFromUrl,
						altText: matchingNode.image?.altText,
					},
				]);
			}
		}
	}, [selectedImageFromUrl, product]);

	useEffect(() => {
		try {
			const raw = (product as any)?.metafield?.value;
			const arr = raw ? JSON.parse(raw) : [];
			if (Array.isArray(arr)) {
				const normalized = arr.map((item: any) => (typeof item === 'string' ? { imageUrl: item } : item));
				setLibraryItems(normalized);
			}
		} catch {}
	}, [product]);

	// Handle image selection
	const handleImageSelect = (image: SelectedImage) => {
		setSelectedImages(prev => {
			const isAlreadySelected = prev.some(img => img.url === image.url);
			if (isAlreadySelected) {
				// Remove from selection
				return prev.filter(img => img.url !== image.url);
			} else {
				// Add to selection
				return [...prev, image];
			}
		});
	};

	const handleClearSelection = () => {
		setSelectedImages([]);
	};

	// Handle batch model swap generation
	const handleGenerate = async (prompt: string) => {
		if (selectedImages.length === 0 || !prompt.trim()) {
			shopify.toast.show('Please select at least one image and enter a model description', { isError: true });
			return;
		}

		// Initialize batch processing state
		setBatchProcessingState({
			isProcessing: true,
			currentIndex: 0,
			totalImages: selectedImages.length,
			completedImages: [],
			failedImages: [],
		});

		// Set pending action to indicate batch generation is in progress
		setPendingAction('generate');

		// Process images sequentially
		for (let i = 0; i < selectedImages.length; i++) {
			const image = selectedImages[i];

			// Update current processing index
			setBatchProcessingState(prev => ({
				...prev,
				currentIndex: i,
			}));

			try {
				const fd = new FormData();
				fd.set('sourceImageUrl', image.url);
				fd.set('prompt', prompt);
				fd.set('productId', product?.id || '');

				console.log(
					`[BATCH ${i + 1}/${selectedImages.length}] Starting generation for:`,
					image.url.substring(0, 50) + '...',
				);

				// DEBUG: Test if API routes work at all
				if (i === 0) {
					try {
						console.log('[DEBUG] Testing /api/test endpoint...');
						const testRes = await authenticatedAppFetch('/api/test', {
							method: 'POST',
						});
						console.log('[DEBUG] Test response:', testRes.status, await testRes.text());
					} catch (e) {
						console.error('[DEBUG] Test failed:', e);
					}
				}

				// Get session token for authenticated request
				const response = await authenticatedAppFetch('/api/generate', {
					method: 'POST',
					body: fd,
				});

				console.log(
					`[BATCH ${i + 1}] Response status: ${response.status}, content-type: ${response.headers.get('content-type')}`,
				);

				// Check if response is JSON before parsing
				const contentType = response.headers.get('content-type');
				if (!contentType || !contentType.includes('application/json')) {
					// Check if it's an auth redirect (typically 401 or 302)
					if (response.status === 401 || response.status === 302) {
						throw new Error('Session expired. Please reload the page.');
					}
					throw new Error(`Server error (${response.status}). Please try again.`);
				}

				const result = await response.json();

				// Check for auth error in JSON response
				if (!result.ok && result.needsAuth) {
					throw new Error('Session expired. Please reload the page.');
				}

				if (result.ok && result.result) {
					// Add successful result - ensure proper structure
					const generatedImage: GeneratedImage = {
						id: result.result.id || `batch_${Date.now()}_${i}`,
						imageUrl: result.result.imageUrl,
						confidence: result.result.confidence || 0.9,
						metadata: {
							...result.result.metadata,
							sourceImage: image,
							prompt,
							batchIndex: i + 1,
							batchTotal: selectedImages.length,
							generatedAt: new Date().toISOString(),
						},
					};

					setBatchProcessingState(prev => ({
						...prev,
						completedImages: [...prev.completedImages, generatedImage],
					}));

					setGeneratedImages(prev => [...prev, generatedImage]);
				} else {
					// Add failed result
					setBatchProcessingState(prev => ({
						...prev,
						failedImages: [
							...prev.failedImages,
							{
								imageUrl: image.url,
								error: result.error || 'Unknown error',
							},
						],
					}));
				}
			} catch (error) {
				console.error(`❌ Model swap failed for image ${i + 1}:`, error);
				setBatchProcessingState(prev => ({
					...prev,
					failedImages: [
						...prev.failedImages,
						{
							imageUrl: image.url,
							error: error instanceof Error ? error.message : 'Network error',
						},
					],
				}));
			}
		}

		// Complete batch processing and show completion toast
		setBatchProcessingState(prev => {
			const completedCount = prev.completedImages.length;
			const failedCount = prev.failedImages.length;

			// Show completion toast
			if (failedCount === 0) {
				shopify.toast.show(`Successfully generated ${completedCount} AI images! 🎉`);
			} else if (completedCount > 0) {
				shopify.toast.show(`Generated ${completedCount} images successfully, ${failedCount} failed`, {
					isError: false,
				});
			} else {
				shopify.toast.show(`Failed to generate images. Please try again.`, {
					isError: true,
				});
			}

			return {
				...prev,
				isProcessing: false,
			};
		});

		// Reset pending action after batch completion
		setPendingAction(null);
	};

	useEffect(() => {
		const data = fetcher.data as
			| ({ ok: true; result: any } & any)
			| ({ ok: true; published: true } & any)
			| ({ ok: true; savedToLibrary: true } & any)
			| { ok: false; error: string }
			| undefined;

		// Handle single image generation (legacy mode - not batch processing)
		if (data?.ok && pendingAction === 'generate' && (data as any).result && !batchProcessingState.isProcessing) {
			const result = (data as any).result;
			// Ensure the generated image has a proper structure
			const generatedImage: GeneratedImage = {
				id: result.id || `generated_${Date.now()}`,
				imageUrl: result.imageUrl,
				confidence: result.confidence || 0.9,
				metadata: {
					...result.metadata,
					sourceImage: selectedImages.length > 0 ? selectedImages[0] : null,
					generatedAt: new Date().toISOString(),
				},
			};
			setGeneratedImages(prev => [...prev, generatedImage]);
			shopify.toast.show('AI image generated successfully! 🎉');
			setPendingAction(null);
		} else if (data?.ok && pendingAction === 'publish') {
			shopify.toast.show('Published to product');
			setPendingAction(null);
		} else if (data?.ok && pendingAction === 'saveToLibrary') {
			if ((data as any).duplicate) {
				shopify.toast.show('Item already in library', { isError: false });
			} else if ((data as any).savedToLibrary) {
				shopify.toast.show('Saved to library');
			}
			const img = (fetcher.formData?.get && (fetcher.formData.get('imageUrl') as string)) || null;
			if (img) {
				const sourceUrl =
					(fetcher.formData?.get && (fetcher.formData.get('sourceUrl') as string)) ||
					(selectedImages.length > 0 ? selectedImages[0].url : null);
				setLibraryItems(prev => [{ imageUrl: img, sourceUrl }, ...prev]);
			}
			setPendingAction(null);
		} else if (data?.ok && pendingAction === 'deleteFromLibrary') {
			const img = (fetcher.formData?.get && (fetcher.formData.get('imageUrl') as string)) || null;
			if (img) {
				setLibraryItems(prev =>
					prev.filter(item => (typeof item === 'string' ? item !== img : item.imageUrl !== img)),
				);
			}
			shopify.toast.show('Removed from library');
			setLibraryItemToDelete(null);
			setPendingAction(null);
		} else if (data && !data.ok) {
			shopify.toast.show(String(data.error), { isError: true });
			setPendingAction(null);
		}
	}, [fetcher.data, pendingAction, shopify, batchProcessingState.isProcessing]);

	const handlePublishImage = async (image: any) => {
		const fd = new FormData();
		fd.set('intent', 'publish');
		fd.set('imageUrl', image.imageUrl);
		fd.set('productId', product?.id || '');
		setPendingAction('publish');
		fetcher.submit(fd, { method: 'post' });
	};

	const handlePublishFromLibrary = (url: string) => {
		const fd = new FormData();
		fd.set('intent', 'publish');
		fd.set('imageUrl', url);
		fd.set('productId', product?.id || '');
		setPendingAction('publish');
		fetcher.submit(fd, { method: 'post' });
	};

	if (!product) {
		return (
			<Page>
				<TitleBar title='AI Image Studio' />
				<ProductSelector
					products={products}
					onSelectProduct={(id) => navigate(`/app/ai-studio?productId=${encodeURIComponent(id)}`)}
					title="Select a Product"
					description="Choose a product to start generating AI images"
					emptyStateHeading="No products found"
					emptyStateMessage="Create products in your store to use AI Studio"
				/>
			</Page>
		);
	}

	return (
		<Page fullWidth>
			<TitleBar title={`AI Studio - ${product.title}`}>
				<button
					onClick={() => {
						// Navigate back to product
						const productNumericId = product.id.replace('gid://shopify/Product/', '');
						window.open(`shopify:admin/products/${productNumericId}`, '_blank');
					}}
				>
					View Product
				</button>
				<button
					onClick={() => {
						// Open product on storefront
						window.open(`https://${shop}/products/${product.handle}`, '_blank');
					}}
				>
					View in Store
				</button>
			</TitleBar>

			<ProductNavigationTabs productId={product.id} currentPage="ai-studio" />

			<BlockStack gap='500'>
				{previewImage && (
					<ImagePreviewModal url={previewImage} baseUrl={previewBase} onClose={() => setPreviewImage(null)} />
				)}

				{/* Delete confirmation modal for library items */}
				{libraryItemToDelete && (
					<Modal
						open
						onClose={() => setLibraryItemToDelete(null)}
						title='Remove from library?'
						primaryAction={{
							content: 'Delete',
							destructive: true,
							onAction: () => {
								const fd = new FormData();
								fd.set('intent', 'deleteFromLibrary');
								fd.set('imageUrl', libraryItemToDelete);
								fd.set('productId', product?.id || '');
								setPendingAction('deleteFromLibrary');
								fetcher.submit(fd, { method: 'post' });
							},
						}}
						secondaryActions={[
							{
								content: 'Cancel',
								onAction: () => setLibraryItemToDelete(null),
							},
						]}
					>
						<BlockStack gap='200'>
							<Text as='p'>This will permanently remove the image from your library.</Text>
						</BlockStack>
					</Modal>
				)}

				{/* Product Gallery - Shows both published and library images */}
				<ProductGallery
					images={product.media?.nodes || []}
					libraryItems={libraryItems}
					selectedVariantId={null}
					variants={variants}
					onDelete={mediaId => {
						const fd = new FormData();
						fd.set('intent', 'deleteFromProduct');
						fd.set('mediaId', mediaId);
						fd.set('productId', product?.id || '');
						setPendingAction('deleteFromProduct');
						fetcher.submit(fd, { method: 'post' });
					}}
					onPublishFromLibrary={url => handlePublishFromLibrary(url)}
					onRemoveFromLibrary={url => {
						setLibraryItemToDelete(url);
					}}
					isDeleting={pendingAction === 'deleteFromProduct'}
				/>

				{/* Image Generation Hub */}
				<ImageGenerationHub
					productId={product.id}
					media={product.media?.nodes || []}
					selectedImages={selectedImages}
					generatedImages={generatedImages}
					libraryItems={libraryItems}
					batchProcessingState={batchProcessingState}
					onImageSelect={handleImageSelect}
					onClearSelection={handleClearSelection}
					onGenerate={handleGenerate}
					onPublish={img => handlePublishImage(img)}
					onSaveToLibrary={img => {
						const fd = new FormData();
						fd.set('intent', 'saveToLibrary');
						fd.set('imageUrl', img.imageUrl);
						const sourceUrl =
							img.metadata?.sourceImage?.url || (selectedImages.length > 0 ? selectedImages[0].url : '');
						fd.set('sourceUrl', sourceUrl);
						fd.set('productId', product?.id || '');
						setPendingAction('saveToLibrary');
						fetcher.submit(fd, { method: 'post' });
					}}
					onPreview={img => {
						setPreviewImage(img.imageUrl);
						const baseUrl =
							img.metadata?.sourceImage?.url ||
							(selectedImages.length > 0 ? selectedImages[0].url : null);
						setPreviewBase(baseUrl);
					}}
					onPublishFromLibrary={url => handlePublishFromLibrary(url)}
					onPreviewLibrary={(url, base) => {
						setPreviewImage(url);
						setPreviewBase(base || null);
					}}
					onRemoveFromLibrary={url => {
						setLibraryItemToDelete(url);
					}}
					onUploadSuccess={imageUrls => {
						console.log(`[UPLOAD] Successfully uploaded ${imageUrls.length} images, updating UI`);
						// Add uploaded images to library items
						const newLibraryItems = imageUrls.map(url => ({
							imageUrl: url,
							sourceUrl: null,
						}));
						setLibraryItems(prev => [...newLibraryItems, ...prev]);

						// Show success toast
						shopify.toast.show(
							`Successfully uploaded ${imageUrls.length} image${imageUrls.length > 1 ? 's' : ''}!`,
						);
					}}
					isBusy={pendingAction === 'publish' || pendingAction === 'saveToLibrary'}
					pendingAction={pendingAction}
				/>
			</BlockStack>
		</Page>
	);
}
