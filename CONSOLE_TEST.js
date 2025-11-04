// =====================================================
// HORIZON THEME - CONSOLE TEST SCRIPT
// Copy and paste this entire file into browser console
// =====================================================

console.log('%c🎨 Horizon Theme AB Test - Console Test', 'font-size: 16px; font-weight: bold; color: #4CAF50');
console.log('='.repeat(60));

// Test 1: Script loaded
console.log('%c\n📦 TEST 1: Script Loading', 'font-weight: bold; color: #2196F3');
const scriptLoaded = !!window.__abTest;
console.log('Script loaded:', scriptLoaded ? '✅ YES' : '❌ NO');
if (scriptLoaded) {
  console.log('Script version:', window.__abTest.version);
  console.log('Debug mode:', window.__abTest.DEBUG_MODE ? 'ON' : 'OFF');
} else {
  console.error('❌ FAILED: Script not loaded. Check if AB test extension is installed.');
}

// Test 2: Theme detection
console.log('%c\n🎨 TEST 2: Theme Detection', 'font-weight: bold; color: #2196F3');
if (scriptLoaded) {
  const theme = window.__abTest.detectTheme();
  console.log('Detected theme:', theme);
  
  if (theme === 'horizon') {
    console.log('✅ PASS: Horizon theme detected correctly');
  } else {
    console.warn('⚠️ FAIL: Expected "horizon", got "' + theme + '"');
    console.log('Running diagnostics...');
    
    // Diagnostic checks
    const markers = {
      'media-gallery': !!document.querySelector('media-gallery'),
      'slideshow-component': !!document.querySelector('slideshow-component'),
      'slideshow-slide': !!document.querySelector('slideshow-slide'),
      '[data-presentation]': !!document.querySelector('[data-presentation]')
    };
    console.table(markers);
  }
}

// Test 3: Gallery detection
console.log('%c\n🖼️  TEST 3: Gallery Detection', 'font-weight: bold; color: #2196F3');
if (scriptLoaded) {
  const gallery = window.__abTest.findGalleryContainer();
  
  if (gallery) {
    console.log('✅ Gallery found');
    console.table({
      'Theme': gallery.theme,
      'Method': gallery.method,
      'Image Count': gallery.images.length,
      'Container Tag': gallery.container.tagName.toLowerCase(),
      'Structured': gallery.structured ? 'Yes' : 'No'
    });
    
    if (gallery.theme === 'Horizon' && gallery.method === 'theme-specific') {
      console.log('✅ PASS: Gallery found using Horizon-specific selectors');
    } else {
      console.warn('⚠️ Using fallback detection method');
    }
  } else {
    console.error('❌ FAIL: No gallery found');
  }
}

// Test 4: Gallery structure
console.log('%c\n🏗️  TEST 4: Gallery Structure', 'font-weight: bold; color: #2196F3');
const structure = {
  'media-gallery': document.querySelectorAll('media-gallery').length,
  'slideshow-component': document.querySelectorAll('slideshow-component').length,
  'slideshow-slides': document.querySelectorAll('slideshow-slides').length,
  'slideshow-slide': document.querySelectorAll('slideshow-slide').length,
  'Total images': document.querySelectorAll('slideshow-slide img').length
};
console.table(structure);

const hasValidStructure = structure['media-gallery'] > 0 && 
                          structure['slideshow-slide'] > 0 && 
                          structure['Total images'] > 0;
if (hasValidStructure) {
  console.log('✅ PASS: Valid Horizon gallery structure found');
} else {
  console.warn('⚠️ Gallery structure incomplete');
}

// Test 5: Image replacement simulation
console.log('%c\n🔄 TEST 5: Image Replacement (Simulated)', 'font-weight: bold; color: #2196F3');
if (scriptLoaded && window.__abTest.findGalleryContainer()) {
  const testImages = [
    'https://placehold.co/600x600/FF6B6B/FFFFFF?text=Variant+1',
    'https://placehold.co/600x600/4ECDC4/FFFFFF?text=Variant+2',
    'https://placehold.co/600x600/45B7D1/FFFFFF?text=Variant+3'
  ];
  
  console.log('Attempting to replace with', testImages.length, 'variant images...');
  
  const success = window.__abTest.replaceImages(testImages, 'A');
  
  setTimeout(() => {
    const stats = {
      'Replacement Success': success ? 'Yes' : 'No',
      'Variant Images': testImages.length,
      'Replaced Images': document.querySelectorAll('img[data-ab-test-replaced="true"]').length,
      'Visible Slides': document.querySelectorAll('slideshow-slide:not([data-ab-test-hidden="true"])').length,
      'Hidden Slides': document.querySelectorAll('slideshow-slide[data-ab-test-hidden="true"]').length,
      'Total Slides': document.querySelectorAll('slideshow-slide').length
    };
    
    console.table(stats);
    
    const perfectReplacement = stats['Replaced Images'] === testImages.length && 
                               stats['Visible Slides'] === testImages.length;
    
    if (perfectReplacement) {
      console.log('✅ PASS: Perfect replacement! All variant images visible, extras hidden');
    } else {
      console.warn('⚠️ Replacement incomplete - check stats above');
    }
    
    // Show first few replaced images
    const replacedImages = document.querySelectorAll('img[data-ab-test-replaced="true"]');
    if (replacedImages.length > 0) {
      console.log('\nReplaced images:');
      replacedImages.forEach((img, i) => {
        console.log(`${i + 1}. ${img.src}`);
      });
    }
  }, 500);
}

// Summary
console.log('%c\n📊 TEST SUMMARY', 'font-size: 14px; font-weight: bold; color: #4CAF50');
console.log('='.repeat(60));
console.log('To reset and test again, reload the page.');
console.log('To run individual tests, check HORIZON_TESTING_GUIDE.md');
console.log('='.repeat(60));
