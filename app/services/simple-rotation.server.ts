import db from '../db.server';
import { AuditService } from './audit.server';
import type { AdminApiContext } from '@shopify/shopify-app-remix/server';
import { getSafeImageUrl } from './image-storage.server';
import { uploadR2ImageToShopify, isPrivateR2Url } from './shopify-image-upload.server';

interface ImageData {
	url: string;
	mediaId?: string;
	permanentUrl?: string; // R2 URL for restoration
	position: number;
	altText?: string;
}

interface RotationResult {
	success: boolean;
	duration: number;
	imagesUpdated: number;
	variantsUpdated: number;
}

export class SimpleRotationService {
	/**
	 * SIMPLIFIED rotation function - delete all, upload all approach
	 */
	static async rotateTest(
		testId: string,
		triggeredBy: 'CRON' | 'MANUAL' | 'SYSTEM' = 'SYSTEM',
		userId?: string,
		admin?: AdminApiContext,
	): Promise<RotationResult> {
		const startTime = Date.now();

		// Get test with variants
		const test = await db.aBTest.findUnique({
			where: { id: testId },
			include: { variants: true },
		});

		if (!test) {
			throw new Error(`Test ${testId} not found`);
		}

		if (test.status !== 'ACTIVE') {
			throw new Error(`Test ${testId} is not active (status: ${test.status})`);
		}

		const targetCase = test.currentCase === 'BASE' ? 'TEST' : 'BASE';

		// Log rotation start
		await AuditService.logRotationStarted(testId, test.shop, test.currentCase, targetCase, triggeredBy, userId);

		try {
			if (!admin) {
				throw new Error('Admin context required for rotation');
			}

			// Get target images from database
			const targetImages =
				targetCase === 'BASE'
					? (test.baseImages as unknown as ImageData[]) || []
					: (test.testImages as unknown as ImageData[]) || [];

			const targetVariantHeroes = new Map<string, ImageData | null>();
			for (const variant of test.variants) {
				const heroImage =
					targetCase === 'BASE'
						? (variant.baseHeroImage as unknown as ImageData | null)
						: (variant.testHeroImage as unknown as ImageData | null);
				targetVariantHeroes.set(variant.shopifyVariantId, heroImage);
			}

			console.log(`[rotateTest] Rotating to ${targetCase} with ${targetImages.length} images`);

			// STEP 1: Delete ALL current images from product
			console.log(`[rotateTest] Step 1: Deleting all current images`);
			await this.deleteAllProductImages(admin, test.productId);

			// STEP 2: Upload ALL target images
			console.log(`[rotateTest] Step 2: Uploading ${targetImages.length} images`);
			const uploadedImages: ImageData[] = [];

			for (const image of targetImages) {
				const sourceUrl = getSafeImageUrl(image);
				console.log(`[rotateTest] Uploading image from ${sourceUrl}`);

				// Generate proper filename for R2 uploads
				const filename = `product-${test.productId.replace('gid://shopify/Product/', '')}-img-${image.position}`;
				const mediaId = await this.uploadMediaToProduct(
					admin,
					test.productId,
					sourceUrl,
					image.altText,
					filename,
				);

				uploadedImages.push({
					...image,
					mediaId,
				});
			}

			// STEP 3: Assign variant hero images
			console.log(`[rotateTest] Step 3: Assigning variant hero images`);
			let variantsUpdated = 0;

			for (const [variantId, heroImage] of targetVariantHeroes) {
				if (heroImage) {
					const sourceUrl = getSafeImageUrl(heroImage);

					// Check if hero image is already in gallery
					let heroMediaId = uploadedImages.find(
						img => (img.permanentUrl || img.url) === (heroImage.permanentUrl || heroImage.url),
					)?.mediaId;

					// If not in gallery, upload it separately for the variant
					if (!heroMediaId) {
						const filename = `variant-${variantId.replace('gid://shopify/Variant/', '')}-hero`;
						heroMediaId = await this.uploadMediaToProduct(
							admin,
							test.productId,
							sourceUrl,
							heroImage.altText,
							filename,
						);
					}

					if (heroMediaId) {
						console.log(`[rotateTest] Setting hero for variant ${variantId}`);
						await this.attachMediaToVariant(admin, variantId, heroMediaId, test.productId);
						variantsUpdated++;
					}
				}
			}

			// STEP 4: Update database with new media IDs
			console.log(`[rotateTest] Step 4: Updating database`);

			// Update base/test images with new IDs
			if (targetCase === 'BASE') {
				await db.aBTest.update({
					where: { id: testId },
					data: {
						currentCase: targetCase,
						lastRotation: new Date(),
						nextRotation: new Date(Date.now() + test.rotationHours * 3600000),
						baseImages: JSON.parse(JSON.stringify(uploadedImages)),
					},
				});
			} else {
				await db.aBTest.update({
					where: { id: testId },
					data: {
						currentCase: targetCase,
						lastRotation: new Date(),
						nextRotation: new Date(Date.now() + test.rotationHours * 3600000),
						testImages: JSON.parse(JSON.stringify(uploadedImages)),
					},
				});
			}

			const duration = Date.now() - startTime;

			// Log successful rotation
			const metadata = {
				imagesUpdated: uploadedImages.length,
				variantsUpdated,
				targetCase,
			};

			await AuditService.logRotationCompleted(
				testId,
				test.shop,
				test.currentCase,
				targetCase,
				duration,
				metadata,
			);

			await AuditService.createRotationEvent(
				testId,
				test.currentCase,
				targetCase,
				triggeredBy,
				true,
				duration,
				userId,
				undefined,
				metadata,
			);

			return {
				success: true,
				duration,
				imagesUpdated: uploadedImages.length,
				variantsUpdated,
			};
		} catch (error) {
			const duration = Date.now() - startTime;

			await AuditService.logRotationFailed(
				testId,
				test.shop,
				test.currentCase,
				targetCase,
				error as Error,
				userId,
			);

			await AuditService.createRotationEvent(
				testId,
				test.currentCase,
				targetCase,
				triggeredBy,
				false,
				duration,
				userId,
				(error as Error).message,
			);

			throw error;
		}
	}

