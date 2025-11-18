import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getEncryptionKey(): Buffer {
	const key = process.env.ENCRYPTION_KEY;
	if (!key) {
		throw new Error(
			'ENCRYPTION_KEY environment variable is required. Generate with: openssl rand -base64 32',
		);
	}

	if (key.length < 32) {
		throw new Error('ENCRYPTION_KEY must be at least 32 characters long');
	}

	return crypto.scryptSync(key, 'shop-credentials-salt', KEY_LENGTH);
}

export function encrypt(text: string): string {
	if (!text) {
		return text;
	}

	const key = getEncryptionKey();
	const iv = crypto.randomBytes(IV_LENGTH);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

	let encrypted = cipher.update(text, 'utf8', 'hex');
	encrypted += cipher.final('hex');

	const tag = cipher.getAuthTag();

	return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
	if (!encryptedText) {
		return encryptedText;
	}

	try {
		const parts = encryptedText.split(':');
		if (parts.length !== 3) {
			throw new Error('Invalid encrypted format');
		}

		const [ivHex, tagHex, encrypted] = parts;
		const key = getEncryptionKey();
		const iv = Buffer.from(ivHex, 'hex');
		const tag = Buffer.from(tagHex, 'hex');

		const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
		decipher.setAuthTag(tag);

		let decrypted = decipher.update(encrypted, 'hex', 'utf8');
		decrypted += decipher.final('utf8');

		return decrypted;
	} catch (error) {
		throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
	}
}

export function isEncrypted(text: string): boolean {
	if (!text) {
		return false;
	}

	const parts = text.split(':');
	return parts.length === 3 && parts[0].length === IV_LENGTH * 2 && parts[1].length === TAG_LENGTH * 2;
}
