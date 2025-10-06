import { createRequestHandler } from '@remix-run/vercel';
import * as build from 'virtual:remix/server-build';

export const config = {
	runtime: 'nodejs',
};

export default createRequestHandler({
	build,
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
});
