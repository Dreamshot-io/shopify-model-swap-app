# Database Setup & Management Tutorial

This guide explains how to configure, manage, and troubleshoot your Shopify app's database using Prisma ORM with SQLite.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Database Configuration](#database-configuration)
3. [Setup Commands](#setup-commands)
4. [Schema Management](#schema-management)
5. [Data Migration](#data-migration)
6. [Troubleshooting](#troubleshooting)
7. [Production Considerations](#production-considerations)

---

## 🔧 Overview

Your Shopify Model Swap app uses:
- **Prisma ORM** - Database toolkit and query builder
- **SQLite** - Local development database (file-based)
- **Schema-first approach** - Database structure defined in `prisma/schema.prisma`

### Current Database Location
```
/Users/javierjrueda/dev/shopify-model-swap-app/prisma/dev.sqlite
```

---

## ⚙️ Database Configuration

### 1. Schema File Structure
Your database schema is defined in `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:dev.sqlite"
}

generator client {
  provider = "prisma-client-js"
}
```

### 2. Database Models
Your app includes these models:
- **Session** - Shopify authentication sessions
- **MetricEvent** - Analytics tracking (image generation, publishing, etc.)
- **ABTest** - A/B test configurations
- **ABTestVariant** - Test image variants (A/B)
- **ABTestEvent** - User interaction tracking (impressions, conversions)

---

## 🚀 Setup Commands

### Essential Commands (Run in Order)

#### 1. Install Dependencies
```bash
npm install
```

#### 2. Generate Prisma Client
```bash
npx prisma generate
```
*Creates the TypeScript client for database access*

#### 3. Apply Schema to Database
```bash
npx prisma db push
```
*Creates/updates database structure without migrations*

#### 4. (Optional) View Data in Browser
```bash
npx prisma studio
```
*Opens web interface at http://localhost:5555*

### Quick Setup Script
```bash
# Complete setup from scratch
npm install && npx prisma generate && npx prisma db push
```

---

## 📝 Schema Management

### Making Schema Changes

1. **Edit Schema** - Modify `prisma/schema.prisma`
2. **Regenerate Client** - Run `npx prisma generate`
3. **Apply Changes** - Run `npx prisma db push`

### Example: Adding a New Field
```prisma
model ABTest {
  id            String        @id @default(cuid())
  shop          String
  productId     String
  name          String
  status        ABTestStatus  @default(DRAFT)
  trafficSplit  Int           @default(50)
  startDate     DateTime?
  endDate       DateTime?
  // New field example:
  description   String?       // Added description field
  variants      ABTestVariant[]
  events        ABTestEvent[]
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

After changing schema:
```bash
npx prisma generate && npx prisma db push
```

---

## 🔄 Data Migration

### Development vs Production

**Development (SQLite):**
- Use `npx prisma db push` for quick schema updates
- No migration history needed
- Safe to reset data

**Production (PostgreSQL/MySQL):**
- Use `npx prisma migrate dev` for versioned migrations
- Maintains migration history
- Data preservation is critical

### Creating Migrations (Production)
```bash
# Create and apply migration
npx prisma migrate dev --name add_description_field

# Apply existing migrations to database
npx prisma migrate deploy
```

### Reset Development Database
```bash
# WARNING: Deletes all data
npx prisma db push --force-reset
```

---

## 🚨 Troubleshooting

### Common Issues & Solutions

#### Issue: "Database connection error"
```bash
# Check if database file exists
ls -la prisma/dev.sqlite

# If missing, recreate it
npx prisma db push
```

#### Issue: "Schema validation failed"
```bash
# Check schema syntax
npx prisma validate

# Common fixes:
# 1. Check enum definitions are before models
# 2. Verify @default values use enum names, not strings
# 3. Ensure all relations are properly defined
```

#### Issue: "Prisma Client is not available"
```bash
# Regenerate client
npx prisma generate

# If still failing, check node_modules
rm -rf node_modules/.prisma
npm install
npx prisma generate
```

#### Issue: "Type errors in TypeScript"
```bash
# After schema changes, always regenerate
npx prisma generate

# Then restart TypeScript server in VS Code:
# Cmd+Shift+P -> "TypeScript: Restart TS Server"
```

---

## 📊 Database Inspection

### Check Database Contents
```bash
# Option 1: Prisma Studio (GUI)
npx prisma studio

# Option 2: SQLite CLI
sqlite3 prisma/dev.sqlite
.tables
SELECT * FROM ABTest;
.exit
```

### Backup Database
```bash
# Create backup
cp prisma/dev.sqlite prisma/dev.sqlite.backup

# Restore from backup
cp prisma/dev.sqlite.backup prisma/dev.sqlite
```

---

## 🌐 Production Considerations

### Switching to PostgreSQL/MySQL

1. **Update Schema**:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

2. **Set Environment Variable**:
```bash
DATABASE_URL="postgresql://username:password@localhost:5432/mydb"
```

3. **Create Migration**:
```bash
npma prisma migrate dev --name init
```

### Environment Variables
Create `.env` file:
```env
# Development
DATABASE_URL="file:dev.sqlite"

# Production (example)
DATABASE_URL="postgresql://user:pass@host:5432/db"
```

---

## 🔍 Health Check Script

Create `scripts/db-health.js`:
```javascript
const { PrismaClient } = require('@prisma/client');

async function healthCheck() {
  const prisma = new PrismaClient();
  
  try {
    // Test connection
    await prisma.$connect();
    console.log('✅ Database connected');
    
    // Count records
    const sessionCount = await prisma.session.count();
    const testCount = await prisma.aBTest.count();
    
    console.log(`📊 Sessions: ${sessionCount}`);
    console.log(`🧪 A/B Tests: ${testCount}`);
    
    console.log('✅ Database health check passed');
  } catch (error) {
    console.error('❌ Database health check failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

healthCheck();
```

Run with: `node scripts/db-health.js`

---

## 📚 Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs/)
- [SQLite Documentation](https://sqlite.org/docs.html)
- [Shopify App Development](https://shopify.dev/docs/apps)

---

## 🆘 Getting Help

If you encounter issues:

1. **Check logs** - Look for error messages in terminal
2. **Validate schema** - Run `npx prisma validate`
3. **Regenerate client** - Run `npx prisma generate`
4. **Reset if needed** - Run `npx prisma db push --force-reset`
5. **Check this guide** - Most common issues are covered above

Remember: SQLite development database can be safely reset, but always backup production data before making changes!