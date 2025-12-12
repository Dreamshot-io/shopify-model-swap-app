import { captureRemixErrorBoundaryError, withSentry } from '@sentry/remix';
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from '@remix-run/react';

function App() {
	return (
		<html>
			<head>
				<meta charSet='utf-8' />
				<meta name='viewport' content='width=device-width,initial-scale=1' />
				<link rel='preconnect' href='https://cdn.shopify.com/' />
				<link rel='stylesheet' href='https://cdn.shopify.com/static/fonts/inter/v4/styles.css' />
				<Meta />
				<Links />
			</head>
			<body>
				<Outlet />
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export const ErrorBoundary = () => {
	const error = useRouteError();
	captureRemixErrorBoundaryError(error);
	return <div>Something went wrong</div>;
};

export default withSentry(App);
