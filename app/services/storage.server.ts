import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
      ACL: "public-read",
    }),
  );
  // eslint-disable-next-line no-console
  console.log(`[storage] Upload completed`, { etag: (putRes as any)?.ETag });

  // Public URL to the object. Ensure your bucket/policies allow public reads in your environment.
  const publicUrl = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`;
  // Basic reachability check without auth (what fal.ai will see)
  try {
    const head = await fetch(publicUrl, { method: "HEAD" });
    // eslint-disable-next-line no-console
    console.log(`[storage] Public HEAD`, {
      status: head.status,
      contentType: head.headers.get("content-type"),
      contentLength: head.headers.get("content-length"),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[storage] Public HEAD failed`, {
      error: (err as Error).message,
    });
  }
  return publicUrl;
}
