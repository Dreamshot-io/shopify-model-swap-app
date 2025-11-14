import type { LoaderFunctionArgs } from '@remix-run/node';

import prisma from '../db.server';

/**
 * Simple status check that doesn't require authentication
 * Use this to verify Vercel deployment is working
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
	console.log('[status] Health check called');
	console.log('[status] URL:', request.url);
	console.log('[status] Method:', request.method);

	const envCheck = {
		DATABASE_URL: !!process.env.DATABASE_URL,
		FAL_KEY: !!process.env.FAL_KEY,
		NODE_ENV: process.env.NODE_ENV || 'NOT_SET',
	};

	const credentialCount = await prisma['shopCredential'].count();
	const activeShops = await prisma['shopCredential'].findMany({
		select: { shopDomain: true, status: true },
		orderBy: { createdAt: 'desc' },
		take: 5,
	});

	const url = new URL(request.url);
	const response = {
		status: 'ok',
		timestamp: new Date().toISOString(),
		environment: envCheck,
		message: 'App is running on Vercel',
		requestShop: url.searchParams.get('shop'),
		shopCredentials: {
			total: credentialCount,
			sample: activeShops,
		},
	};

	console.log('[status] Response:', response);

	return new Response(JSON.stringify(response), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		},
	});
};
