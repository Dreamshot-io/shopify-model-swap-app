# Simplified Tracking - No Deduplication

## Current Behavior

**Every page visit = 1 impression tracked** ✅

- No client-side deduplication
- No server-side deduplication
- Simple and straightforward

## What Changed

### Before (With Deduplication)
- Client checks `sessionStorage` before tracking
- Server checks database for duplicates
- Only 1 impression per session per case

### After (Simplified)
- Client always tracks on page visit
- Server always creates new event
- Every visit = new impression

## Benefits

✅ **Simple** - No complex logic
✅ **Reliable** - Always tracks
✅ **Easy to debug** - Clear behavior
✅ **Flexible** - Can add deduplication later if needed

## Trade-offs

⚠️ **Page refreshes** = Multiple impressions
⚠️ **Same session** = Multiple impressions

If you need deduplication later, we can add it back with proper logic.
