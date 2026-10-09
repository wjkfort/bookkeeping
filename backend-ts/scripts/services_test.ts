/**
 * Exercise the extracted service layer directly (no HTTP), which is the code
 * the AI tools will call.
 *
 *   npx esbuild scripts/services_test.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/.build/services_test.mjs
 *   node scripts/.build/services_test.mjs <source.sqlite>
 *
 * Why this exists next to api_write_test.ts: that suite goes through the
 * handlers and therefore can only assert what the HTTP contract exposes. Two
 * things this work adds are invisible there —
 *
 *   1. `transactions.source`. The old handler hardcoded 'manual', so every row
 *      was 'manual' regardless of who wrote it. Now the service takes it, and
 *      the AI path must record 'ai'. Nothing asserted this column before.
 *   2. `item_prices.merchant`. R2 expects one message to write a transaction
 *      *and* a price observation carrying the shop.
 *
 * The source database is copied first and never modified.
 */

import { copyFileSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from '../src/services/transactions';
import {
  createCategory,
  updateCategory,
  deleteCategory,
} from '../src/services/categories';
import {
  logPrice,
  getPriceStats,
  compareToHistory,
  compareMerchants,
  updatePrice,
  deletePrice,
  priceBreakdown,
} from '../src/services/prices';
import {
  createSubscription,
  renewSubscription,
  archiveSubscription,
  listRenewals,
  listSubscriptions,
} from '../src/services/subscriptions';
import {
  findGaps,
  findMissingDays,
  findOverdueSubscriptions,
  gapWindow,
  markLedgerDay,
  getLedgerDay,
  findMissingDays,
} from '../src/services/gaps';
import { readMemory, writeMemory, appendMemory, AI_MEMORY_MAX_LENGTH } from '../src/services/memory';
import { listUnits } from '../src/services/units';
import { toolDefinitions, runTool, TOOLS } from '../src/services/tools';
import { findTransactions } from '../src/services/queries';
import { buildPrompt, PROMPT_CHAR_BUDGET, detectLanguage } from '../src/services/prompt';
import {
  groupMessages, takeNewestGroups, recordMessage, loadRecentMessages, toolCallIdPayload,
  pageMessages, listSessions, tokenUsage,
} from '../src/services/conversation';
import { runChatTurn, runOpeningTurn, MAX_TOOL_ROUNDS } from '../src/services/chat';
import {
  localDateString, todayInZone, localGapWindow, requireTimezone,
  isValidTimezone, DEFAULT_TIMEZONE,
} from '../src/utils/time';
import type { ChatResult } from '../src/services/deepseek';
import { ServiceError } from '../src/services/errors';

const failures: string[] = [];
let checks = 0;

class D1Shim {
  constructor(public db: any) { this.db.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql: string) { return shimStatement(this.db, sql); }
  async batch(st: any[]) { const out = []; for (const s of st) out.push(await s); return out; }
}

function shimStatement(db: any, sql: string) {
  const make = (bound: any[]) => {
    const run = () => {
      const stmt = db.prepare(sql);
      const args = bound.map((v: any) => (v === undefined ? null : v));
      try {
        const isQuery = /^\s*(select|with|pragma)/i.test(sql);
        const isReturning = /\breturning\b/i.test(sql);
        // `all()` on a statement with RETURNING already performs the write in
        // node:sqlite, so it must not be followed by `run()`: doing both
        // inserted every row twice. A RETURNING row is therefore taken as the
        // proof of a single successful write.
        if (isQuery || isReturning) {
          const results = stmt.all(...args);
          return {
            results,
            success: true,
            meta: { changes: isQuery ? 0 : results.length, last_row_id: 0 },
          };
        }
        stmt.run(...args);
        // node:sqlite does not expose changes/lastInsertRowid on StatementSync,
        // so a plain write reports no metadata rather than re-running itself.
        // auth.ts reads meta.last_row_id after an INSERT, so it is recovered
        // from the connection instead of left at 0.
        const lastRow = db.prepare('SELECT last_insert_rowid() AS id').get() as any;
        return { success: true, meta: { changes: 0, last_row_id: Number(lastRow?.id ?? 0) } };
      } catch (e: any) {
        throw new Error(`${e.message} [sql: ${sql.replace(/\s+/g, ' ').slice(0, 160)}]`);
      } finally { try { stmt.finalize?.(); } catch { /* ignore */ } }
    };
    return {
      bind: (...a: any[]) => make(a),
      first: async () => run().results?.[0] ?? null,
      all: async () => run(),
      run: async () => run(),
    };
  };
  return make([]);
}

function check(label: string, ok: boolean, detail = '') {
  checks++;
  if (!ok) failures.push(label);
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  — ' + detail : ''}`);
}

/** Run a service call and report the ServiceError status, or null on success. */
async function expectServiceError(fn: () => Promise<unknown>): Promise<number | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
}

