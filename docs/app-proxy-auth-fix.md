# App Proxy Authentication Fix for Pixel Requests

## Problem

Logs showed:
```
[shopify-app/INFO] Query does not contain a signature value. | {shop: null}
```

**Root Cause**: Pixel requests from storefront don't have app proxy signatures, but code was trying to authenticate them first, causing errors.

## Solution

### Before (Problematic)
```typescript
// Always tries app proxy auth first
try {
  const { session, cors } = await authenticate.public.appProxy(request);
  // ...
} catch {
  // Falls back to public access
}
```

**Issue**: Even though it catches errors, the authentication attempt logs errors and may cause issues.

### After (Fixed)
```typescript
// Check if signature present (admin requests) vs pixel requests (no signature)
const hasSignature = url.searchParams.has('signature') ||
                     request.headers.get('x-shopify-hmac-sha256');

if (hasSignature) {
  // Only try app proxy auth if signature present
  try {
    const { session, cors } = await authenticate.public.appProxy(request);
    // ...
  } catch {
    // Handle invalid signature
  }
}

// Always set CORS for pixel requests (direct browser calls)
if (!corsHeaders['Access-Control-Allow-Origin']) {
  corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    // ...
  };
}
```

## Changes Made

### 1. `/app/routes/api.rotation-state.ts`
- ✅ Check for signature before attempting auth
- ✅ Skip auth for pixel requests (no signature)
- ✅ Always set CORS headers
- ✅ Handle OPTIONS preflight

### 2. `/app/routes/track.tsx`
- ✅ Check for signature before attempting auth
- ✅ Skip auth for pixel requests (no signature)
- ✅ Always set CORS headers
- ✅ Handle OPTIONS preflight

## Why This Fixes It

**Pixel requests** (from storefront):
- No signature (direct browser fetch)
- Should use public CORS access
- No authentication needed

**Admin requests** (from app):
- Have signature (app proxy)
- Should authenticate
- Get shop context

## Testing

After fix, you should see:
- ✅ No more "Query does not contain a signature value" errors for pixel requests
- ✅ Pixel requests succeed with CORS headers
- ✅ Admin requests still authenticate properly
- ✅ Events start recording

## Verification

1. **Check server logs** - Should see no signature errors for pixel requests
2. **Check browser console** - Pixel should successfully call APIs
3. **Check Network tab** - Requests should return 200 OK
4. **Check database** - Events should start recording
