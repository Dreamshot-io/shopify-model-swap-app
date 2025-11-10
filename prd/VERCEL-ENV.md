## Vercel Environment Variables

Set these in the Vercel dashboard (Project Settings → Environment Variables):

### Required

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL` (your Vercel prod URL, e.g., https://app.dev.dreamshot.io)
- `SCOPES` (e.g., write_products,write_files)
- `DATABASE_URL` (PostgreSQL connection string - use pooled URL for Vercel)
- `DIRECT_URL` (Direct PostgreSQL connection string - only needed if using Prisma Accelerate or connection pooling)
- `FAL_KEY`
- `S3_ENDPOINT` (private R2 endpoint, e.g., https://xxx.r2.cloudflarestorage.com)
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_REGION` (usually "auto" for R2)
- `S3_BUCKET`

### Optional

- `R2_PUBLIC_DOMAIN` (public R2 domain - auto-derived from S3_ENDPOINT, only set if using custom domain)
- `SHOP_CUSTOM_DOMAIN` (if using custom shop domain handling)

### Notes

- Make sure `SHOPIFY_APP_URL` matches your deployed Vercel domain before updating `shopify.app.toml`.
- For staging/preview environments, set environment-specific values per Vercel environment.
- Hosted Postgres often requires SSL. Append `?sslmode=require` (Neon/Supabase) to `DATABASE_URL`.
- Prefer pooled connections (pgbouncer) for serverless; consult your provider for pooled URLs.
- **Connection Pooling**: If using a pooled connection (e.g., Supabase with Supavisor), you must:
  1. Set `DATABASE_URL` to the pooled connection URL (for queries)
  2. Set `DIRECT_URL` to the direct connection URL (for migrations)
  3. Uncomment `directUrl = env("DIRECT_URL")` in `prisma/schema.prisma`
- **Local Development**: For local Docker Postgres, only `DATABASE_URL` is needed. No `DIRECT_URL` required.
