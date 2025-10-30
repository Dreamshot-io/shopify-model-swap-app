# Client Registry

> **Status:** Template - Prepared for future implementation
>
> This registry tracks all multi-client Shopify app configurations.

## Current Clients

| Client Slug | Shop Domain | Partner App ID | Config File             | Status | Deployed   | Notes                                                                    |
| ----------- | ----------- | -------------- | ----------------------- | ------ | ---------- | ------------------------------------------------------------------------ |
| pummba      | TBD         | 292388569089   | shopify.app.pummba.toml | active | 2025-10-30 | Config linked, app deployed. Client ID: 21acdb3d10eb24f87b02129c68b89328 |

## Client Configuration Template

For each client, record:

- **Client Slug**: kebab-case identifier (e.g., `cliente-a`)
- **Shop Domain**: Full Shopify domain (e.g., `cliente-a.myshopify.com`)
- **Partner App ID**: From Partner Dashboard
- **Config File**: `shopify.app.<slug>.toml`
- **Status**: `active`, `pending`, `archived`
- **Deployed**: Last deployment timestamp
- **Notes**: Any client-specific configuration notes

## Environment Variables Convention

For each client `<SLUG>`, the following environment variables are required:

- `CLIENT_<SLUG>_ID` - Partner Dashboard client_id
- `CLIENT_<SLUG>_SECRET` - Partner Dashboard client_secret

Example:

- `CLIENTE_A_ID`
- `CLIENTE_A_SECRET`

## Adding a New Client

1. Add row to table above
2. Create `shopify.app.<slug>.toml` from template
3. Store credentials in environment
4. Follow onboarding guide: `docs/multi-client-onboarding.md`

## Related Documentation

- [Multi-Client Onboarding](./multi-client-onboarding.md)
- [Multi-Client Troubleshooting](./multi-client-troubleshooting.md)
- [PRD: Multi-Client Configuration](../prd/PRD-Multi-Client-Shopify-App-Configuration.md)
