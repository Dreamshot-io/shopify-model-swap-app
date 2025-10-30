#!/bin/bash
# Switch to a specific Shopify app configuration
# Safe operation - only switches active config, does not deploy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

if [ -z "$1" ]; then
  echo "Usage: $0 <client-slug>"
  echo ""
  echo "Example: $0 cliente-a"
  echo ""
  echo "Available configs:"
  ./scripts/list-shopify-configs.sh
  exit 1
fi

CLIENT_SLUG="$1"
CONFIG_FILE="shopify.app.${CLIENT_SLUG}.toml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: Configuration file not found: $CONFIG_FILE"
  echo ""
  echo "Available configs:"
  ./scripts/list-shopify-configs.sh
  exit 1
fi

echo "Switching to configuration: $CONFIG_FILE"
echo ""

# Check if Shopify CLI is available
if ! command -v shopify &> /dev/null; then
  echo "ERROR: Shopify CLI not found. Install from: https://shopify.dev/docs/apps/tools/cli"
  exit 1
fi

# Switch config
echo "Running: shopify app config use $CONFIG_FILE"
shopify app config use "$CONFIG_FILE"

echo ""
echo "Configuration switched successfully"
echo ""

# Show current info
echo "Current App Info:"
echo "-----------------"
shopify app info | head -15

echo ""
echo "Next steps:"
echo "  - Verify config: ./scripts/verify-shopify-config.sh"
echo "  - Deploy: shopify app deploy"
