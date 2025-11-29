# CLAUDE.md

Guidance for AI coding agents working with this repository.

## What This App Does

Shopify app for A/B testing product images to optimize conversion rates. Merchants can:

- Generate AI-powered contextual product images
- Run A/B tests comparing BASE vs TEST image sets
- Track metrics (impressions, add-to-carts, purchases) via web pixel
- View statistics and determine winning variants

### Roadmap: Agentic Optimization Loop

Future vision for autonomous conversion optimization:

1. **Weekly AI Recommendations** - System analyzes products, suggests contextual images
2. **Merchant Validation** - Accept/reject suggested images
3. **Auto A/B Tests** - From validated images, propose tests automatically
4. **Auto-pilot Mode** - Option to approve tests without manual intervention
5. **Continuous Learning** - Use results to improve future recommendations

## Commands

```bash
bun run dev          # Dev server + Shopify CLI tunnel
bun run build        # Prisma generate + migrate + Remix build
bun run test         # Vitest
bun run setup        # Prisma client + db push
```

## Architecture

```
app/
├── features/           # Vertical slices
│   ├── ai-studio/      # Image generation + library
│   ├── ab-testing/     # Test UI + statistics
│   └── statistics-export/  # Daily metrics pipeline
├── services/           # Business logic (*.server.ts)
├── routes/             # Remix routing
└── db.server.ts        # Prisma client

extensions/
├── ab-test-pixel/      # Storefront event tracking
└── model-swap/         # Admin UI extension

prisma/                 # Schema + migrations
docs/                   # Technical guides
```

## Key Services

| Service                     | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `ai-providers.server.ts`    | AI generation (Replicate primary, fal.ai backup) |
| `simple-rotation.server.ts` | A/B test rotation engine                         |
| `rotation-v2.server.ts`     | Gallery-based rotation (35x faster)              |
| `media-gallery.server.ts`   | Shopify media operations                         |
| `audit.server.ts`           | Event logging                                    |

## Metrics & Tracking Flow

```
Storefront Event → Web Pixel → /track endpoint → ABTestEvent (DB)
                                                      ↓
                              Daily Cron → VariantDailyStatistics
                                                      ↓
                                              R2 Export (CSV/JSON)
```

**Events tracked**: IMPRESSION (product view), ADD_TO_CART, PURCHASE
**Pixel location**: `extensions/ab-test-pixel/src/index.ts`
**Track endpoint**: `app/routes/api.track.ts`

## Environment Variables

```bash
# Required
REPLICATE_API_TOKEN     # Primary AI (bytedance/seedream-4)
DATABASE_URL            # PostgreSQL

# Optional
FAL_KEY                 # Backup AI (gemini-25-flash-image)
S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET  # R2 storage
ENCRYPTION_KEY          # Credential encryption
```

### Before Implementation

- Check `docs/` for relevant technical guides
- If docs conflict with request, clarify with user first

### After Implementation

- Update affected docs when changing architecture, APIs, or user-facing behavior
- Key docs by feature:
  - `docs/ab-testing/` - Rotation, variants, statistics
  - `docs/tracking/` - Pixel, events, troubleshooting
  - `docs/deployment/` - Multi-client, Vercel, authentication
  - `docs/ai-studio/` - Image upload, gallery
  - `docs/infrastructure/` - Database, cron, config

## Code Style

- **TypeScript**: Strict, no `any`, prefer interfaces
- **Components**: PascalCase.tsx | **Services**: kebab-case.server.ts
- **Functions**: <50 lines | **Files**: <500 lines
- **Comments**: Only for complex logic

## Philosophy

**KISS** · **YAGNI** · **Single Responsibility** · **Fail Fast**

## Git

Prefixes: `feature/*`, `fix/*`, `docs/*`, `refactor/*`
Format: `<type>(<scope>): <subject>`
