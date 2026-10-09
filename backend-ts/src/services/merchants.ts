/**
 * Merchant identity (`merchants` + `merchant_aliases`).
 *
 * R4 compares prices *between merchants*, so "永辉" and "永辉超市" have to be the
 * same shop or the comparison is quietly wrong. `item_prices` therefore keeps
 * both the raw text the user said (`merchant`) and a resolved `merchant_id`
 * (ON DELETE SET NULL): if resolution ever fails, the wording is still there.
 *
 * Resolution order is alias → exact name → create. The alias table is checked
 * first because it is the mechanism for teaching the app that two spellings are
 * one shop.
 */

/** Trim a raw merchant string, treating blank as absent. */
export function normaliseMerchantName(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ResolvedMerchant {
  /** Always the raw wording (trimmed), even when resolution failed. */
  merchant: string | null;
  /** The entity, or null when no name was given. */
  merchant_id: number | null;
}

/**
 * Resolve a raw shop name to an entity, creating it when unknown.
 *
 * Never throws for an unresolvable name: `merchant` is stored regardless, which
 * is what keeps a failed match from losing information.
 */
export async function resolveMerchant(
  db: D1Database, userId: number, raw: string | null | undefined,
): Promise<ResolvedMerchant> {
  const name = normaliseMerchantName(raw);
  if (name === null) return { merchant: null, merchant_id: null };

  const byAlias = await db
    .prepare('SELECT merchant_id FROM merchant_aliases WHERE user_id = ? AND alias = ?')
    .bind(userId, name)
    .first<{ merchant_id: number }>();
  if (byAlias) return { merchant: name, merchant_id: byAlias.merchant_id };

  const byName = await db
    .prepare('SELECT id FROM merchants WHERE user_id = ? AND name = ?')
    .bind(userId, name)
    .first<{ id: number }>();
  if (byName) return { merchant: name, merchant_id: byName.id };

  const created = await db
    .prepare('INSERT INTO merchants (user_id, name, created_at) VALUES (?, ?, ?) RETURNING id')
    .bind(userId, name, new Date().toISOString())
    .first<{ id: number }>();

  return { merchant: name, merchant_id: created?.id ?? null };
}

/** Record that `alias` means the same shop as `merchantId` (R4's 永辉 case). */
export async function addMerchantAlias(
  db: D1Database, userId: number, merchantId: number, alias: string,
): Promise<void> {
  const trimmed = alias.trim();
  if (trimmed.length === 0) return;

  await db
    .prepare(
      'INSERT OR IGNORE INTO merchant_aliases (user_id, merchant_id, alias, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(userId, merchantId, trimmed, new Date().toISOString())
    .run();
}
