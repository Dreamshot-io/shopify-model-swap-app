#!/bin/bash
set -euo pipefail

if [ -f .env ]; then
  echo ".env already exists. Skipping creation."
  exit 0
fi

cat > .env << 'EOF'
# Development environment
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=http://localhost:3000
SCOPES=write_products,write_files

# Database (local Postgres via Docker)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public

# AI provider
FAL_KEY=

# S3-compatible storage (e.g., Cloudflare R2)
S3_ENDPOINT=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_REGION=
S3_BUCKET=

# Optional
SHOP_CUSTOM_DOMAIN=
EOF

echo "✅ Created .env with local Postgres DATABASE_URL"
