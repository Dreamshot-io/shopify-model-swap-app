/**
 * Simple in-memory rate limiter for public endpoints
 * In production, use Redis or similar for distributed rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 100, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Clean up old entries every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.limits.entries()) {
        if (entry.resetTime < now) {
          this.limits.delete(key);
        }
      }
    }, 60000);
  }

  /**
   * Check if request should be allowed
   */
  check(identifier: string): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const entry = this.limits.get(identifier);

    if (!entry || entry.resetTime < now) {
      // New window
      this.limits.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
      });

      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: now + this.windowMs,
      };
    }

    if (entry.count >= this.maxRequests) {
      // Rate limit exceeded
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
      };
    }

    // Increment count
    entry.count++;
    return {
      allowed: true,
      remaining: this.maxRequests - entry.count,
      resetTime: entry.resetTime,
    };
  }

  /**
   * Get identifier from request (IP or fallback)
   */
  static getIdentifier(request: Request): string {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      'unknown';

    // For tracking endpoints, also consider test ID
    const url = new URL(request.url);
    const testId = url.searchParams.get('testId');

    return testId ? `${ip}:${testId}` : ip;
  }
}

// Create singleton instances for different endpoints
export const trackingRateLimiter = new RateLimiter(60, 60000); // 60 requests per minute
export const rotationStateRateLimiter = new RateLimiter(120, 60000); // 120 requests per minute

/**
 * Apply rate limiting to a request
 */
export function applyRateLimit(
  request: Request,
  limiter: RateLimiter
): {
  allowed: boolean;
  headers: Record<string, string>;
  message?: string;
} {
  const identifier = RateLimiter.getIdentifier(request);
  const result = limiter.check(identifier);

  const headers = {
    'X-RateLimit-Limit': String(limiter['maxRequests']),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': new Date(result.resetTime).toISOString(),
  };

  if (!result.allowed) {
    return {
      allowed: false,
      headers,
      message: 'Rate limit exceeded. Please try again later.',
    };
  }

  return { allowed: true, headers };
}