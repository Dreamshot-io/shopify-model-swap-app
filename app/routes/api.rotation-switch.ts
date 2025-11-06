import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { processDueRotations } from '../services/ab-test-rotation.server';
import { executeRotationSwap } from '../services/ab-test-rotation-sync.server';

const AUTH_HEADER = 'authorization';

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const expectedToken = process.env.ROTATION_CRON_TOKEN;

  if (!expectedToken) {
    return json({ error: 'Cron token not configured' }, { status: 500 });
  }

  const token = extractBearerToken(request.headers.get(AUTH_HEADER));

  if (token !== expectedToken) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await processDueRotations({ executeSwap: executeRotationSwap });
    return json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ ok: false, error: message }, { status: 500 });
  }
};

function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return null;
  return token ?? null;
}
