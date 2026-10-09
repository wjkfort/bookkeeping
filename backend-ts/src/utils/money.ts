/**
 * Money conversion at the storage boundary.
 *
 * Schema v2 stores money as integer cents (`amount_cents`,
 * `unit_price_cents`), while the API keeps accepting and returning decimal
 * amounts. Every handler that touches a money column converts through this
 * module so the rounding rule lives in exactly one place.
 */

/** Dollars (the wire format) to the integer cents the database stores. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Integer cents from the database to the decimal the API returns. */
export function toAmount(cents: number | null): number | null {
  return cents === null ? null : cents / 100;
}

/**
 * Cents to a decimal amount, for a field the API always returns (never null).
 */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** Round a decimal amount to whole cents, as the API has always done. */
export function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}
