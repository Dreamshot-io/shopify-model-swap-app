/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

interface ImportMetaEnv {
  readonly DATABASE_URL: string;
  readonly S3_ENDPOINT: string;
  readonly S3_ACCESS_KEY: string;
  readonly S3_SECRET_KEY: string;
  readonly S3_REGION: string;
  readonly S3_BUCKET: string;
  readonly R2_PUBLIC_DOMAIN?: string; // Optional - auto-derived from S3_ENDPOINT
  readonly FAL_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
