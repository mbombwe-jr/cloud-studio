import { createRandomId } from './api-key.util';

/**
 * Reference scheme (per Zoostudios spec):
 *
 *   <sourceCode:5><clientPart:15>  =  20 characters total
 *
 * - sourceCode: unique 5-character code generated per account; the SAME code
 *   is prepended to every request the account makes ("xxxxx is repeated
 *   throughout the account's requests").
 * - clientPart: up to 15 characters taken from the client's request. When the
 *   client reference is shorter than 15 characters it is right-padded with
 *   random alphanumeric characters; when absent it is fully random.
 */
const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const SOURCE_CODE_LENGTH = 5;
export const CLIENT_REF_LENGTH = 15;
export const REFERENCE_LENGTH = SOURCE_CODE_LENGTH + CLIENT_REF_LENGTH; // 20

export function generateSourceCode(existing: Set<string> = new Set()): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < SOURCE_CODE_LENGTH; i++) {
      code += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
    }
    if (!existing.has(code)) return code;
  }
  throw new Error('Unable to generate a unique source code');
}

/** Sanitizes a client reference: alphanumeric only, at most 15 chars. */
export function sanitizeClientReference(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim().toUpperCase();
  if (trimmed.length === 0) return null;
  if (!/^[A-Z0-9]{1,15}$/.test(trimmed)) {
    throw new Error('INVALID_CLIENT_REFERENCE');
  }
  return trimmed;
}

function randomChars(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHANUMERIC[Math.floor(Math.random() * ALPHANUMERIC.length)];
  return out;
}

/**
 * Builds the final 20-character internal reference.
 * Throws Error('INVALID_CLIENT_REFERENCE') when the client part is unusable.
 */
export function buildReference(sourceCode: string, clientReference?: string | null): string {
  if (!sourceCode || sourceCode.length !== SOURCE_CODE_LENGTH) {
    throw new Error('INVALID_SOURCE_CODE');
  }
  const client = sanitizeClientReference(clientReference);
  const padded = client ? client + randomChars(CLIENT_REF_LENGTH - client.length) : randomChars(CLIENT_REF_LENGTH);
  const reference = `${sourceCode}${padded}`;
  if (reference.length !== REFERENCE_LENGTH) throw new Error('INVALID_REFERENCE_LENGTH');
  return reference;
}

/** Adds unique-jitter so batch item references never collide. */
export function buildUniqueReference(sourceCode: string, clientReference?: string | null): string {
  return buildReference(sourceCode, clientReference ?? createRandomId(15));
}
