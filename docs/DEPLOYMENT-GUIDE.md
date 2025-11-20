# Deployment Guide: Public + Private App Architecture

**Quick Reference for Deploying Multi-Mode Shopify App**

---

## Pre-Deployment Checklist

- [x] ✅ All tests pass (143/143)
- [x] ✅ Build succeeds
- [x] ✅ Database migration created
- [x] ✅ Documentation complete
- [ ] 🔲 Environment variables configured
- [ ] 🔲 Production deployment complete
- [ ] 🔲 Private apps verified
- [ ] 🔲 Public app tested

---

## Step 1: Configure Environment Variables

### Vercel Dashboard

Navigate to: **Project Settings → Environment Variables**

Add the following variables for **Production** environment:

```bash
SHOPIFY_PUBLIC_API_KEY=<get_from_shopify_app_toml>
SHOPIFY_PUBLIC_API_SECRET=<get_from_partner_dashboard>
```

**Where to find these values:**

1. **SHOPIFY_PUBLIC_API_KEY**: 
   - Open `shopify.app.toml`
   - Copy the value of `client_id`

2. **SHOPIFY_PUBLIC_API_SECRET**:
   - Go to [Shopify Partner Dashboard](https://partners.shopify.com/)
   - Navigate to: Apps → Your App → API credentials
   - Copy "API secret key"

### Verification

After adding, your environment should have:
- ✅ `SHOPIFY_PUBLIC_API_KEY` (public app client ID)
- ✅ `SHOPIFY_PUBLIC_API_SECRET` (public app secret)
- ✅ `SHOPIFY_APP_URL` (already exists: `https://shopify.dreamshot.io`)
- ✅ `SCOPES` (already exists)
- ✅ `DATABASE_URL` (already exists)
- ✅ All other existing env vars

---

## Step 2: Deploy to Production

### Option A: Automatic Deployment (Recommended)

```bash
# Commit changes
git add .
git commit -m "feat: add public + private app architecture support"

# Push to main branch (triggers Vercel deployment)
git push origin main
```

### Option B: Manual Deployment

```bash
# Deploy via Vercel CLI
vercel --prod
```

### What Happens During Deployment

1. ✅ Vercel builds the app
2. ✅ Prisma generates client with new schema
3. ✅ Migration runs automatically: `bun run prisma migrate deploy`
4. ✅ Existing private apps continue working
5. ✅ Public app becomes available

---

## Step 3: Verify Deployment

### 3.1 Check Deployment Logs

In Vercel Dashboard → Deployments → Latest Deployment:

**Look for:**
```
✓ Prisma generated
✓ 5 migrations found
✓ No pending migrations to apply
✓ Build succeeded
```

### 3.2 Verify Database Migration

Connect to production database and run:

```sql
-- Check migration applied
SELECT * FROM "_prisma_migrations" 
ORDER BY finished_at DESC 
LIMIT 1;

-- Expected: 20251120135704_add_shop_credential_mode

-- Check existing credentials marked as PRIVATE
SELECT id, "shopDomain", mode, status 
FROM "ShopCredential";

-- Expected: All 5 existing shops have mode = 'PRIVATE'
```

### 3.3 Test Existing Private Apps

**For each of the 5 existing clients:**

1. Open their Shopify Admin
2. Navigate to Apps → Dreamshot Model Swap
3. Verify app loads successfully
4. Test core functionality:
   - [ ] A/B tests page loads
   - [ ] Can view existing tests
   - [ ] AI Studio loads
   - [ ] Can generate images

**Check logs for:**
```
[shopify.server] Resolving credentials for shop: <client>.myshopify.com
✓ Found credential in database (mode: PRIVATE)
```

---

## Step 4: Test Public App Installation

### 4.1 Install in Development Store

**Installation URL:**
```
https://admin.shopify.com/store/<your-dev-store>/oauth/install?client_id=<SHOPIFY_PUBLIC_API_KEY>
```

Replace:
- `<your-dev-store>` with your development store subdomain
- `<SHOPIFY_PUBLIC_API_KEY>` with the actual public API key

### 4.2 Verify Installation Flow

**Expected behavior:**

1. OAuth authorization screen appears
2. Click "Install app"
3. App loads successfully
4. Check Vercel logs for:

```
[shopify.server] Registering new public installation: <dev-store>.myshopify.com
```

### 4.3 Verify Database Record

```sql
SELECT * FROM "ShopCredential" 
WHERE shopDomain = '<dev-store>.myshopify.com';

-- Expected result:
-- mode: PUBLIC
-- apiKey: <SHOPIFY_PUBLIC_API_KEY>
-- status: ACTIVE
```

### 4.4 Test Public App Functionality

- [ ] Dashboard loads
- [ ] Can create new A/B test
- [ ] Can generate AI images
- [ ] Can view statistics
- [ ] Pixel tracking works

### 4.5 Test Uninstallation

1. Uninstall app from Shopify Admin
2. Check Vercel logs for:

```
[webhook] app/uninstalled for <dev-store>.myshopify.com
[webhook] Removing public installation: <dev-store>.myshopify.com
```

3. Verify database cleanup:

```sql
SELECT * FROM "ShopCredential" 
WHERE shopDomain = '<dev-store>.myshopify.com';

-- Expected: No records (deleted)

SELECT * FROM "Session" 
WHERE shop = '<dev-store>.myshopify.com';

-- Expected: No records (deleted)
```

---

## Step 5: Monitor Production

### Key Metrics to Watch

**1. Installation Success Rate**

```sql
-- Public installations
SELECT COUNT(*) as public_installs 
FROM "ShopCredential" 
WHERE mode = 'PUBLIC';

-- Private installations (should remain 5)
SELECT COUNT(*) as private_installs 
FROM "ShopCredential" 
WHERE mode = 'PRIVATE';
```

**2. Active Sessions by Mode**

```sql
SELECT sc.mode, COUNT(s.id) as session_count
FROM "Session" s
JOIN "ShopCredential" sc ON s.shopId = sc.id
GROUP BY sc.mode;
```

**3. Error Monitoring**

Watch Vercel logs for:
- ❌ `Unable to resolve shop context` (should not appear)
- ❌ `Shop credential not found` (investigate if frequent)
- ✅ `Registering new public installation` (good sign)

### Health Checks

**Daily:**
- [ ] Check that all 5 private clients are active
- [ ] Monitor new public installations
- [ ] Review error logs

**Weekly:**
- [ ] Review installation/uninstallation rate
- [ ] Check database for orphaned sessions
- [ ] Verify webhook delivery success

---

## Rollback Plan

If issues arise with public installations:

### Emergency Rollback

**Option 1: Disable Public App (Quick)**

Remove environment variables in Vercel:
- Delete `SHOPIFY_PUBLIC_API_KEY`
- Delete `SHOPIFY_PUBLIC_API_SECRET`

Result: Public installations will fail, private apps continue working

**Option 2: Full Rollback (Complete)**

```bash
# Revert to previous deployment
vercel rollback <previous-deployment-url>

# Or revert git commit
git revert HEAD
git push origin main
```

**Option 3: Database-Only Rollback**

```sql
-- Mark all public installations as disabled
UPDATE "ShopCredential" 
SET status = 'DISABLED' 
WHERE mode = 'PUBLIC';

-- Delete test public installations if needed
DELETE FROM "ShopCredential" 
WHERE mode = 'PUBLIC' 
AND shopDomain LIKE '%test%';
```

---

## Post-Deployment Tasks

### Immediate (Day 1)

- [ ] Verify all 5 private clients working
- [ ] Test public installation in dev store
- [ ] Monitor error rates
- [ ] Document any issues

### Week 1

- [ ] Install in 2-3 real test stores
- [ ] Monitor performance metrics
- [ ] Gather user feedback
- [ ] Fix any bugs discovered

### Week 2-4

- [ ] Prepare App Store listing
  - [ ] Create screenshots
  - [ ] Write description
  - [ ] Record demo video
- [ ] Submit for review
- [ ] Monitor review feedback

---

## App Store Submission Checklist

### Before Submission

- [ ] Public app tested thoroughly
- [ ] Documentation updated
- [ ] Privacy policy reviewed
- [ ] Terms of service reviewed
- [ ] Support email configured
- [ ] Pricing plan configured (if applicable)

### Required Assets

**Screenshots (5-8 required):**
- [ ] Dashboard view
- [ ] A/B test creation
- [ ] AI Studio interface
- [ ] Statistics view
- [ ] Mobile view (if applicable)

**App Description:**
- [ ] Clear value proposition
- [ ] Feature list
- [ ] Use cases
- [ ] Pricing information
- [ ] Support contact

**Compliance:**
- [ ] GDPR compliance documented
- [ ] Data handling disclosed
- [ ] API usage within limits
- [ ] Webhook subscriptions listed

### Submission Process

1. Go to [Shopify Partner Dashboard](https://partners.shopify.com/)
2. Navigate to: Apps → Your App → Distribution
3. Select: Public distribution → Shopify App Store
4. Fill required information
5. Upload assets
6. Submit for review

**Typical Review Time:** 3-5 business days

---

## Troubleshooting

### Issue: Private app returns 404

**Diagnosis:**
```sql
SELECT * FROM "ShopCredential" 
WHERE shopDomain = '<client>.myshopify.com';
```

**Fix:**
- If `mode = 'PUBLIC'`: Update to `PRIVATE`
- If missing: Restore from backup

### Issue: Public installation fails

**Check:**
1. Environment variables set correctly
2. `SHOPIFY_PUBLIC_API_KEY` matches `shopify.app.toml`
3. Vercel logs for specific error

**Common causes:**
- Invalid client_id
- Incorrect secret
- Missing scopes

### Issue: Duplicate credentials

**Diagnosis:**
```sql
SELECT shopDomain, COUNT(*) 
FROM "ShopCredential" 
GROUP BY shopDomain 
HAVING COUNT(*) > 1;
```

**Fix:**
```sql
-- Keep oldest, delete duplicates
DELETE FROM "ShopCredential" 
WHERE id NOT IN (
  SELECT MIN(id) FROM "ShopCredential" GROUP BY shopDomain
);
```

---

## Success Criteria

### Deployment Successful When:

- ✅ All 5 private clients working normally
- ✅ Public app installs successfully in test store
- ✅ Database shows correct `mode` for all shops
- ✅ No critical errors in logs
- ✅ Webhooks processing correctly
- ✅ Build and migration completed

### Ready for App Store When:

- ✅ 10+ successful public installations
- ✅ Zero critical bugs in last 7 days
- ✅ Performance metrics stable
- ✅ User feedback positive
- ✅ All documentation complete
- ✅ Support system ready

---

## Support

### Internal Team

- **Technical Issues:** Check Vercel logs first
- **Database Queries:** Use production read replica
- **Rollback Decision:** Requires team lead approval

### External (Customers)

- **Private Clients:** Direct support channel (existing)
- **Public Users:** Support email from App Store listing
- **General Questions:** Documentation links

---

## Appendix: Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SHOPIFY_PUBLIC_API_KEY` | Yes | Public app client ID | `abc123...` |
| `SHOPIFY_PUBLIC_API_SECRET` | Yes | Public app secret | `shpss_xyz...` |
| `SHOPIFY_APP_URL` | Yes | App URL | `https://shopify.dreamshot.io` |
| `SCOPES` | Yes | OAuth scopes | `read_orders,write_files,...` |
| `DATABASE_URL` | Yes | PostgreSQL connection | `postgresql://...` |
| `DIRECT_URL` | Yes | Direct DB connection | `postgresql://...` |

---

## Quick Command Reference

```bash
# Local development
bun run dev

# Run tests
bun run test

# Build for production
bun run build

# Database migration
bun run prisma migrate deploy

# View database
bun run prisma studio

# Check deployment status
vercel list

# View logs
vercel logs --prod

# Rollback
vercel rollback <deployment-url>
```

---

**Last Updated:** November 20, 2024  
**Status:** ✅ Ready for Production Deployment
