#!/bin/bash
# List all available Shopify app configuration files
# Safe read-only operation - prepares for multi-client support

# Don't exit on error - we want to show what we found even if some checks fail
set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Available Shopify App Configurations"
echo "===================================="
echo ""

cd "$PROJECT_ROOT" || exit 1

# Find all shopify.app.*.toml files
CONFIG_FILES=$(find . -maxdepth 1 -name "shopify.app.*.toml" -type f 2>/dev/null | sort)

if [ -z "$CONFIG_FILES" ]; then
  echo "WARNING: No client configuration files found"
  echo ""
  echo "Expected format: shopify.app.<client-slug>.toml"
  echo "Create from template: cp shopify.app.template.toml shopify.app.<slug>.toml"
  exit 0
fi

# Try to detect active config (check .shopify directory if it exists)
ACTIVE_CONFIG=""
if [ -d ".shopify" ] && [ -f ".shopify/app.toml" ]; then
  # Read the active config file path (macOS compatible)
  if command -v readlink >/dev/null 2>&1 && readlink -f .shopify/app.toml >/dev/null 2>&1; then
    ACTIVE_CONFIG=$(readlink -f .shopify/app.toml)
  elif [ -L ".shopify/app.toml" ]; then
    ACTIVE_CONFIG=$(readlink .shopify/app.toml)
  else
    ACTIVE_CONFIG=$(cd .shopify && pwd)/app.toml
  fi
fi

echo "Found configuration files:"
echo ""

for config_file in $CONFIG_FILES; do
  basename_file=$(basename "$config_file")

  # Extract client slug from filename
  slug=$(echo "$basename_file" | sed 's/shopify\.app\.\(.*\)\.toml/\1/')

  # Check if this is the active config (macOS compatible)
  config_path=""
  if command -v readlink >/dev/null 2>&1 && readlink -f "$config_file" >/dev/null 2>&1; then
    config_path=$(readlink -f "$config_file")
  else
    config_path=$(cd "$(dirname "$config_file")" && pwd)/$(basename "$config_file")
  fi

  if [ -n "$ACTIVE_CONFIG" ] && [ "$config_path" = "$ACTIVE_CONFIG" ]; then
    echo "  [ACTIVE] $basename_file (slug: $slug)"
  else
    echo "  $basename_file (slug: $slug)"
  fi
done

echo ""
echo "To switch configuration:"
echo "  shopify app config use shopify.app.<slug>.toml"
echo ""
echo "To verify current config:"
echo "  shopify app info"
