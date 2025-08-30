/// <reference types="vite/client" />
/// <reference types="@remix-run/node" />

interface ImportMetaEnv {
  readonly S3_ENDPOINT: string;
  readonly S3_ACCESS_KEY: string;
  readonly S3_SECRET_KEY: string;
  readonly S3_REGION: string;
  readonly S3_BUCKET: string;
  readonly FAL_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
