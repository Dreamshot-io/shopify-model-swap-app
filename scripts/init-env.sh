#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  echo ".env already exists. Skipping creation."
  exit 0
fi

cat > .env << 'EOF'
# Development environment
SHOPIFY_APP_URL=http://localhost:3000

# Database (local Postgres via Docker)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public

# AI provider
FAL_KEY=

# Shopify credentials now live in the database. Seed them with:
# node scripts/seed-shop-credential.mjs --shop-domain=<shop>.myshopify.com --config=shopify.app.toml --api-secret=<secret>

# S3-compatible storage (e.g., Cloudflare R2)
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=
S3_BUCKET=
# R2_PUBLIC_DOMAIN is optional - will be auto-derived from S3_ENDPOINT
# Only set if using a custom domain: R2_PUBLIC_DOMAIN=https://your-custom-domain.com

# Optional
EOF

echo "✅ Created .env with local Postgres DATABASE_URL"
