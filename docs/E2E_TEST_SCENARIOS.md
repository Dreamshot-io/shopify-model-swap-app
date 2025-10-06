# End-to-End Test Scenarios for Image Upload Fixes

## Overview
This document outlines comprehensive E2E test scenarios to verify all fixes for the image upload functionality in the AI Studio feature.

## Test Environment Setup

### Prerequisites
- Shopify development store with test products
- Test user with appropriate permissions
- Sample test images in JPG, PNG, and WebP formats
- Network connectivity for Shopify API calls

### Test Data
- **Test Product ID**: `gid://shopify/Product/test-123`
- **Test JPG Image**: `test-hoodie.jpg` (2MB)
- **Test WebP Image**: `modern-portrait.webp` (1.5MB)
- **Test PNG Image**: `product-detail.png` (3MB)
- **Large Image**: `oversized.jpg` (12MB - exceeds limit)

## Critical Bug Fix Verification Scenarios

### Scenario 1: Prisma EventType Error Fix ✅
**Fixed Issue**: Prisma validation errors when logging upload events

#### Test Steps:
1. Navigate to AI Studio page for a product
2. Click "Upload Images" section
3. Select a JPG file
4. Click the Upload button
5. Monitor browser console for errors
6. Check server logs for database errors

#### Expected Results:
- ✅ No Prisma validation errors in console
- ✅ Event successfully logged with type "UPLOADED"
- ✅ No database connection errors
- ✅ Upload completes successfully

#### Verification Query:
```sql
SELECT * FROM MetricEvent
WHERE type = 'UPLOADED'
ORDER BY createdAt DESC
LIMIT 5;
```

---

### Scenario 2: UI Refresh Issue Fix ✅
**Fixed Issue**: Images not appearing immediately in Product Gallery after upload

#### Test Steps:
1. Navigate to AI Studio page
2. Note current images in Product Gallery
3. Upload a new image via drag-and-drop
4. Observe Product Gallery immediately after upload completes

#### Expected Results:
- ✅ Uploaded image appears instantly in Product Gallery
- ✅ "Library" badge visible on new image
- ✅ No page refresh required
- ✅ Image count updates automatically
- ✅ Loading states transition smoothly

#### Manual Verification:
- Count images before: X
- Count images after: X + 1
- Time to visibility: < 1 second after upload completes

---

### Scenario 3: Library Section Removal ✅
**Fixed Issue**: Duplicate library section in UI causing confusion

#### Test Steps:
1. Navigate to AI Studio page
2. Review the Image Generation tab
3. Check for library images display

#### Expected Results:
- ✅ No separate "Library" section in Image Generation tab
- ✅ All library images visible in Product Gallery with badges
- ✅ Clear distinction between published (green badge) and library (gray badge) images
- ✅ Unified image management interface

---

### Scenario 4: Upload Button Placement Fix ✅
**Fixed Issue**: Upload button inside drop zone triggering file finder

#### Test Steps:
1. Navigate to AI Studio upload section
2. Add files via drag-and-drop or click
3. Observe upload button placement
4. Click the Upload button
5. Click the Clear all button

#### Expected Results:
- ✅ Upload button appears OUTSIDE the drop zone
- ✅ Clicking Upload button does NOT open file finder
- ✅ Clear all button also outside drop zone
- ✅ Progress bar displays outside drop zone during upload
- ✅ All interactive elements properly separated

---

## Comprehensive Feature Testing Scenarios

### Scenario 5: JPG Image Upload Flow
#### Test Steps:
1. Navigate to AI Studio for a product
2. Click drop zone or drag a JPG file
3. Verify file preview appears
4. Click Upload button
5. Monitor progress bar
6. Check Product Gallery after completion

#### Expected Results:
- ✅ JPG file accepted
- ✅ Preview shows correctly
- ✅ Progress bar shows upload progress
- ✅ Success message appears
- ✅ Image appears in gallery with "Library" badge
- ✅ Event logged with type "UPLOADED"

---

### Scenario 6: WebP Image Upload Flow
#### Test Steps:
1. Navigate to AI Studio
2. Drag and drop a WebP file
3. Verify WebP preview renders
4. Upload the file
5. Check gallery display

#### Expected Results:
- ✅ WebP file accepted without errors
- ✅ Preview displays correctly
- ✅ Upload completes successfully
- ✅ WebP image visible in Product Gallery
- ✅ Proper badge and metadata displayed

---

### Scenario 7: Multiple File Upload
#### Test Steps:
1. Select multiple images (JPG, PNG, WebP)
2. Verify all previews display
3. Click Upload X images button
4. Monitor sequential upload progress
5. Verify gallery updates

#### Expected Results:
- ✅ All file types accepted
- ✅ Correct count in upload button
- ✅ Progress updates for each file
- ✅ All images appear in gallery
- ✅ Proper order maintained

---

### Scenario 8: Error Handling - File Size
#### Test Steps:
1. Attempt to upload file > 10MB
2. Observe error message
3. Try uploading valid file after error

