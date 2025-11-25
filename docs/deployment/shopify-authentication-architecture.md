# Shopify Authentication Architecture

> **Note**: For complete statistics export system documentation, see [statistics-export-system.md](../infrastructure/statistics-export-system.md)

## Overview

This app uses a **hybrid multi-tenant architecture** supporting both:
1. **Public OAuth apps** - Standard Shopify App Store installations
2. **Private apps** - Custom credentials per shop (for white-label/custom clients)

## Data Model

### ShopCredential Table
Stores app credentials (API key/secret) per shop:

```prisma
model ShopCredential {
  id           String               @id
  shopDomain   String               @unique
  apiKey       String               // Client ID
  apiSecret    String               // Client Secret
  appHandle    String
  appUrl       String
  mode         ShopCredentialMode   // PUBLIC or PRIVATE
  status       ShopCredentialStatus // ACTIVE or DISABLED
  // ... relations
}
```

### Session Table
Stores OAuth access tokens (created during installation/auth):

```prisma
model Session {
  id            String
  shop          String              // Shop myshopify.com domain
  accessToken   String              // OAuth access token (NOT API key)
  isOnline      Boolean
  expires       DateTime?
  shopId        String?             // FK to ShopCredential
  // ... other fields
}
```

## Key Distinction: Private App vs OAuth

### Traditional Private App (Deprecated by Shopify)
- Shop admin creates app in Shopify admin
- Gets: API key + API secret + **Admin API password**
- Direct API access with credentials (no OAuth flow)

### Custom OAuth App (What This App Uses)
- Each client gets unique API key/secret pair
- Shop installs app via OAuth flow
- OAuth returns **access token** (stored in Session.accessToken)
- API key/secret are only for **validating OAuth**, not direct API calls

## Authentication Flow

### 1. Installation/Login
```
User clicks "Install" → OAuth flow → Access token generated → Stored in Session
```

### 2. Request Authentication
```typescript
// In shopify.server.ts
authenticate.admin(request)
  ↓
resolveCredentialFromRequest(request)  // Finds ShopCredential
  ↓
getShopifyAppForCredential(credential) // Creates Shopify App instance
  ↓
app.authenticate.admin(request)        // Uses Session.accessToken
```

### 3. Background Jobs (Unauthenticated)
```typescript
// For cron jobs, backfills, etc.
unauthenticated.admin(shopDomain)
  ↓
requireShopCredential({ shopDomain })  // Gets ShopCredential
  ↓
getShopifyAppForCredential(credential) // Creates app with API key/secret
  ↓
app.unauthenticated.admin(shop)        // Returns { admin, session }
  ↓
Uses Session.accessToken from database
```

## Current Issue: Missing Sessions

### Problem
- **ShopCredential** exists for: `bumbba.com`, `haanbrand.com`, `hellomims.com`
- **Session** exists for: `hello-mims.myshopify.com`, `haanready.myshopify.com`, `charming-heroic-vulture.myshopify.com`
- **Mismatch**: ShopCredential.shopDomain ≠ Session.shop

### Why?
Sessions are stored with `.myshopify.com` domain during OAuth, but ShopCredentials use custom domain.

### Evidence
```sql
-- ShopCredentials
bumbba.com          (no matching session)
haanbrand.com       (no matching session)  
hellomims.com       (no matching session)

-- Sessions  
charming-heroic-vulture.myshopify.com (shopId: null)
haanready.myshopify.com               (shopId: null)
hello-mims.myshopify.com              (shopId: null)
```

## Solution Options

### Option 1: Link Sessions to ShopCredentials
Update Session.shopId to link to correct ShopCredential:

```sql
-- Find myshopify domain for each custom domain
UPDATE Session SET shopId = (
  SELECT id FROM ShopCredential 
  WHERE ShopCredential.shopDomain = 'bumbba.com'
) 
WHERE shop = 'charming-heroic-vulture.myshopify.com';
```

### Option 2: Use CustomDomain Field
Store myshopify domain in ShopCredential.customDomain:

```sql
UPDATE ShopCredential 
SET customDomain = 'charming-heroic-vulture.myshopify.com'
WHERE shopDomain = 'bumbba.com';
```

### Option 3: Session Lookup by ShopCredential
Modify `getShopifyAdmin()` to find session by shopId relation:

```typescript
const credential = await requireShopCredential({ shopDomain });
const session = await prisma.session.findFirst({
  where: {
    shopId: credential.id,  // Use FK instead of shop domain
    isOnline: false,
  }
});
```

