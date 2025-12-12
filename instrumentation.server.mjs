import * as Sentry from '@sentry/remix';

Sentry.init({
	dsn: 'https://65dcab46705901a1e610127094d5bd10@o4510521210896384.ingest.de.sentry.io/4510521666371664',
	tracesSampleRate: 1,
	enableLogs: true,
});
