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
npm run setup
```

## Development

Standard development:

```bash
npm run dev
```

Development with stable URL (recommended for app proxy and A/B testing):

```bash
npm run dev:stable
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
- `DATABASE_URL` - Postgres connection string (local: see `prd/DEV-DB-POSTGRES.md`; hosted: may require `?sslmode=require`)

## Tech Stack

- **Framework**: Remix (React-based full-stack)
- **Database**: Prisma ORM with SQLite
- **UI**: Shopify Polaris design system
- **AI**: fal.ai for image generation/editing
- **TypeScript**: Full type safety

## Key Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server
npm run dev:stable   # Start with stable ngrok URL
npm run setup        # Setup database (Prisma generate + migrate)
npm run build        # Build for production
npm run deploy       # Deploy to Shopify
npm run prisma       # Access Prisma CLI
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

## Resources

- [Shopify App Remix Docs](https://shopify.dev/docs/api/shopify-app-remix)
- [Remix Documentation](https://remix.run/docs)
- [Shopify Polaris](https://polaris.shopify.com/)
- [fal.ai Documentation](https://fal.ai/docs)
- [Project Guidelines](./CLAUDE.md)
