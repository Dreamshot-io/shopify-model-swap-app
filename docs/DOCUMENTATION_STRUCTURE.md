# Documentation Structure

## Root Folder
Only these 3 files should remain in root:
- `README.md` - Project overview
- `CLAUDE.md` - Development guide
- `AGENTS.md` - Quick reference

## Folder Organization

### `prd/` - Product Requirements Documents
Formal PRDs for features:
- `PRD-AB-Testing-Implementation-v2.md`
- `PRD-Multi-Client-Shopify-App-Configuration.md`
- `VERCEL-MIGRATION-PLAN.md`
- `E2E-CHECKLIST-POSTGRES.md`

### `PRPs/` - Product Requirements Plans
Initial planning documents:
- `INITIAL.md`
- `ai_docs/ab_test_mvp.md`

### `docs/` - Project Context Documentation
Permanent technical documentation:
- `AGENT_KNOWLEDGE_BASE.md` (moved from root)
- All other permanent technical docs
- `config/` - Configuration references
  - `VERCEL-ENV.md`
  - `DEV-DB-POSTGRES.md`

### `working-docs/` - Temporary Status Documents
Implementation notes, status reports, debug logs:
- All `*_STATUS.md` files
- All `*_SUMMARY.md` files
- All `*_PROGRESS.md` files
- All `*_REPORT.md` files
- Bug fix notes
- Implementation comparisons

## Files That Need Moving

**From root to `working-docs/`:**
- `ABTEST_REQUIREMENTS.md`
- `CHANGES_SUMMARY.md`
- `FINAL_STATUS.md`
- `IMPLEMENTATION_COMPARISON.md`
- `IMPRESSION_TRACKING_DEBUG_REPORT.md`
- `INSTALLATION_FLOW.md`
- `MIGRATION_STATUS.md`
- `REBUILD_COMPLETE_SUMMARY.md`
- `test-tracking-flow.md`
- `TODAYS_FEATURES_SUMMARY.md`
- `VARIANT_IMPLEMENTATION_COMPLETE.md`
- `VARIANT_IMPLEMENTATION_PROGRESS.md`
- `VARIANT_UI_IMPLEMENTATION_REMAINING.md`
- `VERCEL_DEPLOYMENT.md`

**From root to `docs/`:**
- `AGENT_KNOWLEDGE_BASE.md`
- `DOCUMENTATION_ORGANIZATION.md`
- `ORGANIZE_DOCS.md`

**From `docs/` to `working-docs/`:**
- `ab-test-blank-page-fix.md`
- `ab-test-selection-order.md`
- `ab-test-tracking-diagnosis.md`
- `fix-ab-test-reload-issue.md`
- `legacy-cleanup-summary.md`
- `PIXEL-INSTALLATION-FIX.md`
- `TEST_REPORT.md`
- `variant-implementation-summary.md`

**From `prd/` to `docs/config/`:**
- `VERCEL-ENV.md`
- `DEV-DB-POSTGRES.md` (if exists)