	/**
	 * Delete ALL images from a product
	 */
	private static async deleteAllProductImages(admin: AdminApiContext, productId: string): Promise<void> {
		// Get all current media
		const query = `
      query getProductMedia($productId: ID!) {
        product(id: $productId) {
          media(first: 250) {
            edges {
              node {
                ... on MediaImage {
                  id
                }
              }
            }
          }
        }
      }
    `;

		const response = await admin.graphql(query, { variables: { productId } });
		const data = await response.json();

		if (!data.data?.product?.media?.edges) {
			console.log('[deleteAllProductImages] No media found to delete');
			return;
		}

		const mediaIds = data.data.product.media.edges.map((edge: any) => edge.node.id).filter(Boolean);

		if (mediaIds.length === 0) {
			console.log('[deleteAllProductImages] No media IDs to delete');
			return;
		}

		// Delete all media
		const mutation = `
      mutation deleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          userErrors {
            field
            message
          }
        }
      }
    `;

		console.log(`[deleteAllProductImages] Deleting ${mediaIds.length} media items`);
		const deleteResponse = await admin.graphql(mutation, {
			variables: { productId, mediaIds },
		});

		const deleteData = await deleteResponse.json();

		if (deleteData.data?.productDeleteMedia?.userErrors?.length > 0) {
			console.error('[deleteAllProductImages] Errors:', deleteData.data.productDeleteMedia.userErrors);
			throw new Error(`Failed to delete media: ${deleteData.data.productDeleteMedia.userErrors[0].message}`);
		}

		console.log(`[deleteAllProductImages] Successfully deleted ${mediaIds.length} media items`);
	}

