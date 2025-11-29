#!/bin/bash

# Load shared environment variables from .env
if [ -f .env ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] || [[ -z "$line" ]] && continue
    cleaned=$(echo "$line" | sed 's/ *= */=/g' | sed 's/"//g')
    export "$cleaned"
  done < .env
fi

# Load personal overrides from .env.local (gitignored)
if [ -f .env.local ]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] || [[ -z "$line" ]] && continue
    cleaned=$(echo "$line" | sed 's/ *= */=/g' | sed 's/"//g')
    export "$cleaned"
  done < .env.local
fi

echo "🔍 Starting Shopify development server..."
echo "📝 Using tunnel: https://$NGROK_DOMAIN"
echo ""

PORT=3000 shopify app dev --config shopify.app.dev.toml --tunnel-url=https://$NGROK_DOMAIN:3000
