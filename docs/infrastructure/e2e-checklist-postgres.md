## E2E Checklist (Postgres)

Run these checks on staging after wiring `DATABASE_URL`:

1. App health

- Open embedded app in Shopify admin (auth flow works)
- Check `/health` route returns OK

2. Session storage

- Login and refresh app; sessions persist
- Reinstall app on a dev store and confirm installation completes

3. Webhooks

- Trigger `app/uninstalled` (test store uninstall) and confirm handler logs/DB writes
- Trigger scopes update and subscription update if applicable

4. A/B Testing

- Create a new test; verify records in `ABTest`, `ABTestVariant`
- Start/stop test and verify status changes and timestamps

5. File Uploads & AI

- Upload image in AI Studio; ensure Shopify staged upload flow completes
- Generate at least one AI image; confirm storage to R2 and references in UI

6. App Proxy & Pixel

- Hit app proxy route under `apps/model-swap/...`; verify HMAC and shop context
- Confirm storefront pixel loads and emits events

7. Performance & Errors

- Verify no Prisma connection errors under load
- Confirm logs for slow requests and errors (Sentry/Vercel)

8. Backups

- Ensure Postgres backups enabled; test a snapshot restore (non-prod)