#### Expected Results:
- ✅ Clear error message about file size
- ✅ File not added to upload queue
- ✅ Can still upload valid files
- ✅ Error dismissible

---

### Scenario 9: Error Handling - Network Issues
#### Test Steps:
1. Start upload of valid file
2. Simulate network interruption (dev tools)
3. Observe error handling
4. Retry upload

#### Expected Results:
- ✅ Appropriate error message displayed
- ✅ Upload can be retried
- ✅ No duplicate uploads
- ✅ UI remains functional

---

### Scenario 10: Library Management
#### Test Steps:
1. Upload new image to library
2. Publish library image to product
3. Remove image from library
4. Delete published image

#### Expected Results:
- ✅ Library operations work correctly
- ✅ Badges update appropriately
- ✅ Confirmation modals appear
- ✅ Counts update correctly
- ✅ All events logged properly

---

## Performance Testing Scenarios

### Scenario 11: Upload Performance
#### Test Steps:
1. Upload 5MB image
2. Measure time to complete
3. Check memory usage

#### Expected Results:
- ✅ Upload completes in < 30 seconds
- ✅ No memory leaks
- ✅ UI remains responsive
- ✅ Progress updates smoothly

---

### Scenario 12: Gallery Performance
#### Test Steps:
1. Load product with 20+ images
2. Upload additional image
3. Measure render time

#### Expected Results:
- ✅ Gallery loads in < 2 seconds
- ✅ New image appears immediately
- ✅ Smooth scrolling
- ✅ No layout shifts

---

## Accessibility Testing

### Scenario 13: Keyboard Navigation
#### Test Steps:
1. Navigate upload section with keyboard only
2. Select files using Enter/Space
3. Upload using keyboard
4. Navigate gallery with Tab

#### Expected Results:
- ✅ All controls keyboard accessible
- ✅ Focus indicators visible
- ✅ Proper tab order
- ✅ Screen reader announcements

---

## Regression Testing Checklist

### Component Tests to Run:
- [ ] `ImageUploader.test.tsx` - All 30+ tests passing
- [ ] `ProductGallery.test.tsx` - All 25+ tests passing
- [ ] `library.server.test.ts` - All handler tests passing
- [ ] `upload-integration.test.ts` - All integration tests passing

### Manual Regression Checks:
- [ ] Existing AI generation features still work
- [ ] Product image publishing works
- [ ] Draft saving functionality intact
- [ ] Navigation between tabs smooth
- [ ] No console errors in production build
- [ ] Mobile responsive layout maintained

---

## Test Execution Matrix

| Scenario | Priority | Automated | Manual | Pass/Fail |
|----------|----------|-----------|---------|-----------|
| Prisma Error Fix | Critical | ✅ | ✅ | |
| UI Refresh Fix | Critical | ✅ | ✅ | |
| Library Removal | High | ✅ | ✅ | |
| Button Placement | Critical | ✅ | ✅ | |
| JPG Upload | High | ✅ | ✅ | |
| WebP Upload | High | ✅ | ✅ | |
| Multiple Files | Medium | ✅ | ✅ | |
| Error Handling | High | ✅ | ✅ | |
| Performance | Medium | ⚠️ | ✅ | |
| Accessibility | Medium | ⚠️ | ✅ | |

Legend:
- ✅ Fully covered
- ⚠️ Partially covered
- ❌ Not covered

---

## Test Data Cleanup

After testing:
1. Remove test uploads from library
2. Clean test product images
3. Clear browser cache
4. Reset test environment

---

## Known Issues & Limitations

### Current Limitations:
- Maximum 5 files per upload batch
- 10MB file size limit per image
- Supported formats: JPG, PNG, WebP only

### Edge Cases to Monitor:
- Very slow network connections
- Concurrent uploads from multiple tabs
- Session timeout during upload
- Browser memory limits with many previews

---

## Test Report Template

```markdown
### Test Execution Report
**Date**: [Date]
**Tester**: [Name]
**Environment**: [Dev/Staging/Production]

#### Summary:
- Total Scenarios: 13
- Passed: [X]
- Failed: [Y]
- Blocked: [Z]

#### Critical Fixes Verified:
- [ ] Prisma EventType error resolved
- [ ] UI refresh issue fixed
- [ ] Library section properly removed
- [ ] Upload button placement corrected

#### Issues Found:
[List any new issues discovered]

#### Recommendations:
[Any recommendations for improvements]
```

---

## Automated Test Commands

```bash
# Run all unit tests
npm test -- app/features/ai-studio/components/__tests__/

# Run integration tests
npm test -- app/features/ai-studio/__tests__/

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- ImageUploader.test.tsx

# Run in watch mode for development
npm test -- --watch
```

---

## Conclusion

This comprehensive E2E testing plan ensures all fixes are working correctly and no regressions have been introduced. The test scenarios cover:

1. **All four critical bug fixes** with specific verification steps
2. **Feature completeness** including WebP support
3. **Error handling** for edge cases
4. **Performance** considerations
5. **Accessibility** requirements
6. **Regression** prevention

Execute all scenarios before deployment to production.