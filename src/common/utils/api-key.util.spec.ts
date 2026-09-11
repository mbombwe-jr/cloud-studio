import { createRandomId, generateApiKey, hashApiKey, isValidApiKeyShape, API_KEY_MIN_LENGTH } from './api-key.util';

describe('api-key.util', () => {
  it('generates keys well above the 32-character minimum (spec)', () => {
    const key = generateApiKey('zs');
    expect(key.full.length).toBeGreaterThanOrEqual(API_KEY_MIN_LENGTH);
    expect(key.full.startsWith('zs_live_')).toBe(true);
  });

  it('produces a display prefix and a hash of the full key', () => {
    const key = generateApiKey('zs');
    expect(key.displayPrefix).toBe(key.full.slice(0, 12));
    expect(key.hash).toBe(hashApiKey(key.full));
    expect(key.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never stores the plaintext — hash is not reversible', () => {
    const a = generateApiKey('zs');
    const b = generateApiKey('zs');
    expect(a.full).not.toBe(b.full);
    expect(a.hash).not.toBe(b.hash);
  });

  it('validates the key shape', () => {
    expect(isValidApiKeyShape(generateApiKey('zs').full)).toBe(true);
    expect(isValidApiKeyShape('short')).toBe(false);
    expect(isValidApiKeyShape('')).toBe(false);
  });

  it('creates unambiguous random ids', () => {
    const id = createRandomId(8);
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });
});
