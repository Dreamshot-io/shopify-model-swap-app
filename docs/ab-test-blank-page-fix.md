# A/B Test Blank Page Fix

## Issue Summary

After creating an A/B test successfully, the page would go blank with the following error in the browser console:

```
app-bridge.js:1 Uncaught (in promise) Error: ?shopify-reload must be same-origin (https://app.dev.dreamshot.io !== https://abtest.dreamshot.io)
```

## Root Cause Analysis

### Primary Issue: Improper Navigation Method

The application was using `window.location.reload()` after A/B test operations (create, start, stop, delete). This is problematic in Shopify embedded apps because:

1. **Shopify App Bridge Security**: App Bridge enforces strict same-origin policy for reload operations
2. **URL Origin Mismatch**: The runtime URL (`app.dev.dreamshot.io`) didn't match the configured application URL (`abtest.dreamshot.io`) in `shopify.app.toml`
3. **Security Validation Failure**: When App Bridge detects a URL mismatch during reload, it blocks the operation and throws an error, resulting in a blank page

### Secondary Issue: URL Configuration Inconsistency

- Configured URL in `shopify.app.toml`: `https://abtest.dreamshot.io`
- Runtime access URL: `https://app.dev.dreamshot.io`
- The subtle difference (period vs hyphen) causes App Bridge's same-origin check to fail

## The Solution

### Code Changes

Replaced `window.location.reload()` with Remix's `useRevalidator()` hook in `/app/routes/app.ai-studio.tsx`:

**Before:**

```typescript
if (data?.ok && intent === 'createABTest') {
	shopify.toast.show('A/B test created successfully! 🎉');
	window.location.reload(); // ❌ Causes blank page
}
```

**After:**

```typescript
const revalidator = useRevalidator();

if (data?.ok && intent === 'createABTest') {
	shopify.toast.show('A/B test created successfully! 🎉');
	revalidator.revalidate(); // ✅ Proper Remix pattern
}
```

### Why This Works

1. **Remix Navigation Pattern**: `useRevalidator().revalidate()` is the correct Remix way to refresh loader data
2. **Avoids App Bridge Security**: Doesn't trigger browser-level reload, so no same-origin check
3. **Better Performance**: Only revalidates loader data instead of full page reload
4. **No Blank Screen**: Stays within the Remix/React rendering lifecycle
5. **Follows Best Practices**: Aligns with Remix documentation and CLAUDE.md guidelines

### Benefits

- ✅ No more blank page after A/B test operations
- ✅ Faster UI updates (partial refresh vs full reload)
- ✅ Maintains user state and scroll position
- ✅ Works correctly with Shopify App Bridge
- ✅ Follows Remix best practices
- ✅ Better user experience

## Files Modified

- `/app/routes/app.ai-studio.tsx`
    - Added `useRevalidator` import from `@remix-run/react`
    - Added `revalidator` hook initialization
    - Replaced 4 instances of `window.location.reload()` with `revalidator.revalidate()`
    - Updated useEffect dependencies to include `revalidator`

## Testing Checklist

- [x] Import `useRevalidator` hook
- [x] Initialize revalidator in component
- [x] Replace all `window.location.reload()` calls
- [x] Update dependency arrays
- [ ] Test A/B test creation - verify new test appears without blank page
- [ ] Test A/B test start - verify status updates correctly
- [ ] Test A/B test stop - verify status updates correctly
- [ ] Test A/B test deletion - verify test is removed from list
- [ ] Verify toast notifications still appear
- [ ] Verify no console errors

## Prevention Recommendations

1. **Never use `window.location.reload()`** in embedded Shopify apps
2. **Always use Remix navigation patterns**:
    - `useRevalidator()` for refreshing loader data
    - `useNavigate()` for route changes
    - `useFetcher()` for form submissions without navigation
3. **Update CLAUDE.md** to explicitly warn against `window.location.reload()`
4. **Add ESLint rule** to prevent `window.location.reload()` usage

## Related Documentation

- [Remix useRevalidator Documentation](https://remix.run/docs/en/main/hooks/use-revalidator)
- [Shopify App Bridge Security](https://shopify.dev/docs/api/app-bridge)
- Project: `/docs/CLAUDE.md` - React/Remix patterns section

## Additional Notes

### URL Mismatch Issue

While the fix resolves the immediate problem, there's still a URL configuration inconsistency:

- `shopify.app.toml` has `abtest.dreamshot.io`
- Runtime shows `app.dev.dreamshot.io`

This should be investigated separately to ensure consistent configuration, though it's no longer blocking functionality.

### Future Improvements

Consider adding a helper hook for common revalidation patterns:

```typescript
// app/hooks/useShopifyRevalidate.ts
export function useShopifyRevalidate() {
	const revalidator = useRevalidator();
	const shopify = useAppBridge();

	return useCallback(
		(message: string, isError = false) => {
			shopify.toast.show(message, { isError });
			revalidator.revalidate();
		},
		[revalidator, shopify],
	);
}

// Usage:
const revalidate = useShopifyRevalidate();
revalidate('A/B test created successfully! 🎉');
```

This would further simplify the code and ensure consistent patterns across the app.
