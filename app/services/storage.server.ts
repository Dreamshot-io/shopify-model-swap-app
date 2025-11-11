import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const requiredEnv = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "S3_REGION",
  "S3_BUCKET",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    // eslint-disable-next-line no-console
    console.warn(`[storage] Missing env var ${key}. R2 uploads may fail.`);
  }
}

/**
 * Generate a private R2 URL for an object
 * Format: https://<account-id>.r2.cloudflarestorage.com/<bucket>/<key>
 */
function getPrivateR2Url(bucket: string, key: string): string {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    throw new Error("S3_ENDPOINT is required");
  }

  // Ensure endpoint doesn't have trailing slash
  const baseUrl = endpoint.replace(/\/$/, "");
  return `${baseUrl}/${bucket}/${key}`;
}

/**
 * Generate a signed URL for temporary public access to an R2 object
 * Useful when external services need to access the file
 */
export async function getSignedR2Url(bucket: string, key: string, expiresIn: number = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
}

const s3Client = new S3Client({
  region: process.env.S3_REGION || "auto",
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
  },
  forcePathStyle: true,
});

export async function uploadImageFromUrlToR2(
  imageUrl: string,
  options?: { keyPrefix?: string; productId?: string },
): Promise<string> {
  // eslint-disable-next-line no-console
  console.log(`[storage] Downloading source image`, { imageUrl });
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch source image: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/jpeg";
  // eslint-disable-next-line no-console
  console.log(`[storage] Source content-type: ${contentType}`);
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : "jpg";
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const key = `${options?.keyPrefix || "inputs/"}${options?.productId ? options.productId + "/" : ""}${Date.now()}.${extension}`;

  // eslint-disable-next-line no-console
  console.log(`[storage] Uploading to R2`, {
    bucket: process.env.S3_BUCKET,
    key,
    size: buffer.byteLength,
  });
  const putRes = await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Removed ACL: "public-read" - using private storage with signed URLs when needed
    }),
  );
  // eslint-disable-next-line no-console
  console.log(`[storage] Upload completed`, { etag: (putRes as any)?.ETag });

  // Return private R2 URL (private endpoint)
  const privateUrl = getPrivateR2Url(process.env.S3_BUCKET!, key);
  // eslint-disable-next-line no-console
  console.log(`[storage] Generated private R2 URL:`, privateUrl);

  return privateUrl;
}
