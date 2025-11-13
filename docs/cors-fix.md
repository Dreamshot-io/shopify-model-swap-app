# CORS Preflight Fix

## Problem

Error: `Access to fetch at 'https://shopify-txl.dreamshot.io/track' from origin 'https://genlabs-dev-store.myshopify.com' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.`

**Root Cause**: POST requests trigger CORS preflight (OPTIONS request), but Remix routes OPTIONS to the `loader`, not the `action`.

## Solution Applied

### 1. Added Loader for OPTIONS
```typescript
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return json({}, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
      }
    });
  }
  // ...
};
```

### 2. Added Access-Control-Max-Age
Caches preflight responses for 24 hours to reduce overhead.

### 3. Updated Both Endpoints
- `/track` - POST endpoint (now handles OPTIONS in loader)
- `/api/rotation-state` - GET endpoint (already had OPTIONS handler)

## How CORS Preflight Works

1. Browser sends OPTIONS request (preflight)
2. Server responds with CORS headers
3. Browser checks headers
4. If OK, browser sends actual POST request
5. Server processes POST request

## Testing

After fix, visiting product page should:
1. ✅ OPTIONS request succeeds (200 OK with CORS headers)
2. ✅ POST /track request succeeds (200 OK)
3. ✅ Event saved to database
4. ✅ No CORS errors in console

## Expected Flow

```
Pixel → POST /track
  ↓
Browser → OPTIONS /track (preflight)
  ↓
Server → 200 OK with CORS headers
  ↓
Browser → POST /track (actual request)
  ↓
Server → 200 OK, event saved
```
