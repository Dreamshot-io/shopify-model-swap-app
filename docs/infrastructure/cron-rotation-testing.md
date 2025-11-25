# Cron Rotation Testing Guide

## Overview

The A/B test rotation system uses Vercel Cron Jobs to automatically rotate between BASE and TEST images at scheduled intervals.

## Current Configuration

- **Schedule**: Every 10 minutes (`*/10 * * * *`)
- **Endpoint**: `/api/rotation`
- **Config File**: `vercel.json`

## How It Works

1. **Vercel Cron** calls `/api/rotation` every 10 minutes
2. **Rotation Service** queries for tests where `nextRotation <= NOW`
3. **For each test due**:
   - Swaps images (BASE ↔ TEST)
   - Updates `currentCase`
   - Sets new `nextRotation` (current + rotationHours)
   - Logs the rotation

## Testing Scripts

### 1. Check Cron Status
```bash
bun run scripts/test-cron-simple.ts
```
Shows:
- Tests due for rotation
- All active tests and their schedules
- Time until next rotation

### 2. Trigger Rotation Now
```bash
# Trigger first active test
bun run scripts/trigger-rotation-now.ts

# Trigger specific test
bun run scripts/trigger-rotation-now.ts <testId>
```
This sets `nextRotation` to NOW, making the test eligible for immediate rotation.

### 3. Full System Test
```bash
bun run scripts/test-cron-rotation.ts
```
Comprehensive test including:
- Rotation queue status
- Historical rotation logs
- Configuration verification
- Known issues detection

## Manual Testing

### Test the Rotation Endpoint

1. **Set environment variable**:
```bash
echo "ROTATION_CRON_TOKEN=your-secret-token" >> .env
```

2. **Call endpoint manually**:
```bash
curl -X POST https://abtest.dreamshot.io/api/rotation \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json"
```

### Simulate Cron Job Locally

```bash
# Check what would be rotated
bun run scripts/test-cron-simple.ts

# Force rotation of active test
bun run scripts/trigger-rotation-now.ts
```

## Known Issues & Solutions

### Issue 1: Authentication in Multi-Shop Environment
**Problem**: Cron job needs admin context for each shop but has no session
**Current State**: Works for single shop, fails for multi-shop
**Solution**: Need to implement shop-specific token storage or OAuth refresh

### Issue 2: Tests Not Rotating
**Common Causes**:
1. `nextRotation` not set when test activated
2. Test status not `ACTIVE`
3. Missing images (BASE or TEST)

**Debug**:
```bash
# Check test status
bun run scripts/test-cron-simple.ts

# Force rotation
bun run scripts/trigger-rotation-now.ts
```

### Issue 3: Cron Not Running
**Verify on Vercel**:
1. Check Vercel dashboard → Functions → Cron
2. Look for `/api/rotation` executions
3. Check function logs for errors

## Rotation Schedule Examples

| Rotation Hours | Frequency |
|---------------|-----------|
| 1 | Every hour |
| 6 | 4 times per day |
| 12 | Twice per day |
| 24 | Daily |
| 168 | Weekly |

## Monitoring

### Check Recent Rotations
```bash
# In your app
Visit: /app/ab-tests/{testId}
Look for rotation history

# Via database
bun run scripts/check-abtests.ts
```

### Watch Events in Real-Time
```bash
bun run scripts/monitor-events.ts
```

## Troubleshooting

### Test Shows "OVERDUE"
```bash
# Trigger immediate rotation
bun run scripts/trigger-rotation-now.ts <testId>
```

### Rotation Fails
Check:
1. Test has both BASE and TEST images
2. Test status is ACTIVE
3. Shop session is valid
4. Product still exists in Shopify

### Cron Endpoint Returns 401
1. Check `ROTATION_CRON_TOKEN` is set
2. Verify token matches in request
3. Ensure Vercel cron header is present

## Best Practices

1. **Start with longer intervals** (24h) to test stability
2. **Monitor first rotations** closely
3. **Check impression tracking** aligns with rotations
4. **Verify image quality** after each rotation
5. **Document rotation patterns** for analysis

## API Reference

### GET/POST /api/rotation
Triggers rotation for all due tests.

**Headers**:
- `Authorization: Bearer <token>` (for manual trigger)
- `x-vercel-cron: 1` (automatically set by Vercel)

**Response**:
```json
{
  "ok": true,
  "summary": {
    "processed": 1,
    "successful": 1,
    "failed": 0,
    "duration": 2341,
    "results": [...]
  }
}
```
