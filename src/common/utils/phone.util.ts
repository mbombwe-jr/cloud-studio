/**
 * Tanzanian mobile numbers used by mobile money rails:
 *  - accepted input: 0712345678, +255712345678, 255712345678, 712345678
 *  - canonical output: 255712345678 (no plus sign)
 */
export function normalizePhoneNumber(raw: string): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, '');
  if (digits.startsWith('255')) {
    // ok
  } else if (digits.startsWith('0')) {
    digits = `255${digits.slice(1)}`;
  } else if (digits.length === 9) {
    digits = `255${digits}`;
  }
  if (!/^255[67]\d{8}$/.test(digits)) return null;
  return digits;
}

export function isValidPhoneNumber(raw: string): boolean {
  return normalizePhoneNumber(raw) !== null;
}

export function isValidBic(raw: string): boolean {
  return typeof raw === 'string' && /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(raw.trim());
}

/** Known Tanzanian mobile-money operators by number prefix. */
export type MobileOperator = 'VODACOM' | 'AIRTEL' | 'TIGO' | 'HALOPESA' | 'UNKNOWN';

/**
 * Detects the mobile money operator from a normalized 255-prefixed number:
 *  - Vodacom/M-Pesa: 074/075/076/065 (+255 74/75/76/65)
 *  - Airtel: 078/068 (+255 78/68)
 *  - Tigo/Mixx by Yas: 071/065/066/073 overlaps resolved in order below
 *  - Halopesa: 062
 * Prefixes follow the current TCRA numbering plan.
 */
export function detectMobileOperator(normalized255: string): MobileOperator {
  const p = normalized255.replace(/\D/g, '');
  if (!p.startsWith('255') || p.length < 12) return 'UNKNOWN';
  const prefix = p.slice(3, 5); // the two digits after 255
  if (['74', '75', '76'].includes(prefix)) return 'VODACOM';
  if (['78', '68'].includes(prefix)) return 'AIRTEL';
  if (['61', '65', '66', '67', '71', '73'].includes(prefix)) return 'TIGO';
  if (prefix === '62') return 'HALOPESA';
  return 'UNKNOWN';
}
