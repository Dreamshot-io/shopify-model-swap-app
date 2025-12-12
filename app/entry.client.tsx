import { init, replayIntegration, browserTracingIntegration } from '@sentry/remix';
import { RemixBrowser, useLocation, useMatches } from '@remix-run/react';
import { startTransition, StrictMode, useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';

init({
	dsn: 'https://65dcab46705901a1e610127094d5bd10@o4510521210896384.ingest.de.sentry.io/4510521666371664',
	tracesSampleRate: 1,
	enableLogs: true,

	integrations: [
		browserTracingIntegration({
			useEffect,
			useLocation,
			useMatches,
		}),
		replayIntegration({
			maskAllText: true,
			blockAllMedia: true,
		}),
	],

	replaysSessionSampleRate: 0.1,
	replaysOnErrorSampleRate: 1,
	sendDefaultPii: true,
});

startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<RemixBrowser />
		</StrictMode>,
	);
});