async function main() {
  const src = process.argv[2];
  if (!src) { console.error('usage: services_test.mjs <source.sqlite>'); process.exit(2); }
  const work = '/tmp/services_test.sqlite';
  try { unlinkSync(work); } catch { /* absent */ }
  copyFileSync(src, work);

  const raw = new DatabaseSync(work);
  const db = new D1Shim(raw) as any;
  const uid = raw.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id as number;

  const txRow = (id: number) => raw.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;
  const priceRows = (txId: number) =>
    raw.prepare('SELECT * FROM item_prices WHERE transaction_id = ?').all(txId) as any[];

  // The fixture may not have an expense category for this user (a fresh install
  // has none), so create one when needed.
  let cat = raw.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND type = 'expense' LIMIT 1").get(uid) as any;
  if (!cat) {
    raw.prepare("INSERT INTO categories (user_id, name, type, created_at) VALUES (?, 'svc-test', 'expense', datetime('now'))")
      .run(uid);
    cat = raw.prepare("SELECT id FROM categories WHERE user_id = ? AND name = 'svc-test'").get(uid) as any;
  }
  const catId = cat.id;

  console.log('=== source: default stays manual (HTTP path unchanged) ===');
  let created = await createTransaction(db, uid, {
    amount: 10, currency: 'CNY', date: '2026-10-09', category_id: catId,
    description: 'svc default source',
  });
  check('source defaults to manual', txRow(created.id).source === 'manual',
        `got ${txRow(created.id).source}`);

  console.log('\n=== source: the AI path records ai ===');
  created = await createTransaction(db, uid, {
    amount: 11, currency: 'CNY', date: '2026-10-09', category_id: catId,
    description: 'svc ai source', source: 'ai',
  });
  check('source records ai', txRow(created.id).source === 'ai', `got ${txRow(created.id).source}`);

  console.log('\n=== item price from a purchase: unit_price defaults to amount ===');
  created = await createTransaction(db, uid, {
    amount: 86, currency: 'CNY', date: '2026-10-09', category_id: catId,
    description: 'svc item default price', source: 'ai',
    item: { item_name: 'svc-test-supermarket', quantity: 1, unit: 'piece' },
  });
  let prices = priceRows(created.id);
  check('exactly one price row written', prices.length === 1, `got ${prices.length}`);
  check('unit_price defaults to the amount paid (8600 cents)',
        prices[0]?.unit_price_cents === 8600, `got ${prices[0]?.unit_price_cents}`);
  check('unit code stored', prices[0]?.unit === 'piece', `got ${prices[0]?.unit}`);

  console.log('\n=== merchant is threaded to item_prices ===');
  // The amount (30) and the unit price (15) are deliberately different, so the
  // assertion below can tell "the stated unit price was used" apart from "the
  // amount was used".
  created = await createTransaction(db, uid, {
    amount: 30, currency: 'CNY', date: '2026-10-09', category_id: catId,
    description: 'svc merchant', source: 'ai',
    item: { item_name: 'svc-test-eggs', unit_price: 15, quantity: 1, unit: 'piece', merchant: '  永辉超市  ' },
  });
  prices = priceRows(created.id);
  check('merchant stored trimmed', prices[0]?.merchant === '永辉超市', `got ${JSON.stringify(prices[0]?.merchant)}`);
  check('the stated unit_price is used, not the amount (1500, not 3000)',
        prices[0]?.unit_price_cents === 1500, `got ${prices[0]?.unit_price_cents}`);
  check('quantity kept alongside the explicit price',
        prices[0]?.quantity === 1, `got ${prices[0]?.quantity}`);

  console.log('\n=== cross-user isolation (the model cannot pick a user) ===');
  // Build a genuine second user with an item, rather than trusting the fixture
  // to have one: a missing fixture must not read as a passing isolation check.
  raw.prepare("INSERT INTO users (email, password_hash, username) VALUES ('svc-other@local','x','svc-other')")
    .run();
  const otherId = (raw.prepare("SELECT id FROM users WHERE email = 'svc-other@local'").get() as any).id;
  raw.prepare("INSERT INTO items (user_id, name, created_at) VALUES (?, 'svc-foreign-item', datetime('now'))")
    .run(otherId);
  const foreignItem = raw.prepare('SELECT id FROM items WHERE user_id = ? LIMIT 1').get(otherId) as any;

  const statusForeign = await expectServiceError(() => createTransaction(db, uid, {
    amount: 5, currency: 'CNY', date: '2026-10-09', category_id: catId,
    item: { item_id: foreignItem.id },
  }));
  check('another user\'s item is rejected', statusForeign === 404, `status ${statusForeign}`);

  const foreignCat = raw.prepare(
    "SELECT id FROM categories WHERE user_id = ? LIMIT 1").get(otherId) as any;
  if (!foreignCat) {
    raw.prepare("INSERT INTO categories (user_id, name, type, created_at) VALUES (?, 'svc-foreign-cat', 'expense', datetime('now'))")
      .run(otherId);
  }
  const foreignCatId = (raw.prepare('SELECT id FROM categories WHERE user_id = ? LIMIT 1').get(otherId) as any).id;
  const statusForeignCat = await expectServiceError(() => createTransaction(db, uid, {
    amount: 5, currency: 'CNY', date: '2026-10-09', category_id: foreignCatId,
  }));
  check('another user\'s category is rejected', statusForeignCat === 404, `status ${statusForeignCat}`);

  const statusUnknownCat = await expectServiceError(() => createTransaction(db, uid, {
    amount: 5, currency: 'CNY', date: '2026-10-09', category_id: 999999,
  }));
  check('unknown category is a 404', statusUnknownCat === 404, `status ${statusUnknownCat}`);

  console.log('\n=== update: merchant alone counts as a price update ===');
  created = await createTransaction(db, uid, {
    amount: 20, currency: 'CNY', date: '2026-10-09', category_id: catId,
    description: 'svc update merchant', item: { item_name: 'svc-test-milk' },
  });
  await updateTransaction(db, uid, created.id, { merchant: '永辉' });
  prices = priceRows(created.id);
  check('merchant updated on the existing observation',
        prices[0]?.merchant === '永辉', `got ${JSON.stringify(prices[0]?.merchant)}`);

  console.log('\n=== delete removes the price observation with the transaction ===');
  await deleteTransaction(db, uid, created.id);
  check('transaction gone', txRow(created.id) === undefined);
  check('no orphan price row left behind', priceRows(created.id).length === 0,
        `got ${priceRows(created.id).length}`);

  console.log('\n=== delete of a missing transaction is a 404 ===');
  const statusMissing = await expectServiceError(() => deleteTransaction(db, uid, created.id));
  check('missing transaction is a 404', statusMissing === 404, `status ${statusMissing}`);

  // -------------------------------------------------------------------------
  // Category structure rules.
  //
  // These were documented as enforced ("max depth 2 and child.type =
  // parent.type are enforced in the API") but no such check existed anywhere in
  // the codebase. Production data happens to satisfy both. They matter because
  // summary.ts classifies by c.type and rolls up exactly one level, so a
  // violation makes report numbers wrong (R6).
  // -------------------------------------------------------------------------
  console.log('\n=== category rules: depth <= 2 and child.type = parent.type ===');

  const expenseRoot = await createCategory(db, uid, { name: 'svc-cat-root-expense', type: 'expense' });
  const incomeRoot = await createCategory(db, uid, { name: 'svc-cat-root-income', type: 'income' });

  const child = await createCategory(db, uid, {
    name: 'svc-cat-child', type: 'expense', parent_id: expenseRoot.id,
  });
  check('a same-type child of a root is allowed', typeof child.id === 'number');

  const depth3 = await expectServiceError(() => createCategory(db, uid, {
    name: 'svc-cat-grandchild', type: 'expense', parent_id: child.id,
  }));
  check('a third level is rejected', depth3 === 400, `status ${depth3}`);

  const wrongType = await expectServiceError(() => createCategory(db, uid, {
    name: 'svc-cat-wrong-type', type: 'income', parent_id: expenseRoot.id,
  }));
  check('a child of the other type is rejected', wrongType === 400, `status ${wrongType}`);

  const selfParent = await expectServiceError(() => updateCategory(db, uid, expenseRoot.id, {
    parent_id: expenseRoot.id,
  }));
  check('a category cannot be its own parent', selfParent === 400, `status ${selfParent}`);

  const reparentWithChildren = await expectServiceError(() => updateCategory(db, uid, expenseRoot.id, {
    parent_id: incomeRoot.id,
  }));
  check('a category with children cannot be reparented (would create level 3)',
        reparentWithChildren === 400, `status ${reparentWithChildren}`);

  const retypeWithChildren = await expectServiceError(() => updateCategory(db, uid, expenseRoot.id, {
    type: 'income',
  }));
  check('a category with children cannot change to their other type',
        retypeWithChildren === 400, `status ${retypeWithChildren}`);

  // Renaming and translating must still work untouched.
  const renamed = await updateCategory(db, uid, child.id, { name: 'svc-cat-child-renamed' });
  check('a plain rename still succeeds', renamed.name === 'svc-cat-child-renamed', `got ${renamed.name}`);

  const okType = await updateCategory(db, uid, child.id, { type: 'income' });
  check('a leaf may change type freely', okType.type === 'income', `got ${okType.type}`);

  console.log('\n=== category delete: still-in-use conflict carries the count ===');
  let conflictErr: any = null;
  try {
    await deleteCategory(db, uid, catId);
  } catch (e) { conflictErr = e; }
  check('deleting a category with transactions is a 409',
        conflictErr instanceof ServiceError && conflictErr.status === 409,
        `status ${conflictErr?.status}`);
  check('the conflict reports the transaction count',
        conflictErr?.details?.transaction_count > 0,
        `got ${conflictErr?.details?.transaction_count}`);

  // -------------------------------------------------------------------------
  // Prices: the two constraints §5.1 says the schema guarantees, plus the R4
  // comparison helpers. `unit` is a foreign key into the shared `units`
  // vocabulary, and `merchant` is kept as raw text next to the resolved entity.
  // -------------------------------------------------------------------------
  console.log('\n=== prices: unit must come from the vocabulary ===');

  // A price with no unit at all is legitimate (a shelf price with no basis).
  const noUnit = await logPrice(db, uid, { item_name: 'svc-price-nounit', unit_price: 5 });
  check('a price with no unit is accepted', noUnit.unit === null, `got ${noUnit.unit}`);

  // An unmappable unit is kept as the user's wording, NOT rejected. Rejecting it
  // is what pushed the model into converting 斤 to kg, which wrote a wrong
  // number into the price history it is later compared against.
  const unmapped = await logPrice(db, uid, {
    item_name: 'svc-price-unmapped', unit_price: 5, unit: '个',
  });
  check('an unmapped unit is accepted and stored raw', unmapped.unit === null,
        `unit=${unmapped.unit}`);
  check('the wording survives so the row stays recoverable',
        unmapped.unit_raw === '个', `unit_raw=${unmapped.unit_raw}`);
  check('no code is invented for it', unmapped.unit === null);

  const rawKept = await logPrice(db, uid, {
    item_name: 'svc-price-raw', unit_price: 7, unit: 'piece',
  });
  check('the code is stored in unit and the wording in unit_raw',
        rawKept.unit === 'piece', `got unit=${rawKept.unit}`);

  console.log('\n=== prices: merchant raw text + resolved entity ===');
  const withMerchant = await logPrice(db, uid, {
    item_name: 'svc-price-merchant', unit_price: 15, unit: 'piece', merchant: '  永辉超市  ',
  });
  check('merchant text stored trimmed', withMerchant.merchant === '永辉超市',
        `got ${JSON.stringify(withMerchant.merchant)}`);
  check('merchant resolved to an entity', typeof withMerchant.merchant_id === 'number',
        `got ${withMerchant.merchant_id}`);

  const sameMerchant = await logPrice(db, uid, {
    item_name: 'svc-price-merchant', unit_price: 16, unit: 'piece', merchant: '永辉超市',
  });
  check('the same shop name resolves to the same entity',
        sameMerchant.merchant_id === withMerchant.merchant_id,
        `${sameMerchant.merchant_id} vs ${withMerchant.merchant_id}`);

  console.log('\n=== prices: R4 comparison comes from SQL, not the model ===');
  // The observation being judged is already stored when this runs, so the
  // first-observation and "strictly earlier" behaviour is checked directly.
  const histItem = await logPrice(db, uid, { item_name: 'svc-price-hist', unit_price: 10 });
  const alone = await compareToHistory(db, uid, histItem.item_id, 10, {
    beforeDate: histItem.observed_on, excludePriceId: histItem.id,
  });
  check('the first observation has no average to beat', alone.is_first === true,
        `average ${alone.average_per_unit}`);
  check('the first observation is not flagged as a spike', alone.is_spike === false);

  const second = await logPrice(db, uid, { item_name: 'svc-price-hist', unit_price: 10 });
  // `second` is the row that would be written for the price being judged, so
  // excluding it is what "compare against earlier observations" means.
  const judged = { beforeDate: second.observed_on, excludePriceId: second.id };

  // One earlier observation at 10: a price of 12 is +20% and IS a spike. This
  // is the assertion that catches averaging the new price into its own baseline.
  const vsOne = await compareToHistory(db, uid, histItem.item_id, 12, judged);
  check('a real 20% rise over one earlier price is a spike', vsOne.is_spike === true,
        `change ${vsOne.change_pct}%`);
  check('the baseline excludes the observation being judged',
        vsOne.average_per_unit === 10, `average ${vsOne.average_per_unit}`);

  // 11 is exactly +10%, and R4 says "more than 10%", so it must not flag.
  const atThreshold = await compareToHistory(db, uid, histItem.item_id, 11, judged);
  check('exactly 10% above the average is not a spike', atThreshold.is_spike === false,
        `change ${atThreshold.change_pct}%`);

  const cheaper = await compareToHistory(db, uid, histItem.item_id, 8, judged);
  check('a cheaper price reports a negative change', cheaper.change_pct === -20,
        `got ${cheaper.change_pct}`);
  check('a cheaper price is never a spike', cheaper.is_spike === false);

  const stats = await getPriceStats(db, uid, histItem.item_id);
  check('stats report the count', stats[0]?.count === 2, `got ${stats[0]?.count}`);

  // -------------------------------------------------------------------------
  // A different size of the same product (the case the user described):
  // "last month I bought a 30ml bottle, this month the same thing in 50ml".
  //
  // The item name carries no size — the size is quantity + unit. Comparing the
  // totals would say the 50ml is dearer; comparing the cost per ml says it is
  // cheaper per unit, which is the answer that is actually true.
  // -------------------------------------------------------------------------
  console.log('\n=== prices: different sizes of the same product ===');

  const shampoo = await logPrice(db, uid, {
    item_name: 'svc-shampoo', unit_price: 45, quantity: 30, unit: 'ml',
    observed_on: '2030-01-10',
  });
  check('the item name carries no size', shampoo.item_name === 'svc-shampoo',
        shampoo.item_name);

  // This month: 50ml for 60 — dearer in total, cheaper per ml.
  const bigger = await logPrice(db, uid, {
    item_name: 'svc-shampoo', unit_price: 60, quantity: 50, unit: 'ml',
    observed_on: '2030-02-10',
  });

  const vsBigger = await compareToHistory(db, uid, shampoo.item_id, 60, {
    unit: 'ml', quantity: 50,
    beforeDate: bigger.observed_on, excludePriceId: bigger.id,
  });
  check('the comparison is scoped to a unit', vsBigger.unit === 'ml', `got ${vsBigger.unit}`);
  check('cost per ml is computed, not the raw total',
        vsBigger.per_unit_price === 1.2, `got ${vsBigger.per_unit_price}`);
  check('the earlier 45 for 30ml is 1.5 per ml',
        vsBigger.average_per_unit === 1.5, `got ${vsBigger.average_per_unit}`);
  check('a dearer total that is cheaper per unit reads as a fall',
        vsBigger.change_pct === -20, `got ${vsBigger.change_pct}%`);
  check('a fall is never a spike', vsBigger.is_spike === false);

  // The reverse direction: 30ml after a 50ml purchase reads as a rise.
  const vsSmaller = await compareToHistory(db, uid, shampoo.item_id, 45, {
    unit: 'ml', quantity: 30,
    beforeDate: '2030-03-01', excludePriceId: 999999,
  });
  // Both earlier ml rows count now: 1.5/ml (30 for 45) and 1.2/ml (50 for 60).
  check('the later 30ml is dearer per ml', vsSmaller.change_pct !== null && vsSmaller.change_pct > 0,
        `got ${vsSmaller.change_pct}%`);

  console.log('\n=== prices: cross-unit is refused, but reported ===');
  // The same product recorded once by volume and once by count. Averaging the
  // two would produce a number describing nothing.
  await logPrice(db, uid, {
    item_name: 'svc-shampoo', unit_price: 8, quantity: 1, unit: 'piece',
    observed_on: '2030-02-20',
  });

  const vsPiece = await compareToHistory(db, uid, shampoo.item_id, 60, {
    unit: 'ml', quantity: 50,
    beforeDate: '2030-03-01', excludePriceId: 999999,
  });
  check('the ml baseline ignores the piece observation',
        vsPiece.average_per_unit === 1.35, `got ${vsPiece.average_per_unit}`);
  check('and it counts only the two ml rows', vsPiece.is_first === false);
  check('the other unit is reported rather than mixed in',
        vsPiece.other_units.some(u => u.unit === 'piece'),
        JSON.stringify(vsPiece.other_units));
  check('the other unit carries its own average',
        vsPiece.other_units.find(u => u.unit === 'piece')?.average_per_unit === 8,
        JSON.stringify(vsPiece.other_units));

  // The breakdown the tool hands the model: already split, already normalised.
  const breakdown = await priceBreakdown(db, uid, shampoo.item_id, 'ml');
  check('the comparable group is the requested unit', breakdown.comparable?.unit === 'ml',
        JSON.stringify(breakdown.comparable?.unit));
  check('the comparable average is a cost per ml, not a total',
        breakdown.comparable?.average_per_unit === 1.35,
        `got ${breakdown.comparable?.average_per_unit}`);
  check('the totals stay visible so "60 for 50ml" is not lost',
        breakdown.comparable?.totals.includes(60), JSON.stringify(breakdown.comparable?.totals));
  // All money in one object must be the same unit. Cents here while the average
  // was in yuan made the model read "120 per ml".
  check('every per-unit figure is in the same unit as the average',
        breakdown.comparable?.min_per_unit === 1.2 && breakdown.comparable?.max_per_unit === 1.5
          && breakdown.comparable?.last_per_unit === 1.2,
        JSON.stringify({
          min: breakdown.comparable?.min_per_unit,
          max: breakdown.comparable?.max_per_unit,
          last: breakdown.comparable?.last_per_unit,
        }));
  check('the piece group is listed separately',
        breakdown.other_units.map(u => u.unit).join(',') === 'piece',
        JSON.stringify(breakdown.other_units.map(u => u.unit)));

  // No unit asked for: nothing is claimed comparable, so nothing is averaged.
  const unscoped = await priceBreakdown(db, uid, shampoo.item_id);
  check('with no unit given nothing is averaged together', unscoped.comparable === null,
        JSON.stringify(unscoped.comparable));
  check('with no unit given both groups are still listed',
        unscoped.other_units.length === 2, JSON.stringify(unscoped.other_units.map(u => u.unit)));

  // An observation with no unit cannot be normalised at all.
  await logPrice(db, uid, { item_name: 'svc-shampoo', unit_price: 12, observed_on: '2030-02-25' });
  const withNoUnit = await priceBreakdown(db, uid, shampoo.item_id, 'ml');
  check('observations with no unit are kept out of the comparison',
        withNoUnit.without_unit?.count === 1, JSON.stringify(withNoUnit.without_unit?.count));
  check('the no-unit group has no per-unit figure',
        withNoUnit.without_unit?.average_per_unit === null,
        JSON.stringify(withNoUnit.without_unit?.average_per_unit));
  check('the ml average is unaffected by the unitless row',
        withNoUnit.comparable?.average_per_unit === 1.35,
        `got ${withNoUnit.comparable?.average_per_unit}`);

  const cmp = await compareMerchants(db, uid, withMerchant.item_id);  check('merchant comparison covers the resolved shop', cmp.length >= 1,
        `got ${cmp.length}`);

  console.log('\n=== prices: correct and retract one observation ===');
  const corrected = await updatePrice(db, uid, histItem.id, { unit_price: 9.5 });
  check('a price can be corrected', corrected.unit_price === 9.5, `got ${corrected.unit_price}`);

  await deletePrice(db, uid, histItem.id);
  const remaining = await getPriceStats(db, uid, histItem.item_id);
  check('a price can be retracted', remaining[0]?.count === 1, `got ${remaining[0]?.count}`);

  const missingPrice = await expectServiceError(() => deletePrice(db, uid, histItem.id));
  check('retracting it twice is a 404', missingPrice === 404, `status ${missingPrice}`);

  // -------------------------------------------------------------------------
  // Subscriptions: renewal is the mechanism R3 depends on. A renewal is a
  // transaction carrying subscription_id, and once it exists the period is no
  // longer overdue — so the assertions here are about that link, not just dates.
  // -------------------------------------------------------------------------
  console.log('\n=== subscriptions: renewal advances the period and records it ===');

  const sub = await createSubscription(db, uid, {
    name: 'svc-sub-monthly', amount: 25, currency: 'CNY',
    end_date: '2026-10-01', cycle: 30, category_id: catId,
  });
  check('subscription created with a decimal amount', sub.amount === 25, `got ${sub.amount}`);
  check('cycle keeps its old name on the wire', sub.cycle === 30, `got ${sub.cycle}`);
  check('nothing has been renewed yet', sub.last_renewed_at === null,
        `got ${sub.last_renewed_at}`);

  const renewed = await renewSubscription(db, uid, sub.id, {
    date: '2026-10-02', source: 'ai',
  });
  check('end_date advanced by one cycle', renewed.renewal.period_end === '2026-10-31',
        `got ${renewed.renewal.period_end}`);
  check('the period start is the old end_date', renewed.renewal.period_start === '2026-10-01',
        `got ${renewed.renewal.period_start}`);
  check('a renewal transaction was written', typeof renewed.transaction_id === 'number',
        `got ${renewed.transaction_id}`);

  const renewalTx = raw.prepare('SELECT * FROM transactions WHERE id = ?')
    .get(renewed.transaction_id) as any;
  check('the renewal transaction carries subscription_id',
        renewalTx.subscription_id === sub.id, `got ${renewalTx.subscription_id}`);
  check('the renewal records its source', renewalTx.source === 'ai', `got ${renewalTx.source}`);
  check('the amount was stored in cents', renewalTx.amount_cents === 2500,
        `got ${renewalTx.amount_cents}`);

  const afterRenew = await listSubscriptions(db, uid);
  const reloaded = afterRenew.find(s => s.id === sub.id);
  check('last_renewed_at is now derived from that transaction',
        typeof reloaded?.last_renewed_at === 'string', `got ${reloaded?.last_renewed_at}`);
  check('the stored end_date moved to the new period end',
        reloaded?.end_date === '2026-10-31', `got ${reloaded?.end_date}`);

  const renewals = await listRenewals(db, uid, sub.id);
  check('the renewal shows up in renewal history', renewals.length === 1,
        `got ${renewals.length}`);
  check('renewal history reports the decimal amount', renewals[0]?.amount === 25,
        `got ${renewals[0]?.amount}`);

  console.log('\n=== subscriptions: renewal guards ===');
  const archivedSub = await createSubscription(db, uid, {
    name: 'svc-sub-archived', amount: 10, end_date: '2026-10-01', cycle: 30, category_id: catId,
  });
  await archiveSubscription(db, uid, archivedSub.id);
  const renewArchived = await expectServiceError(() =>
    renewSubscription(db, uid, archivedSub.id, {}));
  check('an archived subscription cannot be renewed', renewArchived === 400,
        `status ${renewArchived}`);

  // A subscription with no category and no amount to charge cannot silently
  // create a transaction with no category: the caller has to supply one.
  const noCatSub = await createSubscription(db, uid, {
    name: 'svc-sub-nocat', amount: 10, end_date: '2026-10-01', cycle: 30,
  });
  const renewNoCat = await expectServiceError(() =>
    renewSubscription(db, uid, noCatSub.id, {}));
  check('renewing needs a category to write the transaction', renewNoCat === 400,
        `status ${ renewNoCat}`);

  // With transaction creation turned off the date still advances.
  const dateOnly = await renewSubscription(db, uid, noCatSub.id, { create_transaction: false });
  check('create_transaction=false still advances the date',
        dateOnly.renewal.period_end === '2026-10-31', `got ${dateOnly.renewal.period_end}`);
  check('create_transaction=false writes no transaction',
        dateOnly.transaction_id === null, `got ${dateOnly.transaction_id}`);

  const renewMissing = await expectServiceError(() =>
    renewSubscription(db, uid, 999999, {}));
  check('renewing a missing subscription is a 404', renewMissing === 404,
        `status ${renewMissing}`);

  // -------------------------------------------------------------------------
  // R3 gaps / R5 memory / units. The reference day is passed in explicitly so
  // these do not depend on the wall clock.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Date rules run on the user's calendar, not the server's UTC one.
  //
  // The decisive case is 01:00 in UTC+8, where the UTC date is still yesterday.
  // Getting this wrong makes the reminder window ask about the wrong days and
  // files entries under the wrong date — so it is asserted at the boundary.
  // -------------------------------------------------------------------------
  console.log('\n=== timezone: "today" is the user\'s day, not UTC ===');

  const lateNightInShanghai = new Date('2026-10-09T17:00:00Z'); // 01:00 on 10-10 in +08
  check('UTC still calls that instant 2026-10-09',
        localDateString('UTC', lateNightInShanghai) === '2026-10-09',
        localDateString('UTC', lateNightInShanghai));
  check('UTC+8 calls it 2026-10-10',
        localDateString(DEFAULT_TIMEZONE, lateNightInShanghai) === '2026-10-10',
        localDateString(DEFAULT_TIMEZONE, lateNightInShanghai));
  check('the default zone is UTC+8', DEFAULT_TIMEZONE === 'Asia/Shanghai', DEFAULT_TIMEZONE);

  check('todayInZone defaults to UTC+8 when given nothing',
        todayInZone(undefined, lateNightInShanghai) === '2026-10-10',
        todayInZone(undefined, lateNightInShanghai));
  check('an explicitly supplied zone is honoured',
        todayInZone('UTC', lateNightInShanghai) === '2026-10-09',
        todayInZone('UTC', lateNightInShanghai));
  check('a nonsense zone falls back to the default rather than throwing',
        todayInZone('Not/AZone', lateNightInShanghai) === '2026-10-10',
        todayInZone('Not/AZone', lateNightInShanghai));

  check('the Shanghai window excludes the local today',
        JSON.stringify(localGapWindow(DEFAULT_TIMEZONE, 3, lateNightInShanghai).window) ===
        JSON.stringify(['2026-10-07', '2026-10-08', '2026-10-09']),
        JSON.stringify(localGapWindow(DEFAULT_TIMEZONE, 3, lateNightInShanghai)));
  check('the UTC window would have been a day out',
        JSON.stringify(localGapWindow('UTC', 3, lateNightInShanghai).window) ===
        JSON.stringify(['2026-10-06', '2026-10-07', '2026-10-08']),
        JSON.stringify(localGapWindow('UTC', 3, lateNightInShanghai)));

  check('a real IANA zone validates', isValidTimezone('Asia/Shanghai'));
  check('a nonsense zone does not', !isValidTimezone('Not/AZone'));
  check('an empty zone does not', !isValidTimezone(''));
  check('requireTimezone defaults when absent', requireTimezone(undefined) === DEFAULT_TIMEZONE);

  const badZone = await expectServiceError(async () => requireTimezone('Not/AZone'));
  check('an unknown zone is a 400, not a silent fallback', badZone === 400, `status ${badZone}`);

  // A write with no date must land on the user's day, not the server's.
  const datedLocally = await createTransaction(db, uid, {
    amount: 3, currency: 'CNY', category_id: catId, description: 'tz default',
    timezone: DEFAULT_TIMEZONE,
    // No date: resolved by the service from the zone.
  });
  const storedDate = (raw.prepare('SELECT date FROM transactions WHERE id = ?')
    .get(datedLocally.id) as any).date;
  check('an omitted date is resolved (never left undefined)',
        typeof storedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(storedDate), storedDate);
  check('an explicitly supplied date is never shifted',
        (await createTransaction(db, uid, {
          amount: 3, currency: 'CNY', category_id: catId, date: '2026-01-02',
          timezone: DEFAULT_TIMEZONE,
        })).date === '2026-01-02');

  console.log('\n=== conversations: a new session sees none of the old one ===');
  // The requirement: a page load is a new conversation, with none of the
  // previous content. That cannot be done by hiding rows — the model's context
  // is loaded per user — so the transcript is scoped by session instead, and
  // old conversations stay on disk rather than being deleted.
  const sessionA = 'svc-conv-A';
  const sessionB = 'svc-conv-B';

  await recordMessage(db, uid, { session_id: sessionA, role: 'user', content: 'A-only-question' });
  await recordMessage(db, uid, { session_id: sessionA, role: 'assistant', content: 'A-only-answer' });
  await recordMessage(db, uid, { session_id: sessionB, role: 'user', content: 'B-only-question' });

  const inA = await loadRecentMessages(db, uid, sessionA, 20);
  const inB = await loadRecentMessages(db, uid, sessionB, 20);
  check('session A sees only its own turns',
        inA.some(m => m.content === 'A-only-question') &&
        !inA.some(m => m.content === 'B-only-question'),
        JSON.stringify(inA.map(m => m.content)));
  check('session B sees only its own turn',
        inB.some(m => m.content === 'B-only-question') &&
        !inB.some(m => m.content === 'A-only-question'),
        JSON.stringify(inB.map(m => m.content)));

  // The decisive one: the prompt for a new conversation must not carry the old
  // conversation in. This is what "don't keep the previous conversation" means
  // for the model, as opposed to for the screen.
  const freshPrompt = await buildPrompt(db, uid, 'brand new', {
    today: '2030-06-15', sessionId: 'svc-conv-fresh',
  });
  const freshBlob = freshPrompt.messages.map(m => m.content ?? '').join('\n');
  check('a brand new conversation is given no earlier transcript',
        !freshBlob.includes('A-only-question') && !freshBlob.includes('B-only-question'),
        freshBlob.slice(0, 200));
  check('the new conversation still gets the system prompt and snapshot',
        freshPrompt.messages.length >= 3 &&
        (freshPrompt.messages[0].content ?? '').includes('bookkeeping assistant'));

  // Paging is scoped as well, so the UI cannot show another conversation's turns.
  const pageA = await pageMessages(db, uid, sessionA, { limit: 50 });
  check('paging is scoped to the conversation',
        pageA.every(m => m.session_id === sessionA), JSON.stringify(pageA.map(m => m.session_id)));

  // Old conversations are kept, not deleted: that is the point of the column.
  const sessions = await listSessions(db, uid, 50);
  const ids = sessions.map(s => s.session_id);
  check('earlier conversations remain on record',
        ids.includes(sessionA) && ids.includes(sessionB), JSON.stringify(ids));
  check('each conversation reports its own message count',
        sessions.find(s => s.session_id === sessionA)?.messages === 2,
        JSON.stringify(sessions.find(s => s.session_id === sessionA)));
  check('conversations are listed with their latest activity',
        sessions.every(s => typeof s.last_at === 'string' && s.last_at.length > 0));

  console.log('\n=== conversations: an id is required, and bounded ===');
  const noSession = await expectServiceError(() =>
    recordMessage(db, uid, { session_id: '', role: 'user', content: 'x' }));
  check('an empty conversation id is refused', noSession === 400, `status ${noSession}`);
  const noSessionLoad = await expectServiceError(() =>
    loadRecentMessages(db, uid, '   ', 10));
  check('a blank conversation id is refused when loading', noSessionLoad === 400,
        `status ${noSessionLoad}`);
  const sessionTooLong = await expectServiceError(() =>
    recordMessage(db, uid, { session_id: 'x'.repeat(101), role: 'user', content: 'x' }));
  check('an over-long conversation id is refused', sessionTooLong === 400, `status ${sessionTooLong}`);

  console.log('\n=== conversations: cost accounting still spans them ===');
  // Tokens are recorded per conversation but summed per user, so starting a new
  // conversation does not erase what was already spent.
  await recordMessage(db, uid, {
    session_id: sessionA, role: 'assistant', content: 'costed',
    tokens_in: 11, tokens_out: 7,
  });
  const usage = await tokenUsage(db, uid);
  check('usage counts turns across conversations', usage.messages > 3, JSON.stringify(usage));
  check('usage sums tokens from a conversation other than the current one',
        usage.tokens_in >= 11 && usage.tokens_out >= 7, JSON.stringify(usage));

  console.log('\n=== units: the vocabulary the model maps onto ===');
  const units = await listUnits(db);
  check('the vocabulary is seeded', units.length >= 9, `got ${units.length}`);
  check('piece is available', units.some(u => u.code === 'piece'));

  console.log('\n=== gaps: the window is the 3 complete days before today ===');
  // Today must never be in the window: it is still happening, so "no records"
  // there means nothing.
  check('the window is the three days ending yesterday',
        JSON.stringify(gapWindow('2026-10-09')) ===
        JSON.stringify(['2026-10-06', '2026-10-07', '2026-10-08']),
        JSON.stringify(gapWindow('2026-10-09')));
  check('today is never in the window',
        !gapWindow('2026-10-09').includes('2026-10-09'),
        JSON.stringify(gapWindow('2026-10-09')));
  check('the window rolls back across a month boundary',
        JSON.stringify(gapWindow('2026-11-02')) ===
        JSON.stringify(['2026-10-30', '2026-10-31', '2026-11-01']),
        JSON.stringify(gapWindow('2026-11-02')));

  // Choose a reference day later than anything the fixture holds, so the window
  // is empty of transactions and the assertions are about gap logic only.
  const refDay = '2030-06-15';
  const window = gapWindow(refDay);

  const missing = await findMissingDays(db, uid, refDay);
  check('all three empty days are reported missing', missing.length === 3,
        `got ${missing.length} (${missing.map(m => m.date).join(',')})`);
  check('today is not offered as a missing day',
        !missing.some(m => m.date === refDay),
        JSON.stringify(missing.map(m => m.date)));
  check('the newest reported day is yesterday',
        missing[missing.length - 1]?.date === '2030-06-14',
        `got ${missing[missing.length - 1]?.date}`);

  console.log('\n=== ledger_days: no_spend closes a day, partial keeps it open ===');
  const marked = await markLedgerDay(db, uid, window[0], 'no_spend');
  check('the day was recorded as no_spend', marked.status === 'no_spend', `got ${marked.status}`);

  const afterNoSpend = await findMissingDays(db, uid, refDay);
  check('a no_spend day stops being reported', afterNoSpend.length === 2,
        `got ${afterNoSpend.length}`);
  check('it is the recorded day that dropped out',
        !afterNoSpend.some(m => m.date === window[0]));

  // Re-answering the same day must not error: the user can revise.
  const revised = await markLedgerDay(db, uid, window[0], 'partial');
  check('the answer can be revised to partial', revised.status === 'partial',
        `got ${revised.status}`);
  const reread = await getLedgerDay(db, uid, window[0]);
  check('the revised state is what is stored', reread?.status === 'partial',
        `got ${reread?.status}`);

  // A partial day is *also* not reported: the AI knows about it and will ask.
  const afterPartial = await findMissingDays(db, uid, refDay);
  check('a partial day is not re-reported as a silent gap', afterPartial.length === 2,
        `got ${afterPartial.length}`);

  const badStatus = await expectServiceError(() =>
    markLedgerDay(db, uid, window[1], 'nonsense' as any));
  check('an unknown status is rejected', badStatus === 400, `status ${badStatus}`);

  console.log('\n=== gaps: a day with a transaction is not missing ===');
  await createTransaction(db, uid, {
    amount: 9, currency: 'CNY', date: window[2], category_id: catId, description: 'gap day spend',
  });
  const afterSpend = await findMissingDays(db, uid, refDay);
  check('a day with spending is not reported missing',
        !afterSpend.some(m => m.date === window[2]),
        JSON.stringify(afterSpend.map(m => m.date)));

  console.log('\n=== gaps: overdue means the period passed with no renewal ===');
  // The period end is placed just before the reference day so that ONE renewal
  // genuinely covers the elapsed time and can resolve the condition. An
  // end_date months in the past would mean several missed cycles, and a single
  // renewal legitimately would not catch up — that is a different scenario.
  const overdueSub = await createSubscription(db, uid, {
    name: 'svc-overdue', amount: 30, currency: 'CNY', end_date: '2030-06-10', cycle: 30,
    category_id: catId,
  });
  const notYet = await createSubscription(db, uid, {
    name: 'svc-not-overdue', amount: 30, currency: 'CNY', end_date: '2032-01-01', cycle: 30,
    category_id: catId,
  });
  const archivedOverdue = await createSubscription(db, uid, {
    name: 'svc-archived-overdue', amount: 30, currency: 'CNY', end_date: '2030-06-10', cycle: 30,
    category_id: catId,
  });
  await archiveSubscription(db, uid, archivedOverdue.id);

  const overdue = await findOverdueSubscriptions(db, uid, refDay);
  const overdueIds = overdue.map(o => o.subscription_id);
  check('a passed end_date with no renewal is overdue', overdueIds.includes(overdueSub.id),
        JSON.stringify(overdueIds));
  check('a future end_date is not overdue', !overdueIds.includes(notYet.id));
  check('an archived subscription is not chased', !overdueIds.includes(archivedOverdue.id));

  // Recording the renewal resolves it: no extra status is stored. One cycle
  // from 2030-06-10 reaches 2030-07-10, past the reference day.
  await renewSubscription(db, uid, overdueSub.id, { date: '2030-06-11', source: 'ai' });
  const afterRenewGaps = await findOverdueSubscriptions(db, uid, refDay);
  check('renewing resolves the overdue state',
        !afterRenewGaps.map(o => o.subscription_id).includes(overdueSub.id),
        JSON.stringify(afterRenewGaps.map(o => o.subscription_id)));

  console.log('\n=== gaps: the two checks are independent ===');
  const combined = await findGaps(db, uid, refDay);
  check('both checks are reported together',
        Array.isArray(combined.missing_days) && Array.isArray(combined.overdue_subscriptions));
  check('the window is echoed back', combined.window.days === 3, `got ${combined.window.days}`);
  check('no errors when both checks succeed', combined.errors.length === 0,
        JSON.stringify(combined.errors));

  console.log('\n=== memory (R5) ===');
  const empty = await readMemory(db, uid);
  check('memory starts empty', empty.memory === null, `got ${JSON.stringify(empty.memory)}`);
  check('the length limit matches the schema CHECK', empty.max_length === 2000,
        `got ${empty.max_length}`);

  const written = await writeMemory(db, uid, '午餐通常在公司附近');
  check('memory round-trips', written.memory === '午餐通常在公司附近',
        `got ${JSON.stringify(written.memory)}`);

  const appended = await appendMemory(db, uid, '超市购物算 Food');
  check('a fact can be appended', appended.memory?.includes('超市购物算 Food'),
        JSON.stringify(appended.memory));
  check('the earlier note is preserved', appended.memory?.includes('午餐通常在公司附近'));

  const tooLong = await expectServiceError(() =>
    writeMemory(db, uid, 'x'.repeat(AI_MEMORY_MAX_LENGTH + 1)));
  check('over-long memory is rejected for the model to compress', tooLong === 400,
        `status ${tooLong}`);

  const cleared = await writeMemory(db, uid, null);
  check('memory can be cleared', cleared.memory === null, `got ${JSON.stringify(cleared.memory)}`);

  // -------------------------------------------------------------------------
  // Phase 2: tools, the bounded prompt, and the tool-calling loop.
  //
  // The loop is driven with an injected `completion`, so the whole path —
  // including a tool that fails and a follow-up round — is exercised with no
  // key and no network.
  // -------------------------------------------------------------------------
  console.log('\n=== tools: the registry drives the same services as the routes ===');
  const defs = toolDefinitions();
  check('every tool is exposed to the provider', defs.length === Object.keys(TOOLS).length,
        `got ${defs.length} of ${Object.keys(TOOLS).length}`);
  check('add_transaction is present', defs.some(d => d.function.name === 'add_transaction'));
  check('every definition carries a parameters schema',
        defs.every(d => d.function.parameters && typeof d.function.parameters === 'object'));
  check('no tool lets the model name a user',
        !defs.some(d => JSON.stringify(d.function.parameters).includes('user_id')));

  // ---------------------------------------------------------------- policy
  // The assistant must never change the database structure. It has no such
  // capability today (tools take typed arguments; none of them executes SQL from
  // the model), and this pins that so a future tool cannot quietly add one.
  // The prompt states the rule; this asserts the toolset cannot violate it.
  console.log('\n=== policy: the assistant cannot change the schema ===');

  const DDL = /\b(alter|drop|create|truncate)\s+(table|index|view|trigger|column)\b/i;
  const schemaishParams = /^(sql|query|ddl|statement|migration)$/i;

  const offending: string[] = [];
  for (const d of defs) {
    const name = d.function.name;
    const blob = JSON.stringify(d.function.parameters);
    if (DDL.test(blob) || DDL.test(d.function.description)) offending.push(`${name}: mentions DDL`);
    const props = Object.keys((d.function.parameters as any)?.properties ?? {});
    for (const p of props) {
      if (schemaishParams.test(p)) offending.push(`${name}: takes a "${p}" argument`);
    }
  }
  check('no tool mentions DDL or takes a raw-SQL argument',
        offending.length === 0, offending.join('; '));

  const ctx = { db, userId: uid };

  // Every chat turn and prompt load belongs to a conversation now. These tests
  // exercise the turn mechanics, not the multi-conversation behaviour, so they
  // share one id; the session-scoping assertions below use fresh ones.
  const S = 'svc-session-1';

  const ddlTool = await runTool(ctx, 'run_sql', JSON.stringify({ sql: 'DROP TABLE users' }));
  check('an unknown tool named like SQL is refused', ddlTool.ok === false && ddlTool.code === 'UNKNOWN_TOOL',
        JSON.stringify(ddlTool));

  // The prompt has to state the rule too: the model must know to report the
  // limitation rather than assume it succeeded.
  const promptText = (await buildPrompt(db, uid, 'x', { today: '2030-06-15', sessionId: S })).messages[0].content ?? '';
  check('the system prompt forbids structural changes',
        /never change the database structure/i.test(promptText));
  check('the system prompt says to report the limitation instead of pretending',
        /say so plainly and describe what is missing/i.test(promptText));

  const unknown = await runTool(ctx, 'no_such_tool', '{}');
  check('an unknown tool is reported, not thrown', unknown.ok === false && unknown.code === 'UNKNOWN_TOOL',
        JSON.stringify(unknown));

  console.log('\n=== granularity: concrete data, not model judgement ===');
  // The bottom line the user set: product name + unit + quantity. These filters
  // answer "what is too vague?" from the database, because the ledger is too
  // large to page through looking for absences.
  const detailed = await createTransaction(db, uid, {
    amount: 45, currency: 'CNY', date: '2030-07-01', category_id: catId,
    description: 'svc-detail-full',
    item: { item_name: 'svc-detail-shampoo', unit_price: 45, quantity: 30, unit: 'ml' },
  });

  // Only an amount: recorded, but not comparable and not recognisable later.
  const vague = await createTransaction(db, uid, {
    amount: 9, currency: 'CNY', date: '2030-07-02', category_id: catId,
    description: 'svc-detail-vague',
  });

  const incomplete = await findTransactions(db, uid, { missing_detail: true, limit: 50 });
  const incompleteIds = incomplete.map(t => t.id);
  check('a bare amount counts as not detailed enough', incompleteIds.includes(vague.id),
        JSON.stringify(incompleteIds.slice(0, 5)));
  check('a named purchase with unit and quantity counts as detailed',
        !incompleteIds.includes(detailed.id));

  const complete = await findTransactions(db, uid, { missing_detail: false, limit: 50 });
  check('the reverse filter finds the well-recorded ones',
        complete.map(t => t.id).includes(detailed.id) &&
        !complete.map(t => t.id).includes(vague.id));

  const missingUnit = await findTransactions(db, uid, { missing_field: 'unit', limit: 50 });
  check('it can narrow to one missing field', missingUnit.map(t => t.id).includes(vague.id) &&
        !missingUnit.map(t => t.id).includes(detailed.id));

  const noDescription = await findTransactions(db, uid, { missing_field: 'description', limit: 50 });
  check('a missing description is a separate question from a missing size',
        Array.isArray(noDescription));

  const capped = await findTransactions(db, uid, { missing_detail: true, limit: 999 });
  check('the row cap still holds when filtering', capped.length <= 50, `got ${capped.length}`);

  console.log('\n=== the assistant is told the baseline and its duty ===');
  const baselinePrompt = (await buildPrompt(db, uid, 'x', { today: '2030-06-15', sessionId: S })).messages[0].content ?? '';
  check('the prompt states what "detailed enough" means',
        /names the product AND gives a unit and a quantity/i.test(baselinePrompt));
  check('the prompt says an amount alone is not enough',
        /The amount alone is not enough/i.test(baselinePrompt));
  check('the prompt tells it to ask rather than invent',
        /ask for the missing pieces/i.test(baselinePrompt) && /do not invent/i.test(baselinePrompt));
  check('the prompt forbids structurally impossible promises',
        /the current structure cannot express/i.test(baselinePrompt));

  // The tool has to expose the filter, or the prompt's instruction is unusable.
  const findDef = defs.find(d => d.function.name === 'find_transactions')!;
  const findProps = Object.keys((findDef.function.parameters as any).properties);
  check('find_transactions exposes the presence filter',
        findProps.includes('missing_detail') && findProps.includes('missing_field'),
        JSON.stringify(findProps));
  check('the filter is described as presence, not quality',
        /NOT detailed enough/i.test((findDef.function.parameters as any).properties.missing_detail.description));

  const badJson = await runTool(ctx, 'add_transaction', '{not json');
  check('malformed arguments are reported as INVALID_ARGUMENTS',
        badJson.ok === false && badJson.code === 'INVALID_ARGUMENTS', JSON.stringify(badJson));

  // An unmappable unit must NOT come back as an error. It used to, and the model's
  // recovery was to convert the unit — the wrong fix for the wrong signal.
  const unmappedTool = await runTool(ctx, 'log_price',
    JSON.stringify({ item: 'svc-tool-eggs', unit_price: 12, unit: '个' }));
  check('an unmappable unit is recorded rather than refused',
        unmappedTool.ok === true, JSON.stringify(unmappedTool));
  check('the tool result keeps the wording and leaves the code empty',
        (unmappedTool.data as any)?.unit === null && (unmappedTool.data as any)?.unit_raw === '个',
        JSON.stringify(unmappedTool.data));

  // A successful write through a tool must land as source='ai'.
  const added = await runTool(ctx, 'add_transaction', JSON.stringify({
    amount: 42, currency: 'CNY', date: '2030-06-15', category: 'svc-cat-root-expense',
    description: 'tool written', item: { name: 'svc-tool-item', unit_price: 21, quantity: 2, unit: 'piece' },
  }));
  check('add_transaction succeeds through the tool layer', added.ok === true, JSON.stringify(added));
  const toolTxId = (added.data as any)?.id;
  check('the tool wrote a transaction', typeof toolTxId === 'number', `got ${toolTxId}`);
  check('the tool write is marked as AI-sourced',
        raw.prepare('SELECT source FROM transactions WHERE id = ?').get(toolTxId).source === 'ai');
  check('the tool resolved the category by name',
        (added.data as any)?.category_id === expenseRoot.id,
        `got ${(added.data as any)?.category_id}`);
  check('the purchase also recorded a price',
        (raw.prepare('SELECT COUNT(*) c FROM item_prices WHERE transaction_id = ?').get(toolTxId) as any).c === 1);

  const summed = await runTool(ctx, 'summarize', JSON.stringify({
    group_by: 'category', date_from: '2030-06-15', date_to: '2030-06-15',
  }));
  check('summarize returns SQL-computed buckets', summed.ok === true &&
        Array.isArray((summed.data as any)?.buckets), JSON.stringify(summed).slice(0, 120));

  console.log('\n=== prompt: bounded no matter what ===');
  const built = await buildPrompt(db, uid, 'hello', { today: '2030-06-15', sessionId: S });
  const promptSize = built.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  check('the prompt stays inside the hard budget', promptSize <= PROMPT_CHAR_BUDGET,
        `${promptSize} > ${PROMPT_CHAR_BUDGET}`);
  check('the system prompt comes first', built.messages[0].role === 'system');
  check('the snapshot follows it', built.messages[1].role === 'system' &&
        (built.messages[1].content ?? '').includes('Today: 2030-06-15'));
  check('the user message is last', built.messages[built.messages.length - 1].content === 'hello');
  check('the snapshot carries the month total from SQL',
        (built.messages[1].content ?? '').includes('This month'));

  // The language rule lives in the system prompt AND as a per-turn directive
  // placed last. The directive is what actually fixed the reported bug: the
  // model was emitting its pre-tool-call line in English, and that line is
  // stored and replayed, so one wrong word polluted every later turn.
  console.log('\n=== language is pinned per turn ===');
  check('a Chinese message produces a Chinese directive',
        detectLanguage('我今天买了茶叶蛋') === 'Chinese', detectLanguage('我今天买了茶叶蛋'));
  check('an English message produces an English directive',
        detectLanguage('bought an egg today') === 'English', detectLanguage('bought an egg today'));
  check('digits alone fall back to English rather than guessing',
        detectLanguage('12345') === 'English', detectLanguage('12345'));

  const zhPrompt = await buildPrompt(db, uid, '午饭 15 块', { today: '2030-06-15', sessionId: S });
  const zhLast = zhPrompt.messages[zhPrompt.messages.length - 1];
  const zhDirective = zhPrompt.messages[zhPrompt.messages.length - 2];
  check('the user message is still the final turn', zhLast.role === 'user');
  check('the directive sits immediately before it', zhDirective.role === 'system');
  check('the directive names the language',
        (zhDirective.content ?? '').includes('Chinese'), zhDirective.content);
  check('the directive covers pre-tool-call lines, which is what broke',
        /before or between tool calls/i.test(zhDirective.content ?? ''));

  const enPrompt = await buildPrompt(db, uid, 'lunch was 15', { today: '2030-06-15', sessionId: S });
  check('an English turn gets an English directive',
        (enPrompt.messages[enPrompt.messages.length - 2].content ?? '').includes('English'));

  const sysText = zhPrompt.messages[0].content ?? '';
  check('the system prompt also forbids mixing languages',
        /Never mix two languages/i.test(sysText));
  check('the system prompt applies the rule from the first word',
        /from your first word/i.test(sysText));

  // Units: a size is recorded when one exists, and NEVER converted. Converting
  // was a real defect — the assistant turned "5 斤" into "5 kg" (2.5 kg in fact)
  // and wrote a wrong number into the very price history it later compares.
  console.log('\n=== the assistant can mark a day, so reminders can stop ===');
  // Without these tools the assistant could only agree in words when told
  // "I spent nothing that day", and the same day would be raised on every open.
  // The HTTP endpoint existed; the model had no way to reach it.
  const ledgerTools = ['mark_no_spend', 'mark_partial', 'gaps'];
  check('the ledger tools are registered',
        ledgerTools.every(t => defs.some(d => d.function.name === t)),
        JSON.stringify(defs.map(d => d.function.name).filter(n => /spend|partial|gaps/.test(n))));
  check('mark_no_spend takes a date',
        Object.keys((defs.find(d => d.function.name === 'mark_no_spend')!
          .function.parameters as any).properties).includes('date'));

  // A day with no transactions and no ledger row is what the check reports.
  const quietDay = '2031-03-05';
  const beforeMark = await findMissingDays(db, uid, '2031-03-06');
  check('an empty day starts out reported', beforeMark.some(m => m.date === quietDay),
        JSON.stringify(beforeMark.map(m => m.date)));

  const noSpend = await runTool(ctx, 'mark_no_spend', JSON.stringify({ date: quietDay }));
  check('the tool records it', noSpend.ok === true, JSON.stringify(noSpend));
  check('and it lands as no_spend',
        (raw.prepare('SELECT status FROM ledger_days WHERE user_id = ? AND date = ?')
          .get(uid, quietDay) as any)?.status === 'no_spend');

  const afterMark = await findMissingDays(db, uid, '2031-03-06');
  check('the day stops being reported', !afterMark.some(m => m.date === quietDay),
        JSON.stringify(afterMark.map(m => m.date)));

  // `partial` is the third state: recorded but not confirmed complete, so the
  // assistant should keep asking rather than treat the day as closed.
  const partialDay = '2031-03-04';
  const partial = await runTool(ctx, 'mark_partial', JSON.stringify({ date: partialDay }));
  check('mark_partial is accepted', partial.ok === true, JSON.stringify(partial));
  check('it stores the partial state',
        (raw.prepare('SELECT status FROM ledger_days WHERE user_id = ? AND date = ?')
          .get(uid, partialDay) as any)?.status === 'partial');

  // The gaps tool must agree with the snapshot the model is already given.
  const viaTool = await runTool(ctx, 'gaps', '{}');
  check('the gaps tool returns both checks',
        Array.isArray((viaTool.data as any)?.missing_days) &&
        Array.isArray((viaTool.data as any)?.overdue_subscriptions),
        JSON.stringify(viaTool.data).slice(0, 120));

  console.log('\n=== the assistant can merge two spellings of one shop ===');
  // R4 needs "永辉" and "永辉超市" to be one merchant or comparing them is
  // meaningless. The schema and the helper existed, but nothing called the
  // helper, so the alias table was dead and the two stayed separate shops.
  const resDef = defs.find(d => d.function.name === 'resolve_merchant');
  check('resolve_merchant is registered', resDef !== undefined);
  check('it can record an alias',
        Object.keys((resDef!.function.parameters as any).properties).includes('alias'));

  const merged = await runTool(ctx, 'resolve_merchant', JSON.stringify({
    name: 'svc-shop-full', alias: 'svc-shop-short',
  }));
  check('it resolves the shop',
        merged.ok === true && typeof (merged.data as any)?.merchant_id === 'number',
        JSON.stringify(merged));
  check('it reports the alias it recorded', (merged.data as any)?.alias_added === 'svc-shop-short',
        JSON.stringify(merged.data));

  const aliasRow = raw.prepare(
    'SELECT merchant_id FROM merchant_aliases WHERE user_id = ? AND alias = ?')
    .get(uid, 'svc-shop-short') as any;
  check('the alias is stored against that merchant',
        aliasRow?.merchant_id === (merged.data as any)?.merchant_id, JSON.stringify(aliasRow));

  // The point of the alias: a later price written under the short spelling must
  // resolve to the SAME merchant, so per-merchant comparison sees one shop.
  const viaAlias = await runTool(ctx, 'log_price', JSON.stringify({
    item: 'svc-shop-item', unit_price: 9, unit: 'piece', merchant: 'svc-shop-short',
  }));
  check('a price under the alias resolves to the same merchant',
        (viaAlias.data as any)?.merchant_id === (merged.data as any)?.merchant_id,
        `${(viaAlias.data as any)?.merchant_id} vs ${(merged.data as any)?.merchant_id}`);

  console.log('\n=== units: no conversion, and sizes only where they exist ===');
  check('the prompt forbids conversion outright', /NEVER convert between units/i.test(sysText));
  check('the prompt names the concrete trap', /5 斤 is not 5 kg/i.test(sysText));
  check('the prompt says to keep the number as given',
        /record their number and their wording exactly as given/i.test(sysText));
  check('the prompt asks for a size only where one exists',
        /has a size, so record it when the user gives it/i.test(sysText));
  check('the prompt names services as the exception',
        /have no unit, so record the amount and never ask for a size/i.test(sysText));

  // The tool description is read first and must not contradict the prompt.
  const logPriceDef = defs.find(d => d.function.name === 'log_price')!;
  check('log_price also says not to convert',
        /NEVER convert a unit/i.test(logPriceDef.function.description));
  const addTxDef = defs.find(d => d.function.name === 'add_transaction')!;
  const itemRawDesc = (addTxDef.function.parameters as any).properties.item
    .properties.unit_raw.description as string;
  check('add_transaction says the wording is never converted',
        /never convert/i.test(itemRawDesc), itemRawDesc);

  // And the storage layer must already behave that way, with no prompt involved.
  const jin = await logPrice(db, uid, {
    item_name: 'svc-jin-apples', unit_price: 30, quantity: 5, unit: '斤', unit_raw: '斤',
  });
  check('an unrecognised unit is stored with no code', jin.unit === null, `unit=${jin.unit}`);
  check('its wording is preserved verbatim', jin.unit_raw === '斤', `unit_raw=${jin.unit_raw}`);
  check('its quantity is kept as stated', jin.quantity === 5, `quantity=${jin.quantity}`);
  check('its price is not converted', jin.unit_price === 30, `unit_price=${jin.unit_price}`);

  const jinAsKg = await priceBreakdown(db, uid, jin.item_id, 'kg');
  check('it is not counted as kg', jinAsKg.comparable === null,
        JSON.stringify(jinAsKg.comparable?.unit));
  check('it lands among the un-normalisable rows instead',
        jinAsKg.without_unit?.count === 1, JSON.stringify(jinAsKg.without_unit?.count));


  // A pathological transcript must not blow the budget: the group clamp is what
  // makes "recent N" a character budget rather than a count. This mirrors what
  // buildPrompt does (`groupMessages` then `takeNewestGroups`), so the tests and
  // production exercise the same path.
  const clamp = (msgs: any[], budget: number) =>
    takeNewestGroups(groupMessages(msgs), budget).flat();
  const huge: any[] = [];
  for (let i = 0; i < 20; i++) {
    huge.push({ id: i, user_id: uid, role: 'user', content: 'x'.repeat(2000), tool_calls: null, tokens_in: 0, tokens_out: 0, created_at: '' });
  }
  const clamped = clamp(huge, 5000);
  const clampedSize = clamped.reduce((n, m) => n + m.content.length, 0);
  check('the clamp keeps the newest turns inside the budget', clampedSize <= 5000,
        `got ${clampedSize}`);
  check('the clamp drops from the oldest end', clamped.length < huge.length,
        `${clamped.length} of ${huge.length}`);
  check('the clamp keeps the newest message', clamped[clamped.length - 1].id === 19);

  // ---------------------------------------------------------------------------
  // Production regression, 2026-10-09: the character clamp cut a tool-call pair
  // in half.
  //
  // The real transcript of session 9588e4f3… came to 9231 characters against the
  // 8000 budget. Walking back from the newest turn, the budget ran out between
  // an assistant turn that requested two tools and the results answering them,
  // so the window began with a `tool` row. DeepSeek answered:
  //
  //   AI provider error (400): Messages with role 'tool' must be a response to a
  //   preceding message with 'tool_calls'
  //
  // The shapes and sizes below are the production ones (7877-character
  // list_categories result and all), so this test fails on the old clamp: it
  // kept ids 20..23 and dropped 18, 19 — leaving 20, a bare tool result, first.
  // ---------------------------------------------------------------------------
  const call = (id: string) => ({
    id, type: 'function', function: { name: 'list_categories', arguments: '{}' },
  });
  const row = (id: number, role: string, content: string | null, toolCalls: any = null) => ({
    id, user_id: uid, session_id: S, role, content,
    tool_calls: toolCalls ? JSON.stringify(toolCalls) : null,
    tokens_in: 0, tokens_out: 0, created_at: '',
  });

  // Every `tool` message must answer a call declared by the assistant turn that
  // immediately precedes its run, and every call must be answered exactly once.
  const replayable = (msgs: any[], idOf: (m: any) => string | null): boolean => {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== 'tool') continue;
      let start = i;
      while (start > 0 && msgs[start - 1].role === 'tool') start -= 1;
      const request = msgs[start - 1];
      if (!request || request.role !== 'assistant') return false;
      const declared: string[] = (request.tool_calls ?? []).map((c: any) => c.id);
      if (declared.length === 0) return false;
      const answered = new Set<string>();
      for (let k = start; k < msgs.length && msgs[k].role === 'tool'; k++) {
        const id = idOf(msgs[k]);
        if (id) answered.add(id);
      }
      if (answered.size !== declared.length) return false;
      if (!declared.every((id) => answered.has(id))) return false;
    }
    return true;
  };
  const storedId = (m: any) => {
    try { return JSON.parse(m.tool_calls ?? '{}').tool_call_id ?? null; } catch { return null; }
  };

  const productionShape = [
    row(17, 'user', '今天买AI token花了50'),
    row(18, 'assistant', null, [call('A'), call('B')]),
    row(19, 'tool', 'x'.repeat(7877), toolCallIdPayload('A', 'list_categories')),
    row(20, 'tool', 'unit vocabulary…', toolCallIdPayload('B', 'list_units')),
    row(21, 'assistant', null, [call('C')]),
    row(22, 'tool', '{"id":490,…}', toolCallIdPayload('C', 'add_transaction')),
    row(23, 'assistant', '已记下：今天 AI token 50 元，归到「编程」类别。'),
  ];
  const productionClamped = clamp(productionShape, 8000);
  const productionShapeDesc = JSON.stringify(productionClamped.map((m) => `${m.id}:${m.role}`));
  check('a clamped transcript never starts with a tool result',
        productionClamped.length > 0 && productionClamped[0].role !== 'tool', productionShapeDesc);
  check('a clamped transcript keeps every call with all of its results',
        replayable(productionClamped, storedId), productionShapeDesc);
  check('the newest turn survives the clamp',
        productionClamped[productionClamped.length - 1].id === 23, productionShapeDesc);

  // A transcript already damaged in storage heals rather than 400-ing the next
  // turn: a result nothing declares, and a call answered only in part (a write
  // interrupted between the two rows).
  const orphanResult = [
    row(1, 'assistant', 'an earlier answer'),
    row(2, 'tool', 'nothing declares this call', toolCallIdPayload('gone', 'list_units')),
  ];
  const healed = clamp(orphanResult, 8000);
  check('a tool result nothing declares is dropped',
        healed.length === 1 && healed[0].role === 'assistant',
        JSON.stringify(healed.map((m) => `${m.id}:${m.role}`)));

  const halfAnswered = [
    row(1, 'user', 'hi'),
    row(2, 'assistant', null, [call('A'), call('B')]),
    row(3, 'tool', 'only one of the two', toolCallIdPayload('A', 'list_categories')),
  ];
  const halfKept = clamp(halfAnswered, 8000);
  check('a call answered only in part is dropped, results and all',
        halfKept.length === 1 && halfKept[0].id === 1,
        JSON.stringify(halfKept.map((m) => `${m.id}:${m.role}`)));

  // The whole-prompt clamp has the same duty, and one more: it used to
  // `splice(2, 1)` single messages, which could also eat the language directive
  // that sits immediately before the user's own message.
  const clampSession = 'svc-clamp-session';
  await recordMessage(db, uid, { session_id: clampSession, role: 'user', content: 'first question' });
  await recordMessage(db, uid, {
    session_id: clampSession, role: 'assistant', content: null,
    tool_calls: JSON.stringify([call('D')]),
  });
  await recordMessage(db, uid, {
    session_id: clampSession, role: 'tool', content: 'y'.repeat(9000),
    tool_calls: toolCallIdPayload('D', 'list_categories'),
  });
  await recordMessage(db, uid, { session_id: clampSession, role: 'assistant', content: 'first answer' });
  await recordMessage(db, uid, { session_id: clampSession, role: 'user', content: 'second question' });

  const clampedPrompt = await buildPrompt(db as any, uid, 'third question', {
    sessionId: clampSession, today: '2030-06-15',
  });
  const roles = JSON.stringify(clampedPrompt.messages.map((m) => m.role));
  check('the user message is still last after clamping',
        clampedPrompt.messages[clampedPrompt.messages.length - 1].content === 'third question', roles);
  check('the language directive survives the clamp',
        clampedPrompt.messages[clampedPrompt.messages.length - 2].role === 'system' &&
        /Reply entirely in/.test(clampedPrompt.messages[clampedPrompt.messages.length - 2].content ?? ''),
        JSON.stringify(clampedPrompt.messages[clampedPrompt.messages.length - 2]));
  check('the assembled prompt is a transcript the provider accepts',
        replayable(clampedPrompt.messages, (m) => m.tool_call_id ?? null), roles);
  check('the oversized transcript was reported as clamped',
        clampedPrompt.transcriptClamped === true, `${clampedPrompt.transcriptClamped}`);

  console.log('\n=== chat: the tool-calling loop ===');
  // Canned provider: round 1 asks for a write, round 2 answers in words.
  let round = 0;
  const seenMessages: any[][] = [];
  const fakeCompletion = async (messages: any[]): Promise<ChatResult> => {
    seenMessages.push(JSON.parse(JSON.stringify(messages)));
    round += 1;
    if (round === 1) {
      return {
        content: null,
        tool_calls: [{
          id: 'call_1', type: 'function',
          function: {
            name: 'add_transaction',
            arguments: JSON.stringify({
              amount: 18, currency: 'CNY', date: '2030-06-15',
              category: 'svc-cat-root-expense', description: 'lunch',
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        finish_reason: 'tool_calls',
        model: 'fake',
      };
    }
    return {
      content: 'Logged lunch, 18 CNY.',
      tool_calls: [],
      usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 },
      finish_reason: 'stop',
      model: 'fake',
    };
  };

  const turn = await runChatTurn({
    env: { DB: db } as any, userId: uid, sessionId: S, message: 'lunch was 18', today: '2030-06-15',
    completion: fakeCompletion,
  });

  check('the loop returns the final text', turn.reply === 'Logged lunch, 18 CNY.',
        JSON.stringify(turn.reply));
  check('the loop ran two provider rounds', turn.usage.rounds === 2, `got ${turn.usage.rounds}`);
  check('token usage is summed across rounds',
        turn.usage.tokens_in === 250 && turn.usage.tokens_out === 30,
        JSON.stringify(turn.usage));
  check('the write is reported', turn.writes.length === 1 && turn.writes[0].tool === 'add_transaction',
        JSON.stringify(turn.writes));
  check('the write succeeded', turn.writes[0].ok === true);
  check('the turn is not marked truncated', turn.truncated === false);

  // The second round must have been sent the tool result, or the provider would
  // reject the transcript.
  const secondRound = seenMessages[1];
  check('the second round includes a tool result',
        secondRound.some((m: any) => m.role === 'tool'), JSON.stringify(secondRound.map((m: any) => m.role)));
  check('the tool result carries its call id',
        secondRound.some((m: any) => m.role === 'tool' && m.tool_call_id === 'call_1'));
  check('the assistant tool_calls turn precedes it',
        secondRound.some((m: any) => m.role === 'assistant' && Array.isArray(m.tool_calls)));

  const stored = raw.prepare(
    "SELECT role, content, tool_calls FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT 4"
  ).all(uid) as any[];
  check('the user turn was stored', stored.some(m => m.role === 'user' && m.content === 'lunch was 18'));
  check('the tool-call turn stored null content, not an empty string',
        stored.some(m => m.role === 'assistant' && m.tool_calls && m.content === null));
  check('the tool result stored its call id',
        stored.some(m => m.role === 'tool' && JSON.parse(m.tool_calls ?? '{}').tool_call_id === 'call_1'));

  console.log('\n=== chat: a failing tool is reported, not thrown ===');
  let badRound = 0;
  const failingCompletion = async (): Promise<ChatResult> => {
    badRound += 1;
    if (badRound === 1) {
      return {
        content: null,
        tool_calls: [{
          id: 'call_bad', type: 'function',
          // A category that does not exist: a genuine refusal, unlike an
          // unmappable unit, which is now recorded rather than rejected.
          function: { name: 'add_transaction', arguments: JSON.stringify({
            amount: 1, currency: 'CNY', date: '2030-06-15', category: 'no-such-category',
          }) },
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        finish_reason: 'tool_calls', model: 'fake',
      };
    }
    return {
      content: '那个单位我没法记，请换个说法。', tool_calls: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      finish_reason: 'stop', model: 'fake',
    };
  };

  const failed = await runChatTurn({
    env: { DB: db } as any, userId: uid, sessionId: S, message: 'eggs 1 each', today: '2030-06-15',
    completion: failingCompletion,
  });
  check('a failing tool does not break the turn', typeof failed.reply === 'string',
        JSON.stringify(failed.reply));
  check('the failure is reported, not thrown',
        failed.writes[0]?.ok === false, JSON.stringify(failed.writes));
  check('the failure carries a message the model could act on',
        typeof failed.writes[0]?.error === 'string' && failed.writes[0].error.length > 0,
        JSON.stringify(failed.writes[0]));

  console.log('\n=== chat: the round limit bounds a runaway turn ===');
  const loopCompletion = async (): Promise<ChatResult> => ({
    content: null,
    tool_calls: [{
      id: 'call_loop', type: 'function',
      function: { name: 'recall', arguments: '{}' },
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    finish_reason: 'tool_calls', model: 'fake',
  });
  const looped = await runChatTurn({
    env: { DB: db } as any, userId: uid, sessionId: S, message: 'loop', today: '2030-06-15',
    completion: loopCompletion,
  });
  check('a model that only requests tools is stopped', looped.truncated === true);
  check('the round count is capped', looped.usage.rounds <= MAX_TOOL_ROUNDS + 1,
        `got ${looped.usage.rounds}`);
  check('every round is still accounted for in tokens', looped.usage.tokens_in > 0,
        JSON.stringify(looped.usage));

  console.log('\n=== chat: unavailable without a key (R6) ===');
  const before503 = (raw.prepare(
    'SELECT COUNT(*) c FROM ai_messages WHERE user_id = ?').get(uid) as any).c;
  const noKey = await expectServiceError(() => runChatTurn({
    env: { DB: db } as any, userId: uid, sessionId: S, message: '午饭 18',
  }));
  check('an unconfigured AI layer reports 503, not a crash', noKey === 503, `status ${noKey}`);
  // The message the user typed must survive the failure: otherwise it is
  // silently lost, which is worse than the feature being unavailable.
  const after503 = (raw.prepare(
    'SELECT COUNT(*) c FROM ai_messages WHERE user_id = ?').get(uid) as any).c;
  check('the user message is stored even when the provider is unavailable',
        after503 === before503 + 1, `${before503} -> ${after503}`);
  check('the stored turn is the one that was typed',
        (raw.prepare(
          "SELECT content FROM ai_messages WHERE user_id = ? ORDER BY id DESC LIMIT 1"
        ).get(uid) as any).content === '午饭 18');

  console.log('\n=== opening turn: reminders come from SQL, not the model ===');
  let openingInstruction = '';
  const openingCompletion = async (messages: any[]): Promise<ChatResult> => {
    openingInstruction = messages[messages.length - 1].content;
    return {
      content: '你 6 月 14 日好像没记账，要补吗？', tool_calls: [],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      finish_reason: 'stop', model: 'fake',
    };
  };
  const beforeCount = (raw.prepare('SELECT COUNT(*) c FROM ai_messages WHERE user_id = ?').get(uid) as any).c;
  const opening = await runOpeningTurn({
    env: { DB: db } as any, userId: uid, sessionId: S, message: '', today: '2030-06-15',
    completion: openingCompletion,
  });
  check('the opening turn replies', typeof opening.reply === 'string', JSON.stringify(opening.reply));
  // 2030-06-13 is still open at this point: 06-14 was marked partial and
  // 06-12 was spent on earlier in this suite, so only 06-13 remains a gap.
  check('the instruction carries the SQL-computed missing day',
        openingInstruction.includes('2030-06-13'), openingInstruction.slice(0, 160));
  check('the instruction does not include today',
        !openingInstruction.includes('2030-06-15'), openingInstruction.slice(0, 160));
  const afterCount = (raw.prepare('SELECT COUNT(*) c FROM ai_messages WHERE user_id = ?').get(uid) as any).c;
  // One assistant message is added; crucially, no synthetic user turn is.
  check('the synthetic instruction is not stored as a user message',
        (raw.prepare(
          "SELECT COUNT(*) c FROM ai_messages WHERE user_id = ? AND role = 'user' AND content LIKE 'Open the conversation%'"
        ).get(uid) as any).c === 0);
  check('the opening turn still records its reply', afterCount === beforeCount + 1,
        `${beforeCount} -> ${afterCount}`);

  raw.close();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${checks - failures.length} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
