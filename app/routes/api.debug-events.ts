import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '../shopify.server';
import db from '../db.server';

/**
 * Debug endpoint to check event tracking status
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.admin(request);
  } catch (error) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get event counts by type and case
    const eventCounts = await db.aBTestEvent.groupBy({
      by: ['eventType', 'activeCase'],
      _count: {
        id: true,
      },
    });

    // Get total events
    const totalEvents = await db.aBTestEvent.count();

    // Get recent impressions
    const recentImpressions = await db.aBTestEvent.findMany({
      where: { eventType: 'IMPRESSION' },
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        test: {
          select: {
            id: true,
            name: true,
            productId: true,
            currentCase: true,
          },
        },
      },
    });

    // Get active tests
    const activeTests = await db.aBTest.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        productId: true,
        currentCase: true,
        status: true,
        _count: {
          select: {
            events: true,
          },
        },
      },
    });

    // Get all events for active tests
    const allEvents = await db.aBTestEvent.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        testId: true,
        eventType: true,
        activeCase: true,
        productId: true,
        sessionId: true,
        createdAt: true,
      },
    });

    return json({
      summary: {
        totalEvents,
        eventCounts,
      },
      activeTests,
      recentImpressions,
      allEvents,
    });
  } catch (error) {
    console.error('Debug events error:', error);
    return json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
};
