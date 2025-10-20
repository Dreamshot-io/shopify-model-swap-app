#!/bin/bash

# Load NGROK_DOMAIN from .env
if [ -f .env ]; then
  # Handle spaces around = and remove quotes
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ ]] || [[ -z "$line" ]] && continue
    # Only process NGROK_DOMAIN
    if [[ "$line" =~ NGROK_DOMAIN ]]; then
      # Remove spaces around = and quotes
      cleaned=$(echo "$line" | sed 's/ *= */=/g' | sed 's/"//g')
      export "$cleaned"
    fi
  done < .env
fi

if [ -z "$NGROK_DOMAIN" ]; then
  echo "Error: NGROK_DOMAIN not found in .env file"
  exit 1
fi

echo "Updating shopify.app.toml with domain: $NGROK_DOMAIN"

# Update shopify.app.toml using sed
# macOS requires -i '' for in-place editing
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' "s|application_url = \"https://.*\.ngrok-free\.app\"|application_url = \"https://$NGROK_DOMAIN\"|g" shopify.app.toml
  sed -i '' "s|url = \"https://.*\.ngrok-free\.app\"|url = \"https://$NGROK_DOMAIN\"|g" shopify.app.toml
  sed -i '' "s|https://.*\.ngrok-free\.app/auth|https://$NGROK_DOMAIN/auth|g" shopify.app.toml
else
  # Linux
  sed -i "s|application_url = \"https://.*\.ngrok-free\.app\"|application_url = \"https://$NGROK_DOMAIN\"|g" shopify.app.toml
  sed -i "s|url = \"https://.*\.ngrok-free\.app\"|url = \"https://$NGROK_DOMAIN\"|g" shopify.app.toml
  sed -i "s|https://.*\.ngrok-free\.app/auth|https://$NGROK_DOMAIN/auth|g" shopify.app.toml
fi

echo "✅ Updated shopify.app.toml successfully!"
echo "Don't forget to run: bun run deploy"
