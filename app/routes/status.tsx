import type { LoaderFunctionArgs } from '@remix-run/node';

/**
 * Simple status check that doesn't require authentication
 * Use this to verify Vercel deployment is working
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
	console.log('[status] Health check called');
	console.log('[status] URL:', request.url);
	console.log('[status] Method:', request.method);

	const envCheck = {
		SHOPIFY_API_KEY: !!process.env.SHOPIFY_API_KEY,
		SHOPIFY_API_SECRET: !!process.env.SHOPIFY_API_SECRET,
		SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || 'NOT_SET',
		DATABASE_URL: !!process.env.DATABASE_URL,
		FAL_KEY: !!process.env.FAL_KEY,
		NODE_ENV: process.env.NODE_ENV || 'NOT_SET',
	};

	console.log('[status] Environment check:', envCheck);

	// Try to extract shop domain from request (optional, for future multi-client support)
	let shopDomain: string | null = null;
	try {
		const url = new URL(request.url);
		shopDomain = url.searchParams.get('shop') || null;
	} catch {
		// Ignore if URL parsing fails
	}

	const response = {
		status: 'ok',
		timestamp: new Date().toISOString(),
		environment: envCheck,
		message: 'App is running on Vercel',
		...(shopDomain && { shopDomain }), // Include shop if present
	};

	console.log('[status] Response:', { ...response, environment: envCheck });

	return new Response(JSON.stringify(response), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		},
	});
};
