# Quick Start: Public + Private App Architecture

**Deploy multi-mode Shopify app in 5 minutes**

---

## TL;DR

```bash
# 1. Set environment variables in Vercel
SHOPIFY_PUBLIC_API_KEY=<from_shopify.app.toml>
SHOPIFY_PUBLIC_API_SECRET=<from_partner_dashboard>

# 2. Deploy
git push origin main

# 3. Verify (wait for deployment)
# - Check Vercel logs for successful migration
# - Test existing private apps (should work unchanged)
# - Test new public installation in dev store
```

---

## What Changed?

✅ **Database:** Added `mode` field to `ShopCredential` (`PUBLIC` | `PRIVATE`)  
✅ **Code:** Auto-detects installation mode and routes accordingly  
✅ **Behavior:** Private apps unchanged, public apps now supported  

---

## Deployment Steps

### 1. Configure Vercel (2 minutes)

**Vercel Dashboard → Settings → Environment Variables → Production**

Add:
```
SHOPIFY_PUBLIC_API_KEY = a37f0ea132844ccc3c8e104205da4c41
SHOPIFY_PUBLIC_API_SECRET = <get_from_partner_dashboard>
```

**Where to find the secret:**
1. Open [Shopify Partners](https://partners.shopify.com/)
2. Apps → dreamshot-model-swap → API credentials
3. Copy "API secret key"

### 2. Deploy (1 minute)

```bash
git add .
git commit -m "feat: public + private app architecture"
git push origin main
```

Vercel automatically:
- ✅ Runs migration
- ✅ Marks existing 5 shops as `PRIVATE`
- ✅ Deploys new code

### 3. Verify (2 minutes)

**A. Check deployment logs (Vercel Dashboard):**
```
✓ Prisma generated
✓ 5 migrations found
✓ No pending migrations to apply
✓ Build succeeded
```

**B. Test existing private app:**
1. Open any of the 5 client stores
2. Navigate to Apps → Dreamshot
3. Verify it loads and works normally

**C. Test new public installation:**
```
https://admin.shopify.com/store/<dev-store>/oauth/install?client_id=a37f0ea132844ccc3c8e104205da4c41
```

Check Vercel logs for:
```
[shopify.server] Registering new public installation: <store>.myshopify.com
```

---

## Verification Queries

### Check Migration Applied

```sql
SELECT * FROM "_prisma_migrations" 
ORDER BY finished_at DESC 
LIMIT 1;
-- Expected: 20251120135704_add_shop_credential_mode
```

### Check Existing Shops

```sql
SELECT shopDomain, mode, status 
FROM "ShopCredential" 
ORDER BY createdAt;
-- Expected: 5 shops with mode = 'PRIVATE'
```

### Check New Public Installs

```sql
SELECT shopDomain, mode, createdAt 
FROM "ShopCredential" 
WHERE mode = 'PUBLIC';
-- Shows new public installations
```

---

## Testing Checklist

### Private Apps (Zero Breaking Changes)
- [ ] All 5 existing clients load
- [ ] Can create A/B tests
- [ ] AI Studio works
- [ ] Pixel tracking active

### Public App (New Feature)
- [ ] Installs successfully in dev store
- [ ] Dashboard loads
- [ ] Can create A/B test
- [ ] Can generate AI images
- [ ] Uninstall removes database record

---

## Troubleshooting

### Private app returns 404

**Check:**
```sql
SELECT * FROM "ShopCredential" WHERE shopDomain = '<shop>.myshopify.com';
```

**Fix:** If `mode = 'PUBLIC'`, update to `'PRIVATE'`

### Public installation fails

**Check Vercel logs for:**
- Invalid `SHOPIFY_PUBLIC_API_KEY`
- Missing `SHOPIFY_PUBLIC_API_SECRET`
- OAuth callback errors

**Fix:** Verify environment variables match Partner Dashboard values

### Migration didn't run

**Manually run:**
```bash
# Connect to production database
bun run prisma migrate deploy
```

---

## Rollback

If needed, remove environment variables in Vercel:
```
SHOPIFY_PUBLIC_API_KEY ❌ Delete
SHOPIFY_PUBLIC_API_SECRET ❌ Delete
```

Result: Public installs fail gracefully, private apps continue working

---

## Next Steps

### Before App Store Submission

- [ ] Test with 5+ public installations
- [ ] Monitor for 1 week with no critical issues
- [ ] Prepare screenshots and description
- [ ] Review privacy policy
- [ ] Configure support email

### App Store Submission

1. Partner Dashboard → Apps → Distribution
2. Select "Public distribution" → "Shopify App Store"
3. Fill required information
4. Upload assets
5. Submit for review (3-5 days)

---

## Architecture Overview

### Public Installation Flow

```
Install → OAuth (public key) → Virtual credential → 
Auth success → Persist to DB (mode=PUBLIC) → 
Future requests use DB record
```

### Private Installation Flow

```
OAuth (client-specific key) → DB lookup → 
Use existing credential (mode=PRIVATE)
```

### Uninstallation

- **PUBLIC:** Deletes `ShopCredential` + sessions (clean slate)
- **PRIVATE:** Deletes sessions only (keeps credentials)

---

## Key Files Changed

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added `ShopCredentialMode` enum + `mode` field |
| `app/shopify.server.ts` | Public credential resolution + auto-persist |
| `app/services/shops.server.ts` | Mode field support |
| `app/routes/webhooks.app.uninstalled.tsx` | Enhanced uninstall logic |
| `prisma/migrations/.../migration.sql` | Database migration |

---

## Success Metrics

**Deployment Successful:**
- ✅ All 5 private clients working
- ✅ Public app installs in test store
- ✅ No errors in logs
- ✅ Migration applied

**Ready for App Store:**
- ✅ 10+ public installs tested
- ✅ Zero critical bugs for 7 days
- ✅ Performance stable
- ✅ Documentation complete

---

## Documentation

📖 **Full Guide:** `docs/PUBLIC-PRIVATE-APP-ARCHITECTURE.md`  
📝 **Deployment Details:** `docs/DEPLOYMENT-GUIDE.md`  
🔧 **Code Changes:** See implementation files

---

## Support

**Questions?** Check full documentation or deployment guide.

**Issues?** Review Vercel logs and troubleshooting section above.

---

**Status:** ✅ Production Ready  
**Last Updated:** November 20, 2024
