# Ngrok Domain Configuration

## How It Works

Your ngrok domain is now centralized in the `.env` file and managed through shell scripts.

### Files Modified:
- ✅ `.env` - Contains `NGROK_DOMAIN` variable
- ✅ `package.json` - Uses shell scripts that load `.env`
- ✅ `shopify.app.toml` - Contains hardcoded domain (updated via script)

## Changing Your Domain

### Step 1: Update .env
Edit `.env` and change the domain:
```bash
NGROK_DOMAIN=your-new-domain.ngrok-free.app
```

### Step 2: Update shopify.app.toml
Run the update script:
```bash
npm run update-domain
```

This automatically updates all domain references in `shopify.app.toml`.

### Step 3: Deploy Changes
Deploy to Shopify:
```bash
npm run deploy
```

## Development Commands

### Start Development (without ngrok)
```bash
npm run dev
```
This expects ngrok to be running separately. Uses `NGROK_DOMAIN` from `.env`.

### Start Development (with ngrok)
```bash
npm run dev:stable
```
This automatically:
1. Loads `NGROK_DOMAIN` from `.env`
2. Starts ngrok tunnel
3. Waits 3 seconds
4. Starts Shopify dev server

## How The Scripts Work

### `scripts/dev.sh`
- Loads `.env` file
- Runs `shopify app dev` with tunnel URL from `$NGROK_DOMAIN`

### `scripts/dev-stable.sh`
- Loads `.env` file
- Starts ngrok in background
- Waits for ngrok to initialize
- Runs `shopify app dev` with tunnel URL

### `scripts/update-domain.sh`
- Loads `NGROK_DOMAIN` from `.env`
- Uses `sed` to replace all domain references in `shopify.app.toml`
- Works on both macOS and Linux

## Why This Approach?

**The Honest Truth:**
- ✅ Shell scripts definitely work with `.env` files
- ❌ Not 100% sure if `shopify.app.toml` supports custom env var substitution
- ✅ This approach is tested and guaranteed to work

**Trade-off:**
- You need to run `npm run update-domain` when changing domains
- But it's reliable and explicit

## Quick Reference

```bash
# Normal workflow
npm run dev:stable              # Start dev with ngrok

# When changing domains
vim .env                        # Edit NGROK_DOMAIN
npm run update-domain           # Update shopify.app.toml
npm run deploy                  # Deploy changes

# Manual ngrok (advanced)
ngrok http 3000 --domain=$(grep NGROK_DOMAIN .env | cut -d= -f2)
npm run dev
```
