import { createRequestHandler } from '@remix-run/node';
import * as build from 'virtual:remix/server-build';

export const config = {
	runtime: 'nodejs18.x',
};

export default createRequestHandler({
	build,
	mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
});
