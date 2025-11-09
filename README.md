# Shopify AI Model Swap App

AI-powered model swapping app for Shopify product images. Transform product photos using AI prompts with fal.ai integration.

## Features

- 🎨 AI-powered image generation and editing
- 🔄 Model swapping for product images
- 📊 A/B testing for image variants
- 🎯 App proxy integration for seamless customer experience

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

- `SHOPIFY_API_KEY` - Shopify app credentials
- `SHOPIFY_API_SECRET` - Shopify app credentials
- `FAL_KEY` - fal.ai API key
- `SHOPIFY_APP_URL` - App URL for Shopify configuration
- `SCOPES` - Comma-separated Shopify API scopes
- `DATABASE_URL` - PostgreSQL connection string
  - Local: `postgresql://postgres:postgres@localhost:5432/dreamshot?schema=public` (see `prd/DEV-DB-POSTGRES.md`)
  - Hosted: May require `?sslmode=require`
- `DIRECT_URL` - (Optional) Only needed when using connection pooling on Vercel (see `prd/VERCEL-ENV.md`)

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

## Multi-Client Configuration (Future)

The codebase includes preparation for multi-client Shopify app configuration management. This enables serving multiple Shopify Plus clients from a single backend deployment.

**Status:** Preparation phase complete - Ready for implementation

**Key Files:**

- `shopify.app.template.toml` - Template for client-specific configs
- `app/config/client-credentials.template.ts` - Credential mapping (to be populated)
- `scripts/list-shopify-configs.sh` - List available configurations
- `scripts/verify-shopify-config.sh` - Verify current config
- `scripts/use-shopify-config.sh` - Switch between client configs

**Documentation:**

- [PRD: Multi-Client Configuration](./prd/PRD-Multi-Client-Shopify-App-Configuration.md)
- [Multi-Client Onboarding Guide](./docs/multi-client-onboarding.md)
- [Multi-Client Troubleshooting](./docs/multi-client-troubleshooting.md)
- [Client Registry](./docs/client-registry.md)

**Note:** Current implementation uses single-client configuration. Multi-client support is prepared but not yet active.

## Documentation

- **[AGENTS.md](./AGENTS.md)** - Quick reference for agentic coding tools (commands, style, architecture)
- **[CLAUDE.md](./CLAUDE.md)** - Comprehensive development guide (philosophy, patterns, examples)

## Resources

- [Shopify App Remix Docs](https://shopify.dev/docs/api/shopify-app-remix)
- [Remix Documentation](https://remix.run/docs)
- [Shopify Polaris](https://polaris.shopify.com/)
- [fal.ai Documentation](https://fal.ai/docs)
