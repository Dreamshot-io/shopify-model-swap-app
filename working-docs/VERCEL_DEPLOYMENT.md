# Vercel Deployment Guide

This guide explains how to deploy this Shopify Remix app to Vercel.

## Prerequisites

1. A Vercel account
2. A PostgreSQL database (Vercel does not support SQLite)
3. Your Shopify app credentials
4. A fal.ai API key for AI features

## Configuration Steps

### 1. Database Setup

This app requires PostgreSQL. You can use:

- Vercel Postgres (recommended for Vercel deployments)
- Supabase
- Neon
- Any PostgreSQL provider

### 2. Environment Variables

Set these environment variables in your Vercel project settings:

#### Required Variables

```env
# Shopify Configuration
SHOPIFY_APP_URL=https://your-app-name.vercel.app  # Your Vercel deployment URL
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret
SCOPES=write_products,read_products

# Database (PostgreSQL with connection pooling for serverless)
# Supabase pooler connection (port 6543) - required for serverless
DATABASE_URL=postgresql://user:password@host:6543/database?pgbouncer=true&connect_timeout=15
# Direct connection (port 5432) for migrations only - NO pgbouncer
DIRECT_URL=postgresql://user:password@host:5432/database

# AI Service
FAL_KEY=your_fal_ai_api_key

# Runtime
NODE_ENV=production
```

#### Optional Variables

```env
# For development/staging
SHOP_CUSTOM_DOMAIN=your-dev-store.myshopify.com

# If using S3/R2 storage
S3_ENDPOINT=https://your-endpoint.r2.cloudflarestorage.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_REGION=auto
S3_BUCKET=your-bucket-name
```

### 3. Deployment Steps

1. **Connect GitHub Repository**
    - Go to your Vercel dashboard
    - Click "Add New Project"
    - Import your GitHub repository

2. **Configure Build Settings**
    - Framework Preset: Remix
    - Build Command: `bun run build` (default)
    - Output Directory: `build/client` (configured in vercel.json)
    - Install Command: `npm install`

3. **Set Environment Variables**
    - Go to Project Settings → Environment Variables
    - Add all required variables listed above
    - **Important**: Set `SHOPIFY_APP_URL` to your Vercel deployment URL

4. **Deploy**
    - Click "Deploy"
    - Wait for the build to complete

### 4. Post-Deployment

1. **Update Shopify App URLs**
    - Go to your Shopify Partner Dashboard
    - Update your app's URLs to point to your Vercel deployment
    - App URL: `https://your-app-name.vercel.app`
    - Allowed redirection URL(s):
        - `https://your-app-name.vercel.app/auth/callback`
        - `https://your-app-name.vercel.app/auth/session-token`

2. **Run Database Migrations**
    - If not automatically run, execute:
    ```bash
    npx prisma migrate deploy
    ```

## Troubleshooting

### Common Issues

1. **"Detected an empty appUrl configuration" Error**
    - Ensure `SHOPIFY_APP_URL` is set in Vercel environment variables
    - The URL should be your full Vercel deployment URL (e.g., `https://your-app.vercel.app`)

2. **Database Connection Issues (P1001 Error)**
    - **Supabase Setup Required:**
      1. Go to Supabase Dashboard → Settings → Database
      2. Enable "Connection Pooling" (pgbouncer)
      3. Whitelist Vercel's IP ranges or disable IP restrictions for pooler
      4. Use Transaction mode (not Session mode) for pooler
    - **Connection String Format:**
      - `DATABASE_URL`: Port 6543 (pooler) with `?pgbouncer=true&connect_timeout=15`
      - `DIRECT_URL`: Port 5432 (direct) with NO pgbouncer parameter
    - **Common Causes:**
      - Database paused (unpause in Supabase dashboard)
      - IP restrictions blocking Vercel IPs
      - Wrong connection mode (use Transaction, not Session)

3. **Peer Dependency Conflicts**
    - The package.json includes overrides to handle version conflicts
    - Vercel should install dependencies without issues

4. **Build Failures**
    - Check that all environment variables are set
    - Ensure your database is accessible from Vercel's servers
    - Review build logs for specific error messages

## Architecture Notes

- The app uses `@vercel/remix` adapter for serverless deployment
- Remix routes are automatically deployed as Vercel Functions
- The `vercel.json` configuration handles routing
- PostgreSQL is required (SQLite is not supported on Vercel)

## Performance Optimization

- The app is configured with Vercel's preset for optimal performance
- Static assets are served from Vercel's CDN
- Database queries should use connection pooling

## Support

For issues specific to:

- Shopify app development: [Shopify Developer Documentation](https://shopify.dev)
- Remix framework: [Remix Documentation](https://remix.run/docs)
- Vercel deployment: [Vercel Documentation](https://vercel.com/docs)
- This app: Create an issue in the GitHub repository
