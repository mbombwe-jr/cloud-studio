import { createHash, randomBytes } from 'crypto';

export const API_KEY_MIN_LENGTH = 32;
export const API_KEY_DISPLAY_PREFIX_LENGTH = 12;

/** Cryptographically strong URL-safe random string. */
export function createRandomId(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Generates a full API key:  "<prefix>_live_<64 hex chars>".
 * Always >= 32 characters (spec requirement).
 */
export function generateApiKey(prefix = 'zs'): { full: string; displayPrefix: string; hash: string } {
  const body = randomBytes(32).toString('hex'); // 64 chars
  const full = `${prefix}_live_${body}`;
  return {
    full,
    displayPrefix: full.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(full),
  };
}

/** SHA-256 of the raw key — only hashes are ever persisted. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function isValidApiKeyShape(rawKey: string): boolean {
  return typeof rawKey === 'string' && rawKey.length >= API_KEY_MIN_LENGTH;
}
