# Shopify AI Model Swap App

AI-powered model swapping app for Shopify product images. Transform product photos using AI prompts with fal.ai integration.

## Features

- 🎨 AI-powered image generation and editing
- 🔄 Model swapping for product images
- 📊 A/B testing for image variants
- 🎯 App proxy integration for seamless customer experience
- 📈 Daily statistics export to R2 (CSV/JSON) - See [STATISTICS-EXPORT.md](./STATISTICS-EXPORT.md)

## Prerequisites

1. **Node.js** - [Download and install](https://nodejs.org/en/download/)
2. **Shopify Partner Account** - [Create account](https://partners.shopify.com/signup)
3. **Test Store** - [Development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or [Plus sandbox](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store)
4. **fal.ai API Key** - Required for AI image operations

## Setup

Install dependencies:

```bash
npm install
```

Setup database:

```bash
bun run setup
```

## Development

Standard development:

```bash
bun run dev
```

Development with stable URL (recommended for app proxy and A/B testing):

```bash
bun run dev:stable
```

The stable URL uses ngrok to maintain a consistent tunnel URL across restarts, preventing app proxy configuration from breaking.

**Prerequisites:** Install and authenticate ngrok from https://ngrok.com

## Environment Variables

Required variables in `.env`:

- `SHOPIFY_APP_URL` - Shared Remix host used for OAuth callbacks and script tags
- `DATABASE_URL` - PostgreSQL connection string
  - Local: `postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public` (see `prd/DEV-DB-POSTGRES.md`)
  - Hosted: May require `?sslmode=require`
- `DIRECT_URL` - (Optional) Only needed when using connection pooling on Vercel (see `prd/VERCEL-ENV.md`)
- `FAL_KEY` - fal.ai API key
- `S3_*` - Storage credentials when using R2/S3 (see `.env` template)
- `CRON_SECRET` - Automatically provided by Vercel for cron job authentication

> Shopify API keys and secrets now live in the `ShopCredential` table. Seed new credentials with `node scripts/seed-shop-credential.mjs --shop-domain=<shop>.myshopify.com --config=shopify.app.toml --api-secret=<secret>`.

### Security: Credential Encryption

**API secrets are encrypted at rest** using AES-256-GCM encryption. The encryption key is stored in the `ENCRYPTION_KEY` environment variable.

**Required environment variable:**
- `ENCRYPTION_KEY` - 32+ character encryption key (generate with: `openssl rand -base64 32`)

**Important:**
- Store `ENCRYPTION_KEY` securely (e.g., in your hosting provider's secrets manager)
- Never commit `ENCRYPTION_KEY` to version control
- If you lose the key, encrypted credentials cannot be recovered
- To encrypt existing credentials: `bun scripts/encrypt-existing-credentials.mjs`

## Tech Stack

- **Framework**: Remix (React-based full-stack)
- **Database**: Prisma ORM with PostgreSQL
- **UI**: Shopify Polaris design system
- **AI**: fal.ai for image generation/editing
- **TypeScript**: Full type safety

## Key Commands

```bash
npm install          # Install dependencies
bun run dev          # Start development server
cloudflared tunnel run
bun run dev:stable   # Start with stable ngrok URL
bun run setup        # Setup database (Prisma generate + migrate)
bun run build        # Build for production
bun run deploy       # Deploy to Shopify
bun run prisma       # Access Prisma CLI
```

## Project Structure

```
app/
├── features/         # Feature modules (AI studio, A/B testing)
├── routes/          # Remix routes (file-based routing)
├── services/        # Business logic (AI providers, storage)
└── db.server.ts     # Prisma client

prisma/              # Database schema and migrations
extensions/          # Shopify app extensions
```

## Multi-Mode Architecture (Public + Private Apps)

**NEW:** The app now supports both **public** (App Store) and **private** (custom client) installations in a single codebase.

### Installation Modes

- **PUBLIC**: Shopify App Store installations using shared credentials
- **PRIVATE**: Custom client apps with dedicated API keys

### How It Works

Each installation is stored in the `ShopCredential` table with a `mode` field. The app automatically detects and routes requests based on:

- Public apps: Use `SHOPIFY_PUBLIC_API_KEY` environment variable
- Private apps: Use client-specific credentials from database

**Quick Start:**
1. Set `SHOPIFY_PUBLIC_API_KEY` and `SHOPIFY_PUBLIC_API_SECRET` in Vercel
2. Deploy → Migration runs automatically
3. Existing private apps continue working unchanged
4. New public installations work immediately

**For Private Client Setup:**
```bash
node scripts/seed-shop-credential.mjs \
  --shop-domain=<shop>.myshopify.com \
  --config=shopify.app.toml \
  --api-secret=<secret>
```

**Documentation:**
- 📖 **[Quick Start Guide](./docs/QUICK-START.md)** - Deploy in 5 minutes
- 📝 **[Deployment Guide](./docs/DEPLOYMENT-GUIDE.md)** - Complete deployment process
- 🏗️ **[Architecture Guide](./docs/PUBLIC-PRIVATE-APP-ARCHITECTURE.md)** - Technical details

## Documentation

### Getting Started
- 📖 **[Quick Start](./docs/QUICK-START.md)** - Deploy public + private architecture in 5 minutes
- 📝 **[Deployment Guide](./docs/DEPLOYMENT-GUIDE.md)** - Complete deployment process with verification steps
- 🏗️ **[Architecture Guide](./docs/PUBLIC-PRIVATE-APP-ARCHITECTURE.md)** - Technical implementation details

### Development
- **[AGENTS.md](./AGENTS.md)** - Quick reference for agentic coding tools
- **[CLAUDE.md](./CLAUDE.md)** - Comprehensive development guide
- **[STATISTICS-EXPORT.md](./STATISTICS-EXPORT.md)** - Daily statistics export setup and usage

## Resources

- [Shopify App Remix Docs](https://shopify.dev/docs/api/shopify-app-remix)
- [Remix Documentation](https://remix.run/docs)
- [Shopify Polaris](https://polaris.shopify.com/)
- [fal.ai Documentation](https://fal.ai/docs)
