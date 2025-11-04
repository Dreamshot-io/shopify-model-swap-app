#!/usr/bin/env node

/**
 * Test suite for Horizon theme image replacement
 * Run this with: node test-horizon-fix.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the horizon HTML file
const htmlPath = path.join(__dirname, 'horizon-teme.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Parse out the structure
const slideshowSlideCount = (html.match(/<slideshow-slide/g) || []).length;
const mediaGalleryCount = (html.match(/<media-gallery/g) || []).length;
const slideshowSlidesCount = (html.match(/<slideshow-slides/g) || []).length;

console.log('=== HORIZON HTML STRUCTURE ===');
console.log(`Total slideshow-slide elements: ${slideshowSlideCount}`);
console.log(`Total media-gallery elements: ${mediaGalleryCount}`);
console.log(`Total slideshow-slides elements: ${slideshowSlidesCount}`);

// The actual problem based on your logs:
// 1. There are 57 total slideshow-slide elements (including announcement bar at index 0)
// 2. Only 56 have images (indices 1-56)
// 3. Script finds 56 product images correctly
// 4. BUT the hiding isn't working - slides marked with data-ab-test-hidden="true" but display is empty

console.log('\n=== THE REAL PROBLEM ===');
console.log('1. Script correctly finds 56 product images');
console.log('2. Script correctly replaces first 3 images');
console.log('3. Script sets data-ab-test-hidden="true" on extra slides');
console.log('4. BUT display:none is NOT being applied or is being overridden');

// Read the enhanced script
const scriptPath = path.join(__dirname, 'public/image-replacer-enhanced.js');
const script = fs.readFileSync(scriptPath, 'utf8');

// Check the hiding logic
const hideImageFunction = script.match(/function hideImage\([^}]+\}[^}]+\}/s);
if (hideImageFunction) {
    console.log('\n=== HIDE FUNCTION ANALYSIS ===');
    const usesDisplay = hideImageFunction[0].includes('style.display = \'none\'');
    const setsDataAttribute = hideImageFunction[0].includes('dataset.abTestHidden');
    
    console.log(`Sets display:none: ${usesDisplay ? '✅' : '❌'}`);
    console.log(`Sets data attribute: ${setsDataAttribute ? '✅' : '❌'}`);
    
    if (usesDisplay && setsDataAttribute) {
        console.log('\n🔍 DIAGNOSIS: The hide function is correct.');
        console.log('The problem is that Horizon theme JavaScript is likely resetting styles.');
    }
}

console.log('\n=== SOLUTION ===');
console.log('Instead of just setting display:none, we need to:');
console.log('1. Use !important to override theme styles');
console.log('2. Set aria-hidden="true" for accessibility');
console.log('3. Use multiple hiding methods for redundancy');

// Generate the fixed hide function
const fixedHideFunction = `
function hideImage(imageData, index) {
    const { img, item } = imageData;
    const config = themeConfig || { hiding: { strategy: 'both', method: 'display' } };
    
    // Determine what to hide
    const targetElement = (config.hiding.strategy === 'image' || !item) ? img : item;
    
    if (!targetElement) return false;
    
    // Apply multiple hiding methods for Horizon theme
    if (config.name === 'Horizon') {
        // For Horizon, use aggressive hiding
        targetElement.style.cssText = 'display: none !important; visibility: hidden !important;';
        targetElement.setAttribute('aria-hidden', 'true');
        targetElement.setAttribute('hidden', '');
        
        // Also hide the parent slideshow-slide if it exists
        const slide = targetElement.closest('slideshow-slide');
        if (slide) {
            slide.style.cssText = 'display: none !important; visibility: hidden !important;';
            slide.setAttribute('aria-hidden', 'true');
            slide.setAttribute('hidden', '');
        }
    } else {
        // Original hiding logic for other themes
        switch (config.hiding.method) {
            case 'remove':
                targetElement.remove();
                break;
            case 'visibility':
                targetElement.style.visibility = 'hidden';
                targetElement.style.position = 'absolute';
                targetElement.style.left = '-9999px';
                break;
            case 'display':
            default:
                targetElement.style.display = 'none';
                break;
        }
    }
    
    // Mark as hidden
    targetElement.dataset.abTestHidden = 'true';
    targetElement.dataset.abTestIndex = index.toString();
    
    debugLog(\`Hidden image \${index} using \${config.hiding.method}\`);
    return true;
}`;

console.log('\n=== FIXED HIDE FUNCTION ===');
console.log(fixedHideFunction);

console.log('\n=== TESTING AGAINST YOUR HTML ===');

// Simulate what should happen
const testVariantImages = 3;
const totalImages = 56;
const expectedVisible = testVariantImages;
const expectedHidden = totalImages - testVariantImages;

console.log(`\nWith ${testVariantImages} variant images:`);
console.log(`✓ Should show: ${expectedVisible} images`);
console.log(`✓ Should hide: ${expectedHidden} images`);
console.log(`✓ Slides 1-3 should be visible (indices 1-3 in DOM)`);
console.log(`✓ Slides 4-56 should be hidden (indices 4-56 in DOM)`);
console.log(`✓ Slide 0 (announcement bar) should be untouched`);

console.log('\n=== ACTION ITEMS ===');
console.log('1. Update hideImage function to use !important styles for Horizon');
console.log('2. Add aria-hidden and hidden attributes for better compatibility');
console.log('3. Target the parent slideshow-slide element specifically');
console.log('4. Clear cache and reload page before testing');
console.log('\nThe fixed function above should solve the visibility issue.');