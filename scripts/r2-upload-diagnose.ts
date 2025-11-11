import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { uploadImageFromUrlToR2, getSignedR2Url } from '../app/services/storage.server';

async function loadEnv(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    console.log('[r2-upload-diagnose] Loaded .env file');
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const [key, ...rest] = line.split('=');
      if (!key) continue;
      const value = rest.join('=').replace(/^"|"$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    console.warn('[r2-upload-diagnose] Failed to load .env file:', (error as Error).message);
  }
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env');
  console.log('[r2-upload-diagnose] Loading environment from', envPath);
  await loadEnv(envPath);

  const requiredKeys = [
    'S3_ENDPOINT',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_REGION',
    'S3_BUCKET',
  ] as const;

  for (const key of requiredKeys) {
    const value = process.env[key];
    console.log(`[r2-upload-diagnose] ${key}:`, value ? 'present' : 'MISSING');
  }

  const sampleText = `Diagnostic upload test at ${new Date().toISOString()}`;
  const tempDir = await fs.mkdtemp(path.join(process.cwd(), 'tmp-r2-'));
  const filePath = path.join(tempDir, 'diagnostic.txt');
  await fs.writeFile(filePath, sampleText, 'utf8');
  console.log('[r2-upload-diagnose] Created local sample file:', filePath);

  const dataUrl = `data:text/plain;base64,${Buffer.from(sampleText, 'utf8').toString('base64')}`;

  console.log('[r2-upload-diagnose] Attempting upload via uploadImageFromUrlToR2...');
  try {
    const privateUrl = await uploadImageFromUrlToR2(dataUrl, {
      keyPrefix: 'diagnostics/',
      productId: 'r2-check',
    });

    console.log('[r2-upload-diagnose] Upload succeeded. Private R2 URL:');
    console.log(privateUrl);

    // Extract bucket and key from private URL for signed URL generation
    const urlParts = privateUrl.replace(/^https?:\/\//, '').split('/');
    const bucket = urlParts[1];
    const key = urlParts.slice(2).join('/');

    console.log(`[r2-upload-diagnose] Parsed: bucket=${bucket}, key=${key}`);

    // Verify private URL works with signed URL access
    console.log('\n[r2-upload-diagnose] Generating signed URL for verification...');
    try {
      const signedUrl = await getSignedR2Url(bucket, key, 3600);
      console.log(`[r2-upload-diagnose] Signed URL generated (expires in 1 hour)`);

      // Test signed URL accessibility
      const response = await fetch(signedUrl, { method: 'GET' });
      console.log(`[r2-upload-diagnose] Signed URL response status: ${response.status}`);
      console.log(`[r2-upload-diagnose] Signed URL response headers:`, {
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        etag: response.headers.get('etag'),
      });

      if (response.ok) {
        const text = await response.text();
        console.log(`[r2-upload-diagnose] ✓ Signed URL is accessible! Content preview:`, text.substring(0, 100));
        console.log(`[r2-upload-diagnose] ✓ Private R2 storage is working correctly`);
      } else {
        console.error(`[r2-upload-diagnose] ✗ Signed URL returned ${response.status}`);
        process.exitCode = 1;
      }
    } catch (fetchError) {
      console.error('[r2-upload-diagnose] Failed to generate or fetch signed URL:', fetchError);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[r2-upload-diagnose] Upload failed:', error);
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error('[r2-upload-diagnose] Fatal error:', error);
  process.exitCode = 1;
});
