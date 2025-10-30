# Multi-Client Troubleshooting Guide

> **Status:** Template - Prepared for future implementation

## Common Issues

### OAuth Installation Fails

**Symptoms:**

- Installation redirects fail
- Error: "Invalid redirect_uri"
- Token exchange errors

**Diagnosis:**

1. Check logs filtered by `clientSlug` and `shopDomain`
2. Verify environment variables: `CLIENT_<SLUG>_ID` and `CLIENT_<SLUG>_SECRET`
3. Confirm Partner Dashboard callback URLs match TOML config
4. Check `shopify app info` shows correct client_id

**Resolution:**

- Update Partner Dashboard redirect URLs if mismatched
- Verify env vars are set in deployment environment
- Ensure TOML config uses correct placeholders

### Wrong Client Configuration Active

**Symptoms:**

- `shopify app info` shows unexpected client
- Deployments target wrong store

**Diagnosis:**

```bash
./scripts/verify-shopify-config.sh
shopify app info
```

**Resolution:**

```bash
./scripts/use-shopify-config.sh <correct-client>
```

### Missing Credentials at Runtime

**Symptoms:**

- Server fails to start
- Error: "Missing required environment variable"
- OAuth requests fail with auth errors

**Diagnosis:**

1. Check startup logs for validation errors
2. Run: `./scripts/verify-shopify-config.sh`

**Resolution:**

1. Add missing env vars to deployment environment
2. Verify credential map includes client
3. Restart backend service

### API Call Failures

**Symptoms:**

- Shopify API requests return 401/403
- "Invalid access token" errors

**Diagnosis:**

1. Check logs for `shopDomain` and `clientSlug`
2. Verify access token exists in database
3. Confirm correct credentials used for OAuth

**Resolution:**

1. Re-authenticate shop via OAuth flow
2. Verify credential map lookup matches shop domain
3. Check token refresh logic

### Cross-Client Data Leakage

**Symptoms:**

- Shop A sees Shop B's data
- Incorrect credentials used for shop

**Diagnosis:**

1. Audit credential map lookups
2. Check database queries scoped by `shopDomain`
3. Review session storage isolation

**Resolution:**

1. Immediately rotate affected credentials
2. Audit database queries ensure shop filtering
3. Review logs for unauthorized access patterns

## Emergency Procedures

### Credential Compromise

1. Rotate credentials in Partner Dashboard
2. Update environment variables
3. Revoke all existing sessions
4. Force re-authentication for affected shops

### Rollback Deployment

```bash
# Use Vercel rollback
vercel rollback

# Verify active config
shopify app info

# Re-deploy correct client
./scripts/use-shopify-config.sh <client>
shopify app deploy
```

## Log Locations

- Application logs: Vercel dashboard / Logtail
- Deployment log: `logs/deployments.log` (if configured)
- Shopify CLI: `.shopify/` directory

## Support

For issues not covered here, refer to:

- [PRD: Multi-Client Configuration](../prd/PRD-Multi-Client-Shopify-App-Configuration.md)
- Shopify Partner Support
- Internal team Slack channel
