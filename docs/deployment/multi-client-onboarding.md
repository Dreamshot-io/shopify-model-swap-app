# Multi-Client Onboarding Guide

> **Status:** Template - Prepared for future implementation
>
> This guide will be populated when implementing multi-client support. For now, use the standard single-client setup documented in the main README.

## Overview

This guide will walk through onboarding a new Shopify Plus client to the Dreamshot app using the multi-client configuration system.

## Prerequisites

- Shopify Partner Dashboard access
- Client's Shopify Plus store domain
- Access to secrets management system (Vercel env vars, 1Password, etc.)
- Local development environment with Shopify CLI installed

## Step-by-Step Process

### 1. Create Partner Dashboard App

1. Navigate to Partner Dashboard → Apps
2. Click "Create app" → Select "Custom distribution"
3. Configure:
    - **App name**: "Dreamshot - [Client Name]"
    - **Target store**: Client's Shopify Plus domain
    - **App URL**: `${SHOPIFY_APP_URL}` (shared backend)
    - **Redirect URLs**: Same as in template
4. Save and note the `client_id` and `client_secret`

### 2. Store Credentials

1. Add environment variables:
    - `CLIENT_<SLUG>_ID` = Partner Dashboard client_id
    - `CLIENT_<SLUG>_SECRET` = Partner Dashboard client_secret
2. Document in client registry (`docs/client-registry.md`)

### 3. Generate Configuration File

```bash
cp shopify.app.template.toml shopify.app.<client-slug>.toml
# Edit file to replace placeholders with actual values
```

### 4. Link Configuration

```bash
shopify app config use shopify.app.<client-slug>.toml
shopify app config link
```

### 5. Verify Configuration

```bash
./scripts/verify-shopify-config.sh
shopify app info
```

### 6. Deploy App Extension

```bash
shopify app deploy
```

### 7. Test Installation

1. Visit client store
2. Install app via OAuth flow
3. Verify app appears in admin
4. Test basic functionality

### 8. Update Documentation

- Add entry to `docs/client-registry.md`
- Update monitoring dashboards with new client filters

## Troubleshooting

See `docs/multi-client-troubleshooting.md` for common issues.

## Related Documentation

- [Multi-Client Troubleshooting](./multi-client-troubleshooting.md)
- [Client Registry](./client-registry.md)
- [PRD: Multi-Client Configuration](../prd/prd-multi-client-shopify-app-configuration.md)
