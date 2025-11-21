import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db, { lookupShopId } from '../db.server';

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productId = params.id;

  if (!productId) {
    return json({ error: 'Product ID required' }, { status: 400 });
  }

  try {
    const decodedProductId = decodeURIComponent(productId);
    const shopId = await lookupShopId(session.shop);

    if (!shopId) {
      return json({ error: 'Shop not found' }, { status: 404 });
    }

    // Fetch library items from database
    const dbImages = await db.aIStudioImage.findMany({
      where: {
        shopId,
        productId: decodedProductId,
        state: 'LIBRARY',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Convert to LibraryItem format (include mediaId for A/B test creation)
    const libraryItems = dbImages.map(img => ({
      imageUrl: img.url,
      mediaId: img.mediaId || null, // Shopify mediaId if already uploaded
      sourceUrl: img.sourceImageUrl || null,
      variantIds: img.variantIds,
    }));

    return json({ libraryItems });
  } catch (error) {
    console.error('Failed to fetch product library:', error);
    return json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
};