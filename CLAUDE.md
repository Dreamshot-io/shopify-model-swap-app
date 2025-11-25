# CLAUDE.md

This file provides guidance to AI coding agents (Claude Code, OpenCode, Cursor, etc.) when working with this repository.

## Project Overview

Shopify app built with Remix providing AI-powered model swapping for product images. Integrates with fal.ai for image editing operations.

## Commands

```bash
bun run dev          # Start dev server (includes Shopify CLI tunnel)
bun run build        # Prisma generate + migrate + Remix build
bun run lint         # Run linting
bun run test         # Run tests (Vitest)
bun run test:watch   # Watch mode
bun run setup        # Generate Prisma client + db push
bun run prisma       # Access Prisma CLI
bun run deploy       # Deploy to Shopify
```

## Code Style

- **TypeScript**: Strict mode, no `any` types, prefer interfaces over types
- **Imports**: Use `import type` for type-only imports, group by external/internal
- **Components**: PascalCase.tsx, routes follow Remix convention (app.*.tsx)
- **Services**: kebab-case.server.ts (e.g., `ai-providers.server.ts`)
- **Functions**: <50 lines, single responsibility, early returns for guards
- **Files**: Max 500 lines, split into feature modules if larger
- **Comments**: NO comments unless essential for complex logic
- **Error Handling**: Try-catch in actions/loaders, return json with error messages

## Architecture

```
app/
├── features/<name>/     # Vertical slices with components, handlers, types
├── routes/              # Remix file-based routing
├── services/            # Business logic (AI providers, storage, rotation)
└── db.server.ts         # Prisma client with encryption

prisma/                  # Schema and migrations
extensions/              # Shopify app extensions (pixel, model-swap)
docs/                    # Technical documentation by feature
prd/                     # Product requirements documents
```

### Key Services

- `ai-providers.server.ts` - fal.ai integration with provider pattern
- `ai-studio-media.server.ts` - Image library (Shopify CDN storage)
- `simple-rotation.server.ts` - A/B test rotation engine
- `statistics-export/` - Daily metrics export (6 services, 51 tests)

## Documentation Workflow

### Before Implementation
- Check `docs/` for relevant technical guides
- Check `prd/` for product requirements
- If docs conflict with request, clarify with user first

### After Implementation
- Update affected docs when changing architecture, APIs, or user-facing behavior
- Key docs by feature:
  - `docs/ab-testing/` - Rotation, variants, statistics
  - `docs/tracking/` - Pixel, events, troubleshooting
  - `docs/deployment/` - Multi-client, Vercel, authentication
  - `docs/ai-studio/` - Image upload, gallery
  - `docs/infrastructure/` - Database, cron, config

## Development Philosophy

- **KISS**: Choose straightforward solutions over complex ones
- **YAGNI**: Implement features only when needed, not on speculation
- **Single Responsibility**: Each function/module has one clear purpose
- **Fail Fast**: Check errors early, raise exceptions immediately

## Git Workflow

Branch prefixes: `feature/*`, `fix/*`, `docs/*`, `refactor/*`, `test/*`

Commit format (conventional commits):
```
<type>(<scope>): <subject>

Types: feat, fix, docs, style, refactor, test, chore
```

Never include "claude code" or "written by AI" in commit messages.

## Agent Behavior

- Use subagents PROACTIVELY for research, code exploration, complex searches
- When creating a PRD, store in `/prd` folder
- Do not start implementation until PRD is validated by user
- Check relevant docs before making changes
- Update docs after completing features/fixes

## Key Integration Points

### Shopify
- App Bridge for embedded admin experience
- Authentication via `app/shopify.server.ts` with Prisma session storage
- GraphQL Admin API for product/media operations
- Multi-tenant: supports both PUBLIC (App Store) and PRIVATE (custom) installations

### AI
- fal.ai via `@fal-ai/client` package
- Model: "fal-ai/gemini-25-flash-image/edit"
- Provider pattern for swappable AI services

### Environment Variables
- `FAL_KEY` - fal.ai API key
- `DATABASE_URL` - PostgreSQL connection
- `ENCRYPTION_KEY` - For credential encryption
- `SHOPIFY_APP_URL` - App URL for OAuth
