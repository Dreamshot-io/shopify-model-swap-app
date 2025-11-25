# How to Use the Rotation Management UI

## Prerequisites

Rotation slots are **automatically created** when you **start** an A/B test. If you don't see rotation management options, the test might not be started yet.

## Step-by-Step Guide

### 1. Create an A/B Test

1. Go to `/app/ab-tests` in Shopify admin
2. Click "Create Test"
3. Fill in:
   - Test name
   - Product ID (e.g., `gid://shopify/Product/123456789`)
   - Variant A images (comma-separated URLs or JSON array)
   - Variant B images (comma-separated URLs or JSON array)
4. Click "Create Test"

### 2. Start the Test

1. Find your test in the list
2. Click the **"Start"** button
3. This will:
   - Create rotation slots automatically
   - Snapshot current product images as control media
   - Set up the rotation schedule (10-minute intervals)

### 3. Manage Rotations

1. Look at the **"Rotation"** column in the tests table
2. You'll see either:
   - **"Configure"** button (if no slots exist yet)
   - **Rotation status** with "Manage" button (if slots exist)

3. Click **"Manage"** to open the rotation management modal
4. You'll see:
   - **Slot ID** (for API testing)
   - **Active variant** (CONTROL or TEST)
   - **Interval** (10 minutes)
   - **Last switch** timestamp
   - **Next switch** scheduled time
   - **"Activate Control"** and **"Activate Test"** buttons
   - **Recent switches** history

### 4. Force a Rotation

In the rotation management modal:
- Click **"Activate Control"** → Forces Variant A (original images)
- Click **"Activate Test"** → Forces Variant B (test images)

This immediately:
- Updates Shopify product images
- Records the switch in history
- Reschedules next automatic switch

## Troubleshooting

### "I don't see rotation options"

**Check**:
1. Is the test status **"RUNNING"**? (not DRAFT)
2. Did you click **"Start"** after creating the test?
3. Refresh the page after starting a test

### "Rotation column shows 'Configure' but nothing happens"

This means rotation slots haven't been created yet. They're created automatically when you start a test. If you see this on a RUNNING test, there might be an error - check browser console.

### "I want to test before starting"

You can manually create rotation slots using the debug API, but the easiest way is to:
1. Start the test (creates slots)
2. Use the "Manage" UI to force rotations
3. Stop the test if needed

## What Gets Created

When you start a test:

**For Product-Wide Tests**:
- 1 rotation slot (for the entire product)
- Control media = current product images
- Test media = Variant A images

**For Variant-Scoped Tests**:
- 1 rotation slot per Shopify variant
- Each slot rotates between control and test images for that variant

## Visual Guide

```
A/B Tests Page
├── Test Name
├── Product ID
├── Status (DRAFT/RUNNING)
├── Rotation Column ← Look here!
│   ├── "Configure" (if not started)
│   └── "Manage" button (if started)
├── Variant A Stats
├── Variant B Stats
└── Actions (Start/Stop/Delete)

Click "Manage" →
└── Rotation Management Modal
    ├── Slot ID (for API)
    ├── Active Variant (CONTROL/TEST)
    ├── Interval (10 min)
    ├── Last/Next Switch times
    ├── [Activate Control] [Activate Test] buttons
    └── Recent switches history
```
