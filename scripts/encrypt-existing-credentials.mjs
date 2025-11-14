#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted } from '../app/services/encryption.server.js';

const prisma = new PrismaClient();

async function main() {
	console.log('Encrypting existing credentials...\n');

	const credentials = await prisma['shopCredential'].findMany();

	if (credentials.length === 0) {
		console.log('No credentials found to encrypt.');
		return;
	}

	let encrypted = 0;
	let alreadyEncrypted = 0;
	let errors = 0;

	for (const cred of credentials) {
		try {
			if (isEncrypted(cred.apiSecret)) {
				console.log(`✓ ${cred.shopDomain} - already encrypted`);
				alreadyEncrypted++;
				continue;
			}

			await prisma['shopCredential'].update({
				where: { id: cred.id },
				data: { apiSecret: encrypt(cred.apiSecret) },
			});

			console.log(`✅ ${cred.shopDomain} - encrypted`);
			encrypted++;
		} catch (error) {
			console.error(`❌ ${cred.shopDomain} - error:`, error.message);
			errors++;
		}
	}

	console.log(`\n✅ Encrypted: ${encrypted}`);
	console.log(`✓ Already encrypted: ${alreadyEncrypted}`);
	if (errors > 0) {
		console.log(`❌ Errors: ${errors}`);
	}
}

main()
	.catch(error => {
		console.error('Fatal error:', error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
