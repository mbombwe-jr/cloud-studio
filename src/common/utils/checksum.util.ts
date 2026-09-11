import { createHmac } from 'crypto';

/**
 * ClickPesa checksum (https://docs.clickpesa.com/home/checksum):
 *  1. Recursively sort all object keys alphabetically at every nesting level.
 *  2. Serialize to compact JSON (no whitespace).
 *  3. HMAC-SHA256 with the checksum key.
 *  4. Return the hex digest (64 chars).
 *
 * `checksum` and `checksumMethod` fields MUST be excluded from computation.
 * The same scheme signs ClickPesa webhooks, so it is reused to verify
 * incoming webhook payloads.
 */
export function canonicalize(payload: unknown): unknown {
  if (payload === null || payload === undefined || typeof payload !== 'object') return payload ?? null;
  if (Array.isArray(payload)) return payload.map((item) => canonicalize(item));
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload as Record<string, unknown>).sort()) {
    if (key === 'checksum' || key === 'checksumMethod') continue;
    sorted[key] = canonicalize((payload as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function createPayloadChecksum(checksumKey: string, payload: unknown): string {
  const canonical = JSON.stringify(canonicalize(payload));
  return createHmac('sha256', checksumKey).update(canonical).digest('hex');
}

export function verifyPayloadChecksum(checksumKey: string, payload: Record<string, unknown>): boolean {
  const provided = (payload as { checksum?: string }).checksum;
  if (!provided) return false;
  const expected = createPayloadChecksum(checksumKey, payload);
  if (provided.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}
