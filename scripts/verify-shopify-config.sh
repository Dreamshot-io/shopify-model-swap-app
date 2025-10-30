#!/bin/bash
# Verify current Shopify app configuration and environment
# Safe read-only operation - prepares for multi-client support

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "Verifying Shopify App Configuration"
echo "===================================="
echo ""

# Check if Shopify CLI is available
if ! command -v shopify &> /dev/null; then
  echo "ERROR: Shopify CLI not found. Install from: https://shopify.dev/docs/apps/tools/cli"
  exit 1
fi

# Get current config info
echo "Current Configuration:"
echo "----------------------"

if [ -f ".shopify/app.toml" ]; then
  ACTIVE_CONFIG=$(readlink -f .shopify/app.toml 2>/dev/null || cat .shopify/app.toml)
  CONFIG_BASENAME=$(basename "$ACTIVE_CONFIG")
  echo "  Active config: $CONFIG_BASENAME"

  # Extract client slug if matches pattern
  if [[ "$CONFIG_BASENAME" =~ shopify\.app\.(.+)\.toml ]]; then
    CLIENT_SLUG="${BASH_REMATCH[1]}"
    echo "  Client slug: $CLIENT_SLUG"
  fi
else
  echo "  WARNING: No active config detected"
fi

echo ""
echo "Shopify App Info:"
echo "-----------------"

# Run shopify app info (may fail if not linked, which is ok)
SHOPIFY_INFO=$(shopify app info 2>&1) || {
  echo "  WARNING: Config not linked to Partner Dashboard app"
  echo "  Run: shopify app config link"
  echo ""
  exit 0
}

echo "$SHOPIFY_INFO" | head -20

echo ""
echo "Environment Variables:"
echo "----------------------"

# Check for standard Shopify env vars
VARS_TO_CHECK=(
  "SHOPIFY_API_KEY"
  "SHOPIFY_API_SECRET"
  "SHOPIFY_APP_URL"
  "DATABASE_URL"
)

for var in "${VARS_TO_CHECK[@]}"; do
  if [ -n "${!var}" ]; then
    # Mask secrets
    if [[ "$var" == *"SECRET"* ]] || [[ "$var" == *"KEY"* ]]; then
      value_masked="${!var:0:4}...${!var: -4}"
      echo "  [OK] $var = $value_masked"
    else
      echo "  [OK] $var = ${!var}"
    fi
  else
    echo "  [MISSING] $var = NOT SET"
  fi
done

# Check for multi-client env vars if client slug detected
if [ -n "$CLIENT_SLUG" ]; then
  CLIENT_KEY=$(echo "$CLIENT_SLUG" | tr '[:lower:]' '[:upper:]' | tr '-' '_')
  CLIENT_ID_VAR="CLIENT_${CLIENT_KEY}_ID"
  CLIENT_SECRET_VAR="CLIENT_${CLIENT_KEY}_SECRET"

  echo ""
  echo "Client-Specific Variables (for $CLIENT_SLUG):"
  echo "---------------------------------------------"

  if [ -n "${!CLIENT_ID_VAR}" ]; then
    echo "  [OK] $CLIENT_ID_VAR = ${!CLIENT_ID_VAR:0:8}..."
  else
    echo "  [MISSING] $CLIENT_ID_VAR = NOT SET (required for multi-client)"
  fi

  if [ -n "${!CLIENT_SECRET_VAR}" ]; then
    echo "  [OK] $CLIENT_SECRET_VAR = ${!CLIENT_SECRET_VAR:0:4}...${!CLIENT_SECRET_VAR: -4}"
  else
    echo "  [MISSING] $CLIENT_SECRET_VAR = NOT SET (required for multi-client)"
  fi
fi

echo ""
echo "Verification complete"
