# Product Requirements Document: Multi-Client Shopify App Configuration

**Project:** Dreamshot Shopify Model Swap App
**Version:** 1.0 (Initial Draft)
**Date:** 2025-10-30
**Status:** Phase 0 Complete - Ready for Implementation
**Author:** GPT-5 Codex (Cursor)
**Last Updated:** 2025-10-30

---

## Table of Contents

1. [Scope & Goals](#scope--goals)
2. [Target Architecture](#target-architecture)
3. [Operational Workflows](#operational-workflows)
4. [Implementation Roadmap](#implementation-roadmap)
5. [Documentation Deliverables](#documentation-deliverables)
6. [Risks & Mitigations](#risks--mitigations)
7. [Dependencies, Decisions & Validation](#dependencies-decisions--validation)
8. [Appendix](#appendix)
9. [Open Questions](#open-questions)

---

## Scope & Goals

### Problem Statement

The Dreamshot app must onboard 4–5 Shopify Plus clients, each requiring a private/custom Shopify app with unique credentials, while sharing one deployed backend and codebase. Current tooling (`shopify.app.toml`) only supports a single configuration, leading to risky manual edits, high chance of cross-client credential leakage, and no audit trail for deployments.

### Objectives

- Enable side-by-side client-specific `shopify.app.{client}.toml` files aligned with Shopify CLI expectations.
- Support seamless switching between client configurations for development, testing, and deployment without editing code.
- Allow the shared backend to authenticate and serve requests from multiple Shopify apps/stores securely.
- Provide operational guidance for Partner Dashboard setup, configuration switching, deployment, onboarding, and troubleshooting.
- Establish logging and observability per client to surface usage and issues quickly.

### Success Metrics

- ≥4 clients activated with isolated credentials and successful OAuth installs.
- 0 cross-client credential leakage incidents.
- Targeted deployment to a client finishes in <5 minutes end-to-end.
- Adding a new client (app + config + secrets) completes in <30 minutes.
- No accidental deploys to wrong client (validated via deployment confirmation + logs).

### Non-Goals

- Automated CI/CD for per-client deploys (manual runbook only).
- Admin UI for managing client configurations or credentials.
- Client-specific feature flags beyond app credentials and metadata.
- Automated end-to-end tests per client (document manual smoke checks only).

### Assumptions

- Each client operates a single primary Shopify Plus store requiring a private/custom app (custom distribution).
- All clients share identical scopes, webhook topics, and backend endpoints.
- Shared backend already runs on a stable public URL and supports environment variable injection.
- Secrets manager or environment variable management (e.g., 1Password, Doppler, Vercel envs) is available.
- All clients consume the same feature set; client-specific feature overrides are out of scope for this phase.

### Constraints

- Shopify CLI reads only one active `shopify.app.toml`; solution must rely on `shopify app config` subcommands.
- Credentials must never reside in Git, only references to environment variables allowed.
- Backend must fail fast when required environment variables are missing.
- Solution should scale comfortably to ~20 clients before architectural reevaluation.

---

## Target Architecture

### High-Level View

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Shopify Partner Dashboard                           │
│  (one private/custom app per client with unique client_id/secret)          │
└────────────────────────────────────────────────────────────────────────────┘
              │                                             │
              ▼                                             ▼
┌─────────────────────────┐                     ┌───────────────────────────┐
│  Config Repository      │                     │   Runtime Environment     │
│  - shopify.app.template │                     │   (Remix Backend)        │
│  - shopify.app.clientA  │                     │                           │
│  - shopify.app.clientB  │  Shopify CLI        │   - Credential map        │
│  - helper scripts       │ ───────────────►    │   - OAuth handler         │
└─────────────────────────┘                     │   - Per-shop sessions     │
              │                                 │   - Logging/metrics       │
              ▼                                 └───────────────────────────┘
    Developer Workstation                                │
    - `shopify app config use`                           ▼
    - helper scripts                         Shopify Stores (client shops)
```

### Configuration Files & Naming

- Introduce client-scoped files in repo root: `shopify.app.<client-slug>.toml`.
- Store client TOML files the same way as the primary `shopify.app.toml`, keeping them version-controlled while relying on environment interpolation for secrets.
- Template contains placeholders (`${ENV_VAR}`) for `client_id`, `client_secret`, shared `application_url`, shared `redirect_urls`, shared `[webhooks]`, `[access_scopes]`, and `[auth]` blocks.
- Document slug conventions (`kebab-case`, aligned with internal client identifier, e.g., `cliente-a`).

### Shopify CLI Workflow

- Use Shopify CLI command set:
    - `shopify app config use shopify.app.<client>.toml` to activate configuration.
    - `shopify app config link` to bind config to Partner Dashboard app once.
    - `shopify app info` to confirm current client before operations.
- Provide helper scripts (see [Operational Workflows](#operational-workflows)) to list configs, switch, and verify status.

### Backend Credential Management

- Maintain credentials in environment variables (`CLIENT_A_ID`, `CLIENT_A_SECRET`, etc.) or secrets manager, referenced via a JSON/YAML/TS mapping file committed to repo but parameterized with `env:` tokens:

```typescript
export const clientCredentialMap = {
	'cliente-a.myshopify.com': {
		clientKey: 'CLIENTE_A', // prefix for env var lookup
		appName: 'Cliente A Model Swap',
	},
	'cliente-b.myshopify.com': {
		clientKey: 'CLIENTE_B',
		appName: 'Cliente B Model Swap',
	},
};
```

- At startup, load required env vars (`${clientKey}_ID`, `${clientKey}_SECRET`) and fail fast with descriptive error if any missing.
- Persist tokens per shop in Prisma using new multi-tenant table (see [Database](#database-schema-updates)).

### OAuth & Request Handling

- OAuth flow selects credentials based on `shop` param: map `shop` → `clientKey` (or fallback to manual override).
- Authorization URL uses `client_id` tied to requesting shop.
- Token exchange uses matching `client_secret`; tokens stored encrypted.
- Session storage keyed by shop + client app ID to prevent collisions.
- Incoming admin/action requests identify shop via existing session middleware; storefront/embedded requests validated via Shopify authentication utilities.
- API handlers fetch access token via `(shopDomain, clientKey)` combination.

### Database Schema Updates

- Extend Prisma with `ShopClientApp` model:

```prisma
model ShopClientApp {
  id             String   @id @default(cuid())
  shopDomain     String   @unique
  clientSlug     String
  clientId       String
  clientSecret   String   @map("client_secret") // stored encrypted
  accessToken    String?  @map("access_token") // encrypted
  scopes         String?
  installedAt    DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- Add compound index on `(clientSlug, shopDomain)` for faster lookups.
- Ensure encryption at rest (existing KMS or libsodium) for secrets.
- Migration must run before onboarding first multi-client install.

### Secrets & Validation

- Require env var schema defined via `zod` or similar; on boot, validate presence of `CLIENT_<SLUG>_ID` & `CLIENT_<SLUG>_SECRET`.
- Provide CLI script to check secrets availability per client.
- Document process for rotating credentials (update env store, restart backend).

### Observability & Logging

- Add structured logging per request with `clientSlug` and `shopDomain`.
- Log OAuth installs, token refreshes, API calls (success/failure) with timestamp and client identifier.
- Surface metrics dashboard (Datadog/Grafana/Logtail) filtering by client, including installs, API usage, and error counts.
- Add alerts for OAuth failures, missing credentials, API auth errors; integrate with existing on-call channel.

### Deployment Safeguards

- Deployment scripts must prompt for target client and display summary (client name, shop domain, config file path) before executing `shopify app deploy`.
- Deployments log entry persistently (e.g., `logs/deployments.log` or external logging sink) with timestamp, operator, client slug, and commit hash.
- Support alternative command `shopify app deploy --config shopify.app.<client>.toml` for non-interactive runs.

---

## Operational Workflows

### Partner Dashboard Setup Runbook

1. Create new app in Partner Dashboard → select **Custom distribution**.
2. Set target store to client’s Shopify Plus domain.
3. Configure shared backend URL (`application_url`) and callback URLs.
4. Apply shared scopes and webhook topics (per template).
5. Retrieve `client_id` & `client_secret`; store in secrets manager, tagged with client slug.
6. Record mapping in shared source-of-truth (e.g., Notion table or `docs/clients.md`).

### Local Configuration Management

- Copy template → `cp shopify.app.template.toml shopify.app.<client>.toml`.
- Replace placeholder values using env interpolation (`${CLIENT_<SLUG>_ID}`) rather than literals.
- Commit the new config alongside other infrastructure files after verifying no raw secrets are present.
- Link config once: `shopify app config link --config shopify.app.<client>.toml`.
- Store CLI output (Org ID, App ID) in runbook for future validation.

### Helper Scripts (located in `scripts/`)

- `list-shopify-configs.sh`: enumerate `shopify.app.*.toml` files + indicate active one.
- `use-shopify-config.sh <client>`: wrapper for `shopify app config use`, followed by `shopify app info`.
- `verify-shopify-config.sh`: prints active client slug, app name, target store, and warns if environment vars missing.
- Scripts must exit non-zero on mismatch to block deployments.

### Deployment Runbook

1. `./scripts/use-shopify-config.sh <client>`
2. Confirm summary output (client name, store domain, scopes).
3. Manual checkpoint: operator verbally confirms target client.
4. `shopify app deploy` or `shopify app deploy --config shopify.app.<client>.toml`.
5. Record deployment in log (script auto-appends entry).
6. Post-deploy verification:
    - `shopify app info`
    - Trigger health check endpoint (`/app/status`) per client
    - Validate recent webhook handshake.

### Shopify API Version Upgrades

- Execute Shopify API version bumps manually and in a synchronized window across all client configurations.
- Coordinate the upgrade by switching each client TOML config, deploying updates sequentially, and confirming `shopify app info` before moving to the next client.
- Record completion per client in the deployment log to maintain traceability.

### Rollback Strategy

- Use Vercel rollback to restore the previously stable deployment when a client-specific issue is detected.
- After rollback, rerun `shopify app info` to confirm the active config still targets the intended client before retrying deployment.
- Update incident notes and deployment log with rollback timestamp and operator.

### Adding a New Client (End-to-End)

1. Partner Dashboard steps (above).
2. Add secrets to environment store.
3. Generate TOML from template and link config.
4. Update credential map (`clientCredentialMap`).
5. Run secret validation script.
6. Deploy app config to register app extension.
7. Test OAuth install on client store using new config.
8. Update documentation table with shop domain, client slug, deployment status.
9. Enable monitoring filters and alerts for new client.

### Troubleshooting & Incident Response

- **OAuth fails**: check logs filtered by `clientSlug`, ensure env vars present, confirm Partner Dashboard callback URLs.
- **Wrong client deployed**: use deployment log to identify misfire, re-run deploy for affected client, rotate credentials if compromised.
- **Missing credentials at runtime**: startup validation halts server with actionable error message; follow env variable remediation steps.
- **API call failures**: log includes `shopDomain`, `clientSlug`, response status; run targeted smoke test using stored access token.

### Monitoring Dashboard Requirements

- Display per-client metrics: active installs, daily API calls, error rate, OAuth success/failure counts.
- Alert thresholds: 3 consecutive OAuth failures, API auth error >5% in 15 minutes, missing credential detection.
- Logs stored with searchable fields (`clientSlug`, `shopDomain`, `operation`).

---

## Implementation Roadmap

| Phase | Focus                      | Key Deliverables                                                         | Status          | Notes                                                                  |
| ----- | -------------------------- | ------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| 0     | Foundations                | Template TOML, helper scripts skeleton, configuration naming guidelines  | ✅ **Complete** | See [Preparation Summary](../docs/multi-client-preparation-summary.md) |
| 1     | Backend Multi-tenancy      | Prisma migration, credential map, OAuth selection logic, env validation  | ⏳ Pending      | Requires coordinated secret rollout                                    |
| 2     | CLI & Deployment Tooling   | Scripts for list/switch/verify, deployment logging, confirmation prompts | ✅ **Partial**  | Helper scripts created; deployment logging pending                     |
| 3     | Documentation & Onboarding | README updates, runbooks, troubleshooting, architecture diagram          | ✅ **Complete** | All docs created (architecture diagram pending)                        |
| 4     | Observability              | Structured logging, metrics dashboard, alert wiring                      | ⏳ Pending      | Leverage existing logging stack                                        |

### Phase 0 Completion Summary

**Completed (2025-10-30):**

- ✅ `shopify.app.template.toml` created with inline comments
- ✅ Helper scripts: `list-shopify-configs.sh`, `verify-shopify-config.sh`, `use-shopify-config.sh`
- ✅ Credential mapping template: `app/config/client-credentials.template.ts`
- ✅ Draft Prisma schema: `prisma/schema.multi-client-draft.prisma`
- ✅ README section added
- ✅ Documentation templates: onboarding, troubleshooting, client registry
- ✅ Status endpoint enhanced (optional shop domain extraction)

**Files Created:**

- Configuration template and helper scripts (see `scripts/` directory)
- Documentation templates (see `docs/multi-client-*.md`)
- Code templates (see `app/config/client-credentials.template.ts`)

**Risk Assessment:** 🟢 Zero - All changes are additive and non-functional

See [Multi-Client Preparation Summary](../docs/multi-client-preparation-summary.md) for complete details.

Each phase should be validated before moving forward to ensure credential safety.

---

## Documentation Deliverables

| Document                                            | Status      | Location                                                            |
| --------------------------------------------------- | ----------- | ------------------------------------------------------------------- |
| `shopify.app.template.toml`                         | ✅ Complete | Root directory                                                      |
| README section "Multi-Client Shopify Configuration" | ✅ Complete | `README.md`                                                         |
| `docs/multi-client-onboarding.md`                   | ✅ Complete | Template ready, to be populated during implementation               |
| `docs/multi-client-troubleshooting.md`              | ✅ Complete | Template ready, to be populated during implementation               |
| `docs/client-registry.md`                           | ✅ Complete | Template ready for client data                                      |
| `docs/multi-client-preparation-summary.md`          | ✅ Complete | Summary of Phase 0 work                                             |
| Architecture diagram                                | ⏳ Pending  | Mermaid or Excalidraw illustrating multi-app-to-single-backend flow |
| Monitoring guide                                    | ⏳ Pending  | To be created during Phase 4                                        |
| Scripts README                                      | ⏳ Pending  | Usage documented inline in scripts, formal README pending           |

**Implementation Scripts Created:**

- `scripts/list-shopify-configs.sh` - List available configurations
- `scripts/verify-shopify-config.sh` - Verify current configuration
- `scripts/use-shopify-config.sh` - Switch between client configurations

**Code Templates Created:**

- `app/config/client-credentials.template.ts` - Credential mapping structure
- `prisma/schema.multi-client-draft.prisma` - Database schema draft (not applied)

---

## Risks & Mitigations

- **Risk:** Accidental deployment to wrong client.
  **Mitigation:** Mandatory verification script + manual confirmation + deployment log requiring operator input.
- **Risk:** Missing or stale secrets cause runtime failures.
  **Mitigation:** Startup env validation, pre-deploy secret check script, alerting on missing envs.
- **Risk:** Unauthorized cross-client data access.
  **Mitigation:** Always scope DB queries by `shopDomain` and `clientSlug`; encrypt secrets; rotate tokens when clients offboard.
- **Risk:** CLI workflow drift / manual errors.
  **Mitigation:** Documented scripts, pair-run first few deployments, include acceptance checklist.
- **Risk:** Scaling beyond 20 clients.
  **Mitigation:** Document triggers for migrating to single public app with custom distribution; monitor script performance and env var management overhead.

---

## Dependencies, Decisions & Validation

### Resolved Decisions

- Client-specific feature overrides will not be supported; all clients share the same feature set.
- Client TOML files remain version-controlled alongside `shopify.app.toml`, with secrets referenced via environment variables.
- Shopify API version upgrades are deployed manually in a synchronized sequence across all client configurations.
- Vercel rollback is the standard mechanism to recover from client-specific deployment regressions.

### Decisions Pending Approval

- Store per-client credentials via environment variables referenced in the mapping file (vs. runtime secrets manager calls).
- Logging stack selection for per-client dashboards (reuse current provider vs. adopt new tool).
- Deployment log storage location (in-repo log vs. external service).
- Prisma schema changes timeline and migration strategy (requires downtime? roll forward plan?).

### External Dependencies

- Shopify Partner Dashboard access for each client.
- Secrets management tooling to store client credentials securely.
- Operations approval for new logging/alerting configuration.

### Validation Checklist

- Template validated by spinning up dummy client config.
- CLI helper scripts tested across macOS/Linux shells.
- OAuth install tested for at least two clients in staging.
- Deployment runbook dry-run with non-production store.
- Monitoring alerts verified via synthetic failure.

---

## Appendix

### Template Outline (`shopify.app.template.toml`)

```toml
client_id = "${CLIENT_SLUG_ID}"
name = "Dreamshot (Client Name)"
application_url = "${SHOPIFY_APP_URL}"
embedded = true

[auth]
redirect_urls = [
  "${SHOPIFY_APP_URL}/auth/callback",
  "${SHOPIFY_APP_URL}/auth/shopify/callback"
]

[webhooks]
api_version = "2025-07"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks/app/uninstalled"

[access_scopes]
scopes = "write_products"

# Additional sections copied from primary config
```

### Deployment Log Format

```
2025-10-30T15:04:12Z | operator=txemaleon | client=cliente-a | shop=cliente-a.myshopify.com | commit=abc1234 | command=shopify app deploy
```

---

## Current Status & Next Steps

### Phase 0: Foundations (✅ Complete)

All preparation work has been completed with zero runtime risk:

- Configuration templates and helper scripts are in place
- Documentation structure established
- Code templates ready for implementation
- No breaking changes to existing functionality

**Key Files:**

- See [Multi-Client Preparation Summary](../docs/multi-client-preparation-summary.md) for complete inventory

### Ready for Phase 1: Backend Multi-tenancy

**Prerequisites:**

- [ ] Secret management system configured (Vercel env vars, 1Password, etc.)
- [ ] First client credentials obtained from Partner Dashboard
- [ ] Database backup before migration

**Implementation Steps:**

1. Review and apply Prisma schema migration from draft
2. Populate `client-credentials.template.ts` with first client mapping
3. Update `shopify.server.ts` to use multi-client credential lookup
4. Add environment variable validation at startup
5. Test OAuth flow with first multi-client setup

## Open Questions

None at this time.
