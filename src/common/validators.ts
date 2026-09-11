/** Monetary amount pattern: positive, up to 2 decimal places, numeric string. */
export const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
export const AMOUNT_MESSAGE = 'amount must be a numeric string with up to 2 decimal places, e.g. "15000" or "1500.50"';
