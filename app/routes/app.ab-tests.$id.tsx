import type { LoaderFunctionArgs } from '@remix-run/node';
import { redirect } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';

// REDIRECT: This route is deprecated - redirect to new Product Hub test detail page
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const testId = params.id;

  if (!testId) {
    throw new Response('Test ID required', { status: 400 });
  }

  // Fetch test to get productId for redirect
  const test = await db.aBTest.findUnique({
    where: { id: testId },
    select: { productId: true, shop: true },
  });

  if (!test || test.shop !== session.shop) {
    throw new Response('Test not found', { status: 404 });
  }

  // Redirect to new test detail route
  return redirect(`/app/test-details/${testId}`);
};
