/**
 * Client Credential Mapping Template
 *
 * This file maps shop domains to client identifiers for multi-client support.
 * When implementing multi-client functionality, populate this map with actual
 * client configurations. Keep this file version-controlled; secrets remain
 * in environment variables.
 *
 * Usage:
 *   - Map shop domain → clientKey (for env var lookup)
 *   - Each client requires CLIENT_<KEY>_ID and CLIENT_<KEY>_SECRET env vars
 *   - clientKey should match the suffix used in shopify.app.<slug>.toml files
 */

export interface ClientConfig {
	/** Prefix for environment variable lookup (e.g., "CLIENTE_A" → CLIENTE_A_ID) */
	clientKey: string;
	/** Display name for the client app */
	appName: string;
}

/**
 * Map shop domains to client configurations
 *
 * Example:
 *   "cliente-a.myshopify.com" → { clientKey: "CLIENTE_A", appName: "Cliente A Model Swap" }
 */
export const clientCredentialMap: Record<string, ClientConfig> = {
	// Add client mappings here when implementing multi-client support
	// Example (do not commit with real values):
	// 'cliente-a.myshopify.com': {
	//   clientKey: 'CLIENTE_A',
	//   appName: 'Cliente A Model Swap',
	// },
	//
	// TODO: Add Pummba client when shop domain is known:
	// 'pummba.myshopify.com': {
	//   clientKey: 'CLIENT_PUMMBA',
	//   appName: 'Pummba Model Swap',
	// },
};

/**
 * Get client configuration for a shop domain
 *
 * @param shopDomain - Full shop domain (e.g., "cliente-a.myshopify.com")
 * @returns ClientConfig if found, undefined otherwise
 */
export function getClientConfig(shopDomain: string): ClientConfig | undefined {
	return clientCredentialMap[shopDomain];
}

/**
 * Get environment variable name for client ID
 *
 * @param clientKey - Client key from config (e.g., "CLIENTE_A")
 * @returns Environment variable name (e.g., "CLIENTE_A_ID")
 */
export function getClientIdEnvVar(clientKey: string): string {
	return `${clientKey}_ID`;
}

/**
 * Get environment variable name for client secret
 *
 * @param clientKey - Client key from config (e.g., "CLIENTE_A")
 * @returns Environment variable name (e.g., "CLIENTE_A_SECRET")
 */
export function getClientSecretEnvVar(clientKey: string): string {
	return `${clientKey}_SECRET`;
}

/**
 * Validate that required environment variables exist for all configured clients
 *
 * @returns Array of missing env var names, empty if all present
 */
export function validateClientCredentials(): string[] {
	const missing: string[] = [];

	for (const [shopDomain, config] of Object.entries(clientCredentialMap)) {
		const idVar = getClientIdEnvVar(config.clientKey);
		const secretVar = getClientSecretEnvVar(config.clientKey);

		if (!process.env[idVar]) {
			missing.push(`${idVar} (for ${shopDomain})`);
		}
		if (!process.env[secretVar]) {
			missing.push(`${secretVar} (for ${shopDomain})`);
		}
	}

	return missing;
}
