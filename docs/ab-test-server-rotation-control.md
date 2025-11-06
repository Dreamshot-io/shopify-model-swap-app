# Server-Driven AB Test Rotation — Control Document

## Summary
- Replace client-side DOM swapping with a server-controlled rotation that alternates product media between control and test images every 10 minutes.
- Persist rotation state, execution history, and media mappings to ensure Shopify product/variant galleries stay coherent across switches.
- Leverage existing telemetry (pixel, add-to-cart, checkout) by attributing events using the recorded rotation state instead of session-assigned variants.

## Current Implementation Inventory
- `public/image-replacer.js` — Storefront DOM replacement script injected via theme app extension.
- `app/routes/script.tsx` — Serves the storefront script through the app proxy.
- `app/routes/variant.$productId.tsx` — Assigns A/B variants per session and returns image URLs to the storefront script.
- `extensions/ab-test-loader/blocks/ab-test-script.liquid` — Loads the DOM script on product templates.
- `extensions/ab-test-pixel/src/index.ts` — Tracks impressions/add-to-cart/purchase using sessionStorage variant metadata.
- `app/routes/track.tsx` — Persists tracking events expecting variant info from the pixel payload.
- `app/routes/app.ab-tests*.tsx`, `app/features/ab-testing/**` — Admin experience for configuring tests and viewing metrics.
- `app/services/shopify-upload.ts`, `app/services/**` — Helper layer for Shopify media uploads and management.

## Target Architecture Outline
- **Rotation Engine**: Cron-driven service determines due switches, updates state history, and orchestrates Shopify media swaps.
- **Data Layer**: Prisma models capture control/test image sets, rotation cadence, and execution history for each product/variant.
- **Shopify Sync**: GraphQL mutations snapshot control galleries, publish test galleries, and roll back on failure.
- **Attribution**: Tracking endpoints resolve the active variant at event time by consulting rotation history (no session dependency).
- **Pixels/UI**: Pixels fetch read-only rotation state; admin UI manages assignments and displays the rotation log.

## Phase Plan & Status
| Phase | Objective | Status |
| --- | --- | --- |
| control-doc | Create control artefact, capture inventory, outline execution plan | Completed |
| data-layer | Extend schema + persistence helpers for rotation state | Completed |
| rotation-engine | Implement scheduling service + cron entrypoint | Completed |
| shopify-sync | Build media snapshot/swap helpers with rollback | Completed |
| attribution | Rework tracking endpoints + expose rotation state API | Completed |
| ui-cleanup | Retire DOM script, refresh admin UI, update docs/tests | In Progress |

## Task Board
| Task ID | Description | Owner | Status | Notes |
| --- | --- | --- | --- | --- |
| control-doc:init | Create control doc with inventory and task board | Agents | Completed | This document |
| data-layer:schema | Add rotation persistence tables and migration | Agents | Completed | Prisma schema + migration applied |
| rotation-engine:cron | Implement rotation service with cron entrypoint | Agents | Completed | Cron endpoint + locking implemented |
| shopify-sync:mutations | Implement Shopify media switching helpers | Agents | Completed | GraphQL productUpdate integration |
| attribution:tracking | Refactor tracking to use rotation state and add state API | Agents | Completed | Event pipeline uses rotation history |
| pixel:update | Update pixel/theme loader to consume rotation state | Agents | Completed | Web pixel fetches rotation state API |
| admin-ui:refresh | Refresh admin UI for rotation configuration and logs | Agents | Completed | Rotation management modal available |
| docs-tests:update | Update docs and automated tests for new flow | Agents | In Progress | Extend documentation + add coverage |

## Data Flow Notes
- **Before**: Storefront script fetches variant assignment, swaps DOM images, and relies on sessionStorage for attribution.
- **After**: Backend toggles Shopify media assets directly; storefront only reflects published images. Attribution derives the active variant from rotation history with precise timestamps.

## Next Actions
- Retire legacy client-side swap assets and extend merchant comms (`ui-cleanup`).
- Complete documentation/testing updates for rotation workflow (`docs-tests:update`).
