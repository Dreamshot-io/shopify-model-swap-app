## Vercel Migration Plan for Shopify Remix App

### Objective

Migrate the Remix-based Shopify app to Vercel’s serverless platform following Shopify and Vercel best practices. Ensure stateless operation, reliable persistence, and performance within serverless constraints.

### Summary of Required Changes

- Migrate database from SQLite to PostgreSQL (serverless-friendly).
- Optimize Prisma client for serverless and connection pooling.
- Add Vercel adapter for Remix with a single serverless entry function and rewrites.
- Provide complete environment variable setup for Vercel.
- Keep S3-compatible storage (R2) and fal.ai as-is.
- Optionally improve long-running upload flows (reduce polling / background).

### Assumptions

- PostgreSQL is provisioned (Vercel Postgres, Neon, Supabase, or RDS with pooling).
- We will use a pooled connection string or Prisma Accelerate compatible setup.

---

### Phased Plan

#### Phase 1: Database & Prisma

- Switch `prisma/schema.prisma` datasource to PostgreSQL via `env("DATABASE_URL")`.
- Add `DATABASE_URL` to env types and `.env.example`.
- Ensure Prisma client initialization is serverless-safe (singleton reuse across invocations).
- Add `prisma generate` to build step and prepare `vercel-build` script.
- Run `prisma migrate deploy` against Postgres during deployment.

Risks:

- Schema differences between SQLite and Postgres (types/indexes). Validate migrations and adjust if needed.

#### Phase 2: Runtime & Adapter

- Add Vercel adapter entry using `@remix-run/vercel` Node runtime handler.
- Add `vercel.json` rewrites routing all traffic to the Remix handler.
- Set sensible function `maxDuration` (e.g., 30s) for Node runtime.

Risks:

- Edge runtime is not suitable due to Node-only deps (Prisma, AWS SDK). Use Node runtime.

#### Phase 3: Upload & Long-running Ops (Optional/Next)

- Current polling for file processing can approach function timeouts under load.
- Options:
    - Reduce polling or add exponential backoff.
    - Switch to webhook-based completion from Shopify to avoid active polling.
    - Use background function or queue for long tasks.

#### Phase 4: Operational Readiness

- Configure all environment variables in Vercel.
- Update `shopify.app.toml` `application_url` and App Proxy URL after first deploy.
- Set up logging/monitoring (e.g., Vercel logs, Sentry).
- Smoke test auth, webhooks, uploads, and proxy route.

---

### Implementation TODO (Checklist)

- [ ] Switch Prisma datasource to PostgreSQL via `DATABASE_URL` in `prisma/schema.prisma`
- [ ] Update Prisma client initialization for serverless reuse in `app/db.server.ts`
- [ ] Add `.env.example` with all required variables and update `env.d.ts`
- [ ] Add `postinstall` (prisma generate) and `vercel-build` scripts in `package.json`
- [ ] Prepare `vercel.json` with rewrites and function config
- [ ] Add Vercel Remix adapter entry (Node runtime)
- [ ] Configure Vercel environment variables and secrets
- [ ] Update `shopify.app.toml` URLs to Vercel domain post-deploy
- [ ] Validate and, if needed, optimize file upload flow for serverless
- [ ] Add monitoring/logging and run readiness checks

---

### Rollback Plan

- Keep a branch with SQLite config for local dev if needed.
- If Postgres migration fails, revert datasource and redeploy previous version.

### Success Criteria

- All routes and webhooks respond on Vercel without timeouts.
- Database read/write succeeds with pooled connections.
- File uploads complete successfully; no blocked threads or timeouts.
- Shopify embedded app loads and App Proxy endpoint functions correctly.
