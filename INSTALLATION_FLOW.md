# Shopify App Installation & OAuth Flow

## Overview

Your app uses the **new embedded auth strategy** (`unstable_newEmbeddedAuthStrategy: true`) with Shopify managed installation.

## Installation Flow (How it SHOULD work)

### 1. Merchant Clicks "Install App"

When a merchant installs your app from the Shopify App Store or custom installation URL:

```
https://admin.shopify.com/store/{shop}/oauth/install?client_id={client_id}
```

### 2. Shopify Managed Installation

Because you have `access_scopes` configured in `shopify.app.toml`, Shopify handles the OAuth flow automatically:

- Shopify shows the merchant the permission screen
- Merchant approves the requested scopes (`write_files`, `write_products`)
- Shopify generates an access token

### 3. Redirect to App

Shopify redirects the merchant to your app's URL with an embedded token:

```
https://shopify.dreamshot.io/?shop={shop}&host={base64_host}&session={session_token}
```

OR (for traditional OAuth callback):

```
https://shopify.dreamshot.io/auth/callback?code={code}&shop={shop}&host={host}&state={state}
```

### 4. Token Exchange / Session Creation

Your app's authentication routes handle the token:

- **Route**: `app/routes/auth.$.tsx` (catches all `/auth/*` paths)
- **Action**: Calls `authenticate.admin(request)`
- **Result**: Creates session in database

### 5. Session Storage

The `@shopify/shopify-app-session-storage-prisma` package stores the session:

```typescript
Session {
  id: string
  shop: string
  state: string
  isOnline: boolean
  accessToken: string
  scope: string
  expires: DateTime
  // ... other fields
}
```

### 6. Redirect to App Dashboard

After successful authentication, the merchant is redirected to:

```
https://shopify.dreamshot.io/app
```

Which loads `app/routes/app._index.tsx` (your dashboard).

## Why 404 Happens on New Installations

### Possible Root Causes:

1. **OAuth callback not reached**
   - Shopify redirects to `/auth/callback` but route doesn't match
   - Check: `app/routes/auth.$.tsx` should catch this

2. **Session not created**
   - Authentication succeeds but session fails to save to DB
   - Check: Database connection, Prisma migrations

3. **Missing redirect after OAuth**
   - OAuth completes but app doesn't redirect to `/app`
   - Check: `authenticate.admin()` should handle redirect

4. **Environment variable mismatch**
   - `SHOPIFY_APP_URL` doesn't match actual deployment URL
   - Check: Vercel env vars vs `shopify.app.toml`

5. **Database migration not run**
   - Session table doesn't exist
   - Check: Vercel build logs for Prisma errors

## Debugging Steps

### 1. Check if OAuth callback is being called

Deploy the updated code and monitor Vercel Runtime Logs for:

```
[auth.$] OAuth callback called
[auth.$] Full URL: ...
[auth.$] Shop param: ...
```

If you DON'T see these logs, OAuth callback is not being reached.

### 2. Check session creation

Look for:

```
[auth.$] Authentication successful
[auth.$] Session shop: your-shop.myshopify.com
```

If you see this, session was created successfully.

### 3. Check database sessions

Visit:

```
https://shopify.dreamshot.io/debug/sessions
```

This will show all sessions in the database. Look for the new shop.

### 4. Check app loader

Look for:

```
[app.tsx] Loader called, URL: ...
[app.tsx] SHOPIFY_API_KEY exists: true
[app.tsx] Authentication successful
```

If you see 404 before these logs, the route isn't being reached.

## Configuration Checklist

### shopify.app.toml

- [x] `application_url` matches deployment URL
- [x] `embedded = true`
- [x] `access_scopes.scopes` includes required permissions
- [x] `auth.redirect_urls` includes all OAuth callback URLs

### Vercel Environment Variables

- [ ] `SHOPIFY_API_KEY` (should match `client_id` in shopify.app.toml)
- [ ] `SHOPIFY_API_SECRET` (from Shopify Partner Dashboard)
- [ ] `SHOPIFY_APP_URL` (should match `application_url`)
- [ ] `SCOPES` (should match `access_scopes.scopes`)
- [ ] `DATABASE_URL` (PostgreSQL connection string, NOT SQLite)

### app/shopify.server.ts

- [x] `authPathPrefix: "/auth"`
- [x] `future.unstable_newEmbeddedAuthStrategy: true`
- [x] Session storage configured with Prisma

## Key Routes

| Route | File | Purpose |
|-------|------|---------|
| `/auth/*` | `app/routes/auth.$.tsx` | OAuth callback handler |
| `/auth/login` | `app/routes/auth.login/route.tsx` | Manual login page |
| `/app` | `app/routes/app._index.tsx` | Main dashboard (requires auth) |
| `/status` | `app/routes/status.tsx` | Health check (no auth) |
| `/debug/sessions` | `app/routes/debug.sessions.tsx` | Session debugging (no auth) |

## Expected Vercel Logs for Successful Installation

```
[auth.$] OAuth callback called
[auth.$] Full URL: https://shopify.dreamshot.io/auth/callback?code=...&shop=test-shop.myshopify.com&...
[auth.$] Shop param: test-shop.myshopify.com
[auth.$] Authentication successful
[auth.$] Session shop: test-shop.myshopify.com
[auth.$] Session ID: offline_test-shop.myshopify.com
[app.tsx] Loader called, URL: https://shopify.dreamshot.io/app?shop=test-shop.myshopify.com&...
[app.tsx] SHOPIFY_API_KEY exists: true
[app.tsx] Authentication successful
[app.tsx] Billing check passed
```

## Next Steps After Deploying

1. **Install app in a new test shop**
2. **Monitor Vercel Runtime Logs** in real-time
3. **Check `/debug/sessions`** to see if session was created
4. **Compare logs** with the expected flow above

## Common Issues

### Issue: No OAuth callback logs

**Symptom**: No `[auth.$]` logs appear when installing

**Cause**: Shopify not redirecting to your app

**Fix**:
- Check `application_url` in `shopify.app.toml` matches Vercel URL
- Check `auth.redirect_urls` includes the callback URL
- Verify app is not in "test mode" requiring manual URL entry

### Issue: OAuth succeeds but 404 on /app

**Symptom**: See `[auth.$] Authentication successful` but then 404

**Cause**: Redirect not working or `/app` route not found

**Fix**:
- Check if `app/routes/app.tsx` and `app/routes/app._index.tsx` exist
- Verify Vite build includes these routes
- Check Vercel build logs for route compilation errors

### Issue: Database error on session creation

**Symptom**: See error in `[auth.$]` logs about database

**Cause**: Prisma can't connect or Session table doesn't exist

**Fix**:
- Check `DATABASE_URL` is valid PostgreSQL connection
- Verify `npx prisma migrate deploy` ran in build
- Check Vercel build logs for Prisma errors

### Issue: "Shop parameter missing"

**Symptom**: Error about missing shop parameter

**Cause**: OAuth callback URL doesn't include `?shop=...`

**Fix**:
- Check Shopify Partner Dashboard redirect URLs
- Ensure `shopify.app.toml` redirect URLs are correct
- Verify app is using embedded mode

## URLs to Monitor

After deployment:

1. **Status check**: https://shopify.dreamshot.io/status
2. **Session debug**: https://shopify.dreamshot.io/debug/sessions
3. **Vercel logs**: Vercel Dashboard → Runtime Logs

## Security Note

**IMPORTANT**: Remove or protect `/debug/sessions` in production:

```typescript
// Add authentication check
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    throw new Response("Not Found", { status: 404 });
  }
  // ... rest of code
}
```
