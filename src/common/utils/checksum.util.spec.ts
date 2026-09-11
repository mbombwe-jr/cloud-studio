import { createPayloadChecksum, canonicalize, verifyPayloadChecksum } from './checksum.util';
import { createHmac } from 'crypto';

describe('checksum.util (ClickPesa scheme)', () => {
  it('matches the documented algorithm: canonical JSON + HMAC-SHA256', () => {
    const key = 'checksum-secret';
    const payload = {
      amount: 100,
      currency: 'USD',
      reference: 'TX123',
      customer: { name: 'John Doe', email: 'john@example.com' },
    };
    const canonical = JSON.stringify(canonicalize(payload));
    const expected = createHmac('sha256', key).update(canonical).digest('hex');
    expect(createPayloadChecksum(key, payload)).toBe(expected);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is order-independent (recursively sorted keys)', () => {
    const key = 'k';
    const a = { b: 2, a: 1, nested: { y: 2, x: 1 } };
    const b = { a: 1, b: 2, nested: { x: 1, y: 2 } };
    expect(createPayloadChecksum(key, a)).toBe(createPayloadChecksum(key, b));
  });

  it('excludes checksum and checksumMethod fields from computation', () => {
    const key = 'k';
    const base = { amount: '1000', orderReference: 'X1' };
    const withChecksum = { ...base, checksum: 'abc', checksumMethod: 'HMAC_SHA256' };
    expect(createPayloadChecksum(key, base)).toBe(createPayloadChecksum(key, withChecksum));
  });

  it('verifies a checksummed webhook payload and detects tampering', () => {
    const key = 'webhook-secret';
    const payload = { event: 'PAYMENT RECEIVED', data: { orderReference: 'ORDER1', status: 'SUCCESS' } };
    const signed = { ...payload, checksum: createPayloadChecksum(key, payload) };
    expect(verifyPayloadChecksum(key, signed)).toBe(true);

    const tampered = { ...signed, data: { ...signed.data, status: 'FAILED' } };
    expect(verifyPayloadChecksum(key, tampered)).toBe(false);
  });
});