	/**
	 * Upload a single image to a product
	 */
	private static async uploadMediaToProduct(
		admin: AdminApiContext,
		productId: string,
		imageUrl: string,
		altText?: string,
		filename?: string,
	): Promise<string> {
		let uploadUrl = imageUrl;

		// If it's an R2 URL, upload it to Shopify first
		if (isPrivateR2Url(imageUrl)) {
			console.log(`[uploadMediaToProduct] Converting R2 URL to Shopify: ${imageUrl}`);
			// Use provided filename or generate one
			const uploadFilename = filename || `product-${productId}-${Date.now()}`;
			uploadUrl = await uploadR2ImageToShopify(admin, imageUrl, uploadFilename);
		}

		// Create media on product
		const mutation = `
      mutation createProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

		const media = [
			{
				originalSource: uploadUrl,
				mediaContentType: 'IMAGE',
				alt: altText || '',
			},
		];

		const response = await admin.graphql(mutation, {
			variables: { productId, media },
		});

		const data = await response.json();

		if (data.data?.productCreateMedia?.userErrors?.length > 0) {
			console.error('[uploadMediaToProduct] Errors:', data.data.productCreateMedia.userErrors);
			throw new Error(`Failed to upload media: ${data.data.productCreateMedia.userErrors[0].message}`);
		}

		const mediaId = data.data?.productCreateMedia?.media?.[0]?.id;

		if (!mediaId) {
			throw new Error('No media ID returned from upload');
		}

		console.log(`[uploadMediaToProduct] Successfully uploaded media ${mediaId}`);
		return mediaId;
	}

	/**
	 * Attach a media image to a variant as hero image
	 */
	private static async attachMediaToVariant(
		admin: AdminApiContext,
		variantId: string,
		mediaId: string,
		productId: string,
	): Promise<void> {
		const mutation = `
      mutation attachVariantMedia($productId: ID!, $variantId: ID!, $mediaId: ID!) {
        productVariantsBulkUpdate(
          productId: $productId,
          variants: [{
            id: $variantId,
            mediaId: $mediaId
          }]
        ) {
          userErrors {
            field
            message
          }
        }
      }
    `;

		const response = await admin.graphql(mutation, {
			variables: { productId, variantId, mediaId },
		});

		const data = await response.json();

		if (data.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
			console.error('[attachMediaToVariant] Errors:', data.data.productVariantsBulkUpdate.userErrors);
			throw new Error(
				`Failed to attach media to variant: ${data.data.productVariantsBulkUpdate.userErrors[0].message}`,
			);
		}

		console.log(`[attachMediaToVariant] Successfully attached media ${mediaId} to variant ${variantId}`);
	}

	/**
	 * Capture and backup current base images to R2
	 */
	static async captureBaseImages(admin: AdminApiContext, productId: string): Promise<ImageData[]> {
		const { storeImagePermanently } = await import('./image-storage.server');

		const query = `
      query getProductImages($productId: ID!) {
        product(id: $productId) {
          id
          handle
          media(first: 100) {
            edges {
              node {
                ... on MediaImage {
                  id
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
        }
      }
    `;

		const response = await admin.graphql(query, {
			variables: { productId },
		});

		const data = await response.json();
		const product = data.data?.product;
		const media = product?.media?.edges || [];

		console.log(`[captureBaseImages] Capturing ${media.length} images for product ${product?.handle}`);

		const capturedImages: ImageData[] = [];

		for (const [index, edge] of media.entries()) {
			const imageNode = edge?.node?.image;
			if (!imageNode?.url) {
				console.warn(`[captureBaseImages] Skipping media index ${index}: missing image URL`);
				continue;
			}

			const shopifyUrl = imageNode.url;
			const mediaId = edge.node.id;
			const altText = imageNode.altText;

			try {
				// Download and upload to R2 permanent storage
				const productHandle = product?.handle || 'product';
				const filename = `${productHandle}-base-${index}`;

				console.log(`[captureBaseImages] Storing image ${index + 1}/${media.length} to R2`);
				const permanentUrl = await storeImagePermanently(shopifyUrl, filename);

				capturedImages.push({
					url: shopifyUrl, // Original Shopify URL
					permanentUrl, // R2 backup URL
					mediaId,
					position: index,
					altText,
				});

				console.log(`[captureBaseImages] ✓ Backed up image ${index + 1} to R2: ${permanentUrl}`);
			} catch (error) {
				console.error(`[captureBaseImages] Failed to backup image ${index} to R2:`, error);
				// Store without R2 backup (will have restoration issues)
				capturedImages.push({
					url: shopifyUrl,
					mediaId,
					position: index,
					altText,
				});
			}
		}

		console.log(
			`[captureBaseImages] Captured ${capturedImages.length} images with ${capturedImages.filter(i => i.permanentUrl).length} R2 backups`,
		);
		return capturedImages;
	}

	/**
	 * Capture and backup current variant hero images to R2
	 */
	static async captureVariantHeroImages(
		admin: AdminApiContext,
		productId: string,
		variantIds: string[],
	): Promise<Map<string, ImageData | null>> {
		const { storeImagePermanently } = await import('./image-storage.server');

		const query = `
      query getProductVariants($productId: ID!) {
        product(id: $productId) {
          id
          handle
          variants(first: 100) {
            edges {
              node {
                id
                displayName
                image {
                  id
                  url
                  altText
                }
              }
            }
          }
        }
      }
    `;

		const response = await admin.graphql(query, {
			variables: { productId },
		});

		const data = await response.json();
		const product = data.data?.product;
		const variants = product?.variants?.edges || [];
		const heroImages = new Map<string, ImageData | null>();

		console.log(`[captureVariantHeroImages] Capturing hero images for ${variantIds.length} variants`);

		for (const edge of variants) {
			if (variantIds.includes(edge.node.id)) {
				if (edge.node.image) {
					const shopifyUrl = edge.node.image.url;
					const mediaId = edge.node.image.id;
					const altText = edge.node.image.altText;
					const variantId = edge.node.id;

					try {
						// Download and upload to R2 permanent storage
						const productHandle = product?.handle || 'product';
						const variantGid = variantId.split('/').pop();
						const filename = `${productHandle}-variant-${variantGid}-hero`;

						console.log(
							`[captureVariantHeroImages] Backing up hero image for variant ${edge.node.displayName} to R2`,
						);
						const permanentUrl = await storeImagePermanently(shopifyUrl, filename);

						heroImages.set(variantId, {
							url: shopifyUrl, // Original Shopify URL
							permanentUrl, // R2 backup URL
							mediaId, // Current Shopify media ID
							position: 0,
							altText,
						});

						console.log(`[captureVariantHeroImages] ✓ Backed up variant ${variantId} hero to R2`);
					} catch (error) {
						console.error(
							`[captureVariantHeroImages] Failed to backup variant ${variantId} hero to R2:`,
							error,
						);
						// Store without R2 backup
						heroImages.set(variantId, {
							url: shopifyUrl,
							mediaId,
							position: 0,
							altText,
						});
					}
				} else {
					heroImages.set(edge.node.id, null);
				}
			}
		}

		console.log(`[captureVariantHeroImages] Captured ${heroImages.size} variant heroes with R2 backups`);
		return heroImages;
	}

	/**
	 * Start a test (convenience method for route)
	 */
	static async startTest(testId: string, userId?: string): Promise<void> {
		const test = await db.aBTest.findUnique({
			where: { id: testId },
		});

		if (!test) throw new Error(`Test ${testId} not found`);

		await db.aBTest.update({
			where: { id: testId },
			data: {
				status: 'ACTIVE',
				nextRotation: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
			},
		});

		await AuditService.logTestStatusChange(testId, test.shop, 'DRAFT', 'ACTIVE', userId);
	}

	/**
	 * Pause a test (convenience method for route)
	 */
	static async pauseTest(testId: string, userId?: string, admin?: AdminApiContext): Promise<void> {
		const test = await db.aBTest.findUnique({
			where: { id: testId },
		});

		if (!test) throw new Error(`Test ${testId} not found`);

		// If not on BASE, rotate back to BASE
		if (test.currentCase !== 'BASE' && admin) {
			await this.rotateTest(testId, 'MANUAL', userId, admin);
		}

		await db.aBTest.update({
			where: { id: testId },
			data: {
				status: 'PAUSED',
			},
		});

		await AuditService.logTestStatusChange(testId, test.shop, 'ACTIVE', 'PAUSED', userId);
	}

	/**
	 * Complete a test and restore to base case
	 */
	static async completeTest(testId: string, admin: AdminApiContext, userId?: string): Promise<void> {
		const test = await db.aBTest.findUnique({
			where: { id: testId },
			include: { variants: true },
		});

		if (!test) {
			throw new Error(`Test ${testId} not found`);
		}

		// Restore base images if currently showing test
		if (test.currentCase === 'TEST') {
			await this.rotateTest(testId, 'SYSTEM', userId, admin);
		}

		// Mark as completed
		await db.aBTest.update({
			where: { id: testId },
			data: {
				status: 'COMPLETED',
				nextRotation: null,
			},
		});

		await AuditService.logTestStatusChange(testId, test.shop, test.status, 'COMPLETED', userId);
	}
}