## Recommended Fix

**Option 1 + Option 3** (Most robust):

1. **Populate shopId in existing sessions**:
```typescript
// Migration script
const sessions = await prisma.session.findMany({ where: { shopId: null } });
for (const session of sessions) {
  // Try to find matching ShopCredential
  const cred = await prisma.shopCredential.findFirst({
    where: {
      OR: [
        { shopDomain: session.shop },
        { customDomain: session.shop }
      ]
    }
  });
  if (cred) {
    await prisma.session.update({
      where: { id: session.id },
      data: { shopId: cred.id }
    });
  }
}
```

2. **Update session lookup logic**:
```typescript
async function getShopifyAdmin(shopDomain: string) {
  const credential = await requireShopCredential({ shopDomain });
  
  // Find session by shopId FK (not shop domain)
  const session = await prisma.session.findFirst({
    where: {
      shopId: credential.id,
      isOnline: false,
    },
    orderBy: { expires: 'desc' },
  });
  
  if (!session) {
    throw new Error(`No valid session found for shopId: ${credential.id}`);
  }
  
  const admin = await unauthenticated.admin(session.shop);
  return admin;
}
```

## Private App Credentials in Database

### What's Stored
- `apiKey`: OAuth client ID (public identifier)
- `apiSecret`: OAuth client secret (for signature validation)
- `Session.accessToken`: OAuth access token (for API calls)

### What's NOT Stored
- Admin API password (deprecated by Shopify)
- Direct API credentials (this uses OAuth exclusively)

### How It Works
1. Each shop gets unique `apiKey`/`apiSecret` pair
2. During OAuth installation, Shopify returns `accessToken`
3. `accessToken` is stored in Session table
4. Background jobs use `unauthenticated.admin()` which loads Session.accessToken
5. All API calls use the access token, not the API secret

## Token Types Explained

| Type | Where | Purpose | Example |
|------|-------|---------|---------|
| API Key | `ShopCredential.apiKey` | OAuth client ID | `abc123...` |
| API Secret | `ShopCredential.apiSecret` | OAuth signature validation | `shpss_def456...` |
| Access Token | `Session.accessToken` | API authentication | `shpca_789xyz...` |
| Session Token | Request headers | Frontend auth | JWT |

## Summary

- **ShopCredential** = App configuration (who owns which API key/secret)
- **Session** = User authorization (access token from OAuth)
- **Mode PUBLIC** = Uses shared public app credentials
- **Mode PRIVATE** = Uses dedicated API key/secret per client
- **Both modes** use OAuth flow to get access tokens
- **Access tokens**, not API secrets, are used for API calls
- **API key/secret** are ONLY for OAuth setup and request validation
- **You can make API calls with ONLY the access token** (no key/secret needed)
- **Sessions linked via shopId FK**: Fixed to handle custom domains
- **Script**: `bun run link:sessions` to link orphaned sessions

## Recent Fixes (Nov 21, 2025)

### Empty App Screen Issue
**Problem**: App showed blank page in Shopify Admin after install

**Root Cause**: 
- genlabs-dev-store had OLD private app credentials in database
- New PUBLIC app credentials in environment variables
- Mismatch caused authentication to fail silently

**Solution**:
1. Updated `.env` to use PUBLIC app credentials
2. Deleted old ShopCredential and Session records
3. Updated `shopify.app.ab-test.toml` with dev tunnel URL
4. Reinstalled app (created new Session with correct credentials)

**Key Learning**: Database credentials must match environment variables and TOML config exactly

### Session Linking for Custom Domains
**Problem**: Statistics export failed for custom domains (bumbba.com, haanbrand.com, hellomims.com)

**Root Cause**: 
- Sessions stored with `.myshopify.com` domain
- ShopCredentials used custom domain
- Lookup by domain string failed

**Solution**:
1. Created `scripts/link-sessions-to-credentials.ts`
2. Queries Shopify API for primary/myshopify domain per shop
3. Links Session.shopId to correct ShopCredential.id
4. All session lookups now use FK instead of domain matching

**Script**: `bun run link:sessions`

## Status

✅ **All systems operational**:
- ✅ Sessions properly linked to credentials via FK
- ✅ Custom domain support working
- ✅ Backfill script functional for all shops
- ✅ Cron job configured and active in vercel.json
- ✅ CRON_SECRET automatically provided by Vercel in production
- ✅ Dev environment configured with PUBLIC app credentials
- ✅ genlabs-dev-store successfully using PUBLIC app mode
