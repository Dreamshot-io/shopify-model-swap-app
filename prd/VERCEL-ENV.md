## Vercel Environment Variables

Set these in the Vercel dashboard (Project Settings → Environment Variables):

### Required

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_APP_URL` (your Vercel prod URL, e.g., https://app.dev.dreamshot.io)
- `SCOPES` (e.g., write_products,write_files)
- `DATABASE_URL` (PostgreSQL connection string)
- `FAL_KEY`
- `S3_ENDPOINT`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `S3_REGION`
- `S3_BUCKET`

### Optional

- `SHOP_CUSTOM_DOMAIN` (if using custom shop domain handling)

### Notes

- Make sure `SHOPIFY_APP_URL` matches your deployed Vercel domain before updating `shopify.app.toml`.
- For staging/preview environments, set environment-specific values per Vercel environment.
- Hosted Postgres often requires SSL. Append `?sslmode=require` (Neon/Supabase) to `DATABASE_URL`.
- Prefer pooled connections (pgbouncer) for serverless; consult your provider for pooled URLs.
- Prisma Accelerate: set `DATABASE_URL` to the Accelerate URL for both runtime and migrations.
