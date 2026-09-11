import { isValidBic, isValidPhoneNumber, normalizePhoneNumber } from './phone.util';

describe('phone.util', () => {
  it('normalizes common Tanzanian mobile formats', () => {
    expect(normalizePhoneNumber('0712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('+255712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('255712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('712345678')).toBe('255712345678');
    expect(normalizePhoneNumber('255 71 234 5678')).toBe('255712345678');
  });

  it('accepts 6XX numbers (Mixx by Yas / Halopesa ranges)', () => {
    expect(normalizePhoneNumber('0653123456')).toBe('255653123456');
    expect(isValidPhoneNumber('0668123456')).toBe(true);
  });

  it('rejects invalid numbers', () => {
    expect(normalizePhoneNumber('12345')).toBeNull();
    expect(normalizePhoneNumber('255812345678')).toBeNull();
    expect(normalizePhoneNumber('25571234567')).toBeNull();
    expect(isValidPhoneNumber('')).toBe(false);
  });

  it('validates BIC codes', () => {
    expect(isValidBic('ACTZTZTZ')).toBe(true);
    expect(isValidBic('ACTZTZTZXXX')).toBe(true);
    expect(isValidBic('NOPE')).toBe(false);
    expect(isValidBic('')).toBe(false);
  });
});
