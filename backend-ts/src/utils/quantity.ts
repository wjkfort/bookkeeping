/**
 * How many units were bought, worked out from what was paid and the price per
 * unit.
 *
 * This exists so the assistant never does the division itself. The rule it is
 * held to (`systemPrompt`) is that every figure it shows must come from a tool
 * result, and a figure that came out of a tool is at least reproducible and
 * reviewable — which is not true of one produced in the model's head.
 *
 * It does NOT make the answer true, and that distinction is the whole point of
 * keeping `exact` next to the number. `amount_cents` is what left the account;
 * it equals `unit_price_cents * quantity` only when nothing else moved the
 * total. A discount, a shelf price rounded to a friendly figure, a scale that
 * rounds the weight, or one payment covering several things all break the
 * identity, and none of them is visible from inside the arithmetic.
 *
 * Measured on the production ledger when this was written: of the 24 price rows
 * that carry both a quantity and a purchase, 11 disagree with their
 * transaction's amount — a credit-card discount, a unit price that was really
 * the line total, a `quantity: 1` standing in for "I did not count". One of them
 * was the crab: 89 paid at 65 a 斤, where the user's own answer was 1.4 斤 and
 * the division says 1.3692.
 *
 * So callers treat `quantity` as a proposal to read back to the user, and
 * `exact` as "the arithmetic left no remainder" — a much weaker statement than
 * "this is what they bought".
 */

/**
 * Decimal places kept on an inexact quotient.
 *
 * Four is enough to read 1.3692 back and to notice it is not 1.4; more would
 * dress up a guess as a measurement.
 */
export const DERIVED_QUANTITY_PRECISION = 4;

export interface DerivedQuantity {
  /** The quotient, rounded when it did not come out even. */
  quantity: number;
  /** True when the division left no remainder, so the quantity is determined. */
  exact: boolean;
}

/**
 * Divide the amount by the unit price, or `null` when that is not possible.
 *
 * `null` means the question has no answer rather than that the answer is zero:
 * a zero unit price (a free item, or a row where the price was never filled in)
 * cannot be divided by, and no arithmetic can recover the size of a purchase
 * from it.
 */
export function deriveQuantity(
  amountCents: number, unitPriceCents: number,
): DerivedQuantity | null {
  if (!Number.isFinite(amountCents) || !Number.isFinite(unitPriceCents)) return null;
  if (unitPriceCents <= 0) return null;

  const quotient = amountCents / unitPriceCents;
  // Integer cents in, so the remainder test is exact rather than a tolerance on
  // floating point: 8900 / 6500 is not whole, and 13000 / 6500 is.
  if (Number.isInteger(quotient)) return { quantity: quotient, exact: true };

  return {
    quantity: Number(quotient.toFixed(DERIVED_QUANTITY_PRECISION)),
    exact: false,
  };
}
