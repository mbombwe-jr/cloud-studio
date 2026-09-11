import { buildReference, generateSourceCode, sanitizeClientReference, REFERENCE_LENGTH, SOURCE_CODE_LENGTH, CLIENT_REF_LENGTH } from './reference.util';

describe('reference.util', () => {
  it('generates 5-char alphanumeric source codes', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSourceCode();
      expect(code).toHaveLength(SOURCE_CODE_LENGTH);
      expect(code).toMatch(/^[A-Z0-9]{5}$/);
    }
  });

  it('avoids collisions with existing source codes', () => {
    const existing = new Set<string>();
    let second = '';
    for (let i = 0; i < 1000; i++) {
      const code = generateSourceCode(existing);
      expect(existing.has(code)).toBe(false);
      if (i === 0) existing.add(code);
      second = code;
    }
    expect(second).not.toBe([...existing][0]);
  });

  it('builds a 20-char reference: 5-char source + 15-char client part', () => {
    const ref = buildReference('ABC12');
    expect(ref).toHaveLength(REFERENCE_LENGTH);
    expect(ref.startsWith('ABC12')).toBe(true);
    expect(ref).toMatch(/^[A-Z0-9]{20}$/);
  });

  it('keeps the client reference and pads it to 15 chars', () => {
    const ref = buildReference('ZZ9ZZ', 'poiuytrewq');
    expect(ref.startsWith('ZZ9ZZPOIUYTREWQ')).toBe(true);
    expect(ref).toHaveLength(REFERENCE_LENGTH);
  });

  it('accepts a full 15-char client reference untouched', () => {
    const ref = buildReference('ZZ9ZZ', 'ABCDEFGHIJKLMNO');
    expect(ref).toBe('ZZ9ZZABCDEFGHIJKLMNO');
  });

  it('is deterministic in its source prefix for the same account', () => {
    const a = buildReference('SAME1', 'ref1');
    const b = buildReference('SAME1', 'ref2');
    expect(a.slice(0, 5)).toBe('SAME1');
    expect(b.slice(0, 5)).toBe('SAME1');
  });

  it('rejects client references longer than 15 chars', () => {
    expect(() => buildReference('ABC12', 'ABCDEFGHIJJKLMNO1')).toThrow('INVALID_CLIENT_REFERENCE');
  });

  it('rejects non-alphanumeric client references', () => {
    expect(() => buildReference('ABC12', 'hello-world!')).toThrow('INVALID_CLIENT_REFERENCE');
  });

  it('sanitizes and uppercases client references', () => {
    expect(sanitizeClientReference(' ab12 ')).toBe('AB12');
    expect(sanitizeClientReference(null)).toBeNull();
    expect(sanitizeClientReference('')).toBeNull();
  });
});
