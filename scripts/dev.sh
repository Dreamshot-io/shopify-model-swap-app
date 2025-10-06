#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
  # Handle spaces around = and remove quotes
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] || [[ -z "$line" ]] && continue
    # Remove spaces around = and quotes
    cleaned=$(echo "$line" | sed 's/ *= */=/g' | sed 's/"//g')
    export "$cleaned"
  done < .env
fi

echo "🔍 Starting Shopify development server..."
echo "📝 Note: If prompted to login, this is a known Shopify CLI v3 issue"
echo "   See: https://github.com/Shopify/shopify-cli/issues/2385"
echo ""

# Run Shopify dev with tunnel URL
PORT=3000 shopify app dev --tunnel-url=https://$NGROK_DOMAIN:3000
