/**
 * Exercise the write paths (POST/PUT/DELETE) through the real handlers against
 * a copy of the staging database, and check the resulting rows.
 *
 * The read paths are covered by api_capture.ts + api_diff.py, but nothing
 * exercised writes, and writes are where the item_prices bookkeeping lives.
 *
 *   npx esbuild scripts/api_write_test.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/.build/api_write_test.mjs
 *   node scripts/.build/api_write_test.mjs <source.sqlite>
 *
 * The source is copied first; the original is never modified.
 */

import { copyFileSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sign } from 'hono/jwt';
import app from '../src/index';

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
        // A statement yields rows when it is a query OR uses RETURNING. The
        // handlers rely on `INSERT ... RETURNING *` through .first(), so
        // treating only SELECT as row-returning made every create look failed.
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

async function main() {
  const src = process.argv[2];
  if (!src) { console.error('usage: api_write_test.mjs <source.sqlite>'); process.exit(2); }
  const work = '/tmp/api_write_test.sqlite';
  try { unlinkSync(work); } catch { /* absent */ }
  copyFileSync(src, work);

  const raw = new DatabaseSync(work);
  raw.exec('PRAGMA foreign_keys = ON');
  const uid = raw.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id as number;
  const secret = process.env.JWT_SECRET || 'write-test-secret';
  const token = await sign(
    { sub: uid, email: 'w@local', username: 'w', exp: Math.floor(Date.now() / 1000) + 3600 },
    secret,
  );
  const env = { DB: new D1Shim(raw), JWT_SECRET: secret, EXCHANGE_RATE_CACHE_HOURS: '24', OPEN_EXCHANGE_RATES_API_KEY: 'x' };

  const call = async (method: string, path: string, body?: any) => {
    const res = await app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env as any);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 200) }; }
    return { status: res.status, body: json };
  };

  const priceRows = (txId: number) =>
    raw.prepare('SELECT * FROM item_prices WHERE transaction_id = ?').all(txId);
  const tx = (id: number) =>
    raw.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as any;

  // A fresh database (db/schema.sql) has no categories at all, so the test has
  // to be able to create its own. That also exercises the empty-install path.
  let catRow = raw.prepare(
    "SELECT c.id FROM categories c WHERE c.user_id = ? AND c.type = 'expense' LIMIT 1").get(uid) as any;
  if (!catRow) {
    const created = await call('POST', '/api/v1/categories', { name: 'write-test-base', type: 'expense' });
    check('bootstrap category created on an empty database',
          created.status === 201 || created.status === 200, `status ${created.status}`);
    catRow = raw.prepare(
      "SELECT c.id FROM categories c WHERE c.user_id = ? AND c.type = 'expense' LIMIT 1").get(uid) as any;
  }
  const catId = catRow.id;

  console.log('=== POST /transactions: amount only (no item) ===');
  let r = await call('POST', '/api/v1/transactions', {
    amount: 23.5, currency: 'CNY', date: '2026-10-09', category_id: catId, description: 'write test A',
  });
  check('created', r.status === 201, `status ${r.status}`);
  const txA = r.body;
  check('amount round-trips as 23.5', txA.amount === 23.5, `got ${txA.amount}`);
  check('stored as 2350 cents', tx(txA.id).amount_cents === 2350, `got ${tx(txA.id).amount_cents}`);
  check('no price row without an item', priceRows(txA.id).length === 0);
  check('item_name key present and null', 'item_name' in txA && txA.item_name === null);
  check('unit_price null', txA.unit_price === null);

  console.log('\n=== POST /transactions: new item + unit price ===');
  r = await call('POST', '/api/v1/transactions', {
    amount: 86, currency: 'CNY', date: '2026-10-09', category_id: catId,
    item_name: 'write-test-eggs', unit_price: 12.8, quantity: 6, unit: 'piece',
  });
  check('created', r.status === 201, `status ${r.status}`);
  const txB = r.body;
  check('unit_price 12.8 echoed', txB.unit_price === 12.8, `got ${txB.unit_price}`);
  check('quantity 6 echoed', txB.quantity === 6, `got ${txB.quantity}`);
  check('unit piece echoed', txB.unit === 'piece', `got ${txB.unit}`);
  check('item_id set', typeof txB.item_id === 'number', `got ${txB.item_id}`);
  const rowsB = priceRows(txB.id);
  check('exactly one price row', rowsB.length === 1, `got ${rowsB.length}`);
  if (rowsB.length === 1) {
    check('unit_price_cents 1280', rowsB[0].unit_price_cents === 1280, `got ${rowsB[0].unit_price_cents}`);
    check('price row points at the item', rowsB[0].item_id === txB.item_id);
  }

  console.log('\n=== PUT: change amount only (price untouched) ===');
  r = await call('PUT', `/api/v1/transactions/${txB.id}`, { amount: 90 });
  check('ok', r.status === 200, `status ${r.status}`);
  check('amount 90 echoed', r.body.amount === 90, `got ${r.body.amount}`);
  check('stored 9000 cents', tx(txB.id).amount_cents === 9000);
  check('price row still exactly one', priceRows(txB.id).length === 1);
  check('unit_price unchanged (1280)', priceRows(txB.id)[0]?.unit_price_cents === 1280,
        `got ${priceRows(txB.id)[0]?.unit_price_cents}`);

  console.log('\n=== PUT: change unit price only ===');
  r = await call('PUT', `/api/v1/transactions/${txB.id}`, { unit_price: 15 });
  check('ok', r.status === 200, `status ${r.status}`);
  check('unit_price 15 echoed', r.body.unit_price === 15, `got ${r.body.unit_price}`);
  check('price row updated in place', priceRows(txB.id).length === 1);
  check('unit_price_cents 1500', priceRows(txB.id)[0]?.unit_price_cents === 1500,
        `got ${priceRows(txB.id)[0]?.unit_price_cents}`);
  check('item link kept', priceRows(txB.id)[0]?.item_id === txB.item_id);

  console.log('\n=== PUT: clear the item link ===');
  r = await call('PUT', `/api/v1/transactions/${txB.id}`, { item_name: '' });
  check('ok', r.status === 200, `status ${r.status}`);
  check('item_id null now', r.body.item_id === null, `got ${r.body.item_id}`);
  check('price row removed with the link', priceRows(txB.id).length === 0,
        `got ${priceRows(txB.id).length}`);

  console.log('\n=== PUT: attach an item to a transaction that had none ===');
  r = await call('PUT', `/api/v1/transactions/${txA.id}`, { item_name: 'write-test-eggs' });
  check('ok', r.status === 200, `status ${r.status}`);
  check('item attached', typeof r.body.item_id === 'number', `got ${r.body.item_id}`);
  const rowsA = priceRows(txA.id);
  check('one price row created', rowsA.length === 1, `got ${rowsA.length}`);
  check('price derived from the amount (2350)',
        rowsA[0]?.unit_price_cents === 2350, `got ${rowsA[0]?.unit_price_cents}`);

  console.log('\n=== DELETE /transactions/:id ===');
  const txAItem = txA.item_id;
  const priceIdsBefore = (raw.prepare(
    'SELECT id FROM item_prices WHERE item_id = ?').all(txAItem) as any[]).map((r) => r.id);
  r = await call('DELETE', `/api/v1/transactions/${txA.id}`);
  check('ok', r.status === 200, `status ${r.status}`);
  check('transaction gone', tx(txA.id) === undefined);
  // Assert by row id, not by `transaction_id = ?`: ON DELETE SET NULL would
  // make the orphaned row invisible to that query while still existing.
  const priceIdsAfter = (raw.prepare(
    'SELECT id FROM item_prices WHERE item_id = ?').all(txAItem) as any[]).map((r) => r.id);
  const orphans = priceIdsBefore.filter((id) => priceIdsAfter.includes(id));
  check('its price row is deleted, not orphaned', orphans.length === 0,
        `still present: ${orphans}`);

  console.log('\n=== categories: delete a category still in use ===');
  r = await call('DELETE', `/api/v1/categories/${catId}`);
  check('refused with 409', r.status === 409, `status ${r.status}`);
  check('reports CATEGORY_IN_USE', r.body.code === 'CATEGORY_IN_USE', JSON.stringify(r.body).slice(0, 120));
  check('category still exists',
        raw.prepare('SELECT id FROM categories WHERE id = ?').get(catId) !== undefined);
  check('its transactions still exist', r.body.transaction_count > 0, `count ${r.body.transaction_count}`);

  console.log('\n=== categories: delete an unused category ===');
  const newCat = await call('POST', '/api/v1/categories', { name: 'write-test-empty', type: 'expense' });
  check('created', newCat.status === 201 || newCat.status === 200, `status ${newCat.status}`);
  const emptyCatId = newCat.body.id;
  r = await call('DELETE', `/api/v1/categories/${emptyCatId}`);
  check('deleted with 200', r.status === 200, `status ${r.status}`);

  console.log('\n=== categories: duplicate top-level name is rejected ===');
  // v1 relied on UNIQUE(name, parent_id, user_id), which SQLite does not
  // enforce for NULL parent_id, so top-level duplicates used to be storable.
  // v2 uses an expression index over COALESCE(parent_id, 0).
  const dupName = `write-test-dup-${Date.now()}`;
  const first = await call('POST', '/api/v1/categories', { name: dupName, type: 'expense' });
  check('first created', first.status === 201 || first.status === 200, `status ${first.status}`);
  r = await call('POST', '/api/v1/categories', { name: dupName, type: 'expense' });
  check('duplicate refused with 409', r.status === 409, `status ${r.status} body ${JSON.stringify(r.body).slice(0, 90)}`);

  console.log('\n=== categories: parent whose CHILD has transactions ===');
  // The parent itself has no transactions, so the explicit count check passes
  // and the delete relies on the child's RESTRICT to refuse it.
  const parent = await call('POST', '/api/v1/categories', {
    name: `write-test-parent-${Date.now()}`, type: 'expense' });
  check('parent created', parent.status === 201 || parent.status === 200, `status ${parent.status}`);
  const child = await call('POST', '/api/v1/categories', {
    name: `write-test-child-${Date.now()}`, type: 'expense', parent_id: parent.body.id });
  check('child created', child.status === 201 || child.status === 200, `status ${child.status}`);
  const childTx = await call('POST', '/api/v1/transactions', {
    amount: 1, currency: 'CNY', date: '2026-10-09', category_id: child.body.id });
  check('transaction in the child created', childTx.status === 201, `status ${childTx.status}`);
  r = await call('DELETE', `/api/v1/categories/${parent.body.id}`);
  check('parent refused with 409 (child still referenced)',
        r.status === 409, `status ${r.status} body ${JSON.stringify(r.body).slice(0, 90)}`);
  check('parent still exists',
        raw.prepare('SELECT id FROM categories WHERE id = ?').get(parent.body.id) !== undefined);
  check('the child transaction still exists',
        raw.prepare('SELECT id FROM transactions WHERE id = ?').get(childTx.body.id) !== undefined);

  console.log('\n=== DELETE /items/:id removes its price history ===');
  // item_prices.item_id is ON DELETE CASCADE, so deleting an item now also
  // deletes every price observation recorded against it. In v1 the price lived
  // on the transaction, so deleting an item only cleared the tag and the
  // transaction kept its amount and price columns. This is a deliberate
  // simplification — the price is the item's history and is meaningless without
  // it — but it is a behaviour change and is pinned down here.
  const delItem = await call('POST', '/api/v1/items', { name: `write-test-del-${Date.now()}` });
  check('item created', delItem.status === 201 || delItem.status === 200, `status ${delItem.status}`);
  const delItemId = delItem.body.id;
  const delTx = await call('POST', '/api/v1/transactions', {
    amount: 12, currency: 'CNY', date: '2026-10-09', category_id: catId,
    item_id: delItemId, unit_price: 3, quantity: 4, unit: 'piece',
  });
  check('transaction with a price created', delTx.status === 201, `status ${delTx.status}`);
  const rowsBefore = raw.prepare('SELECT id FROM item_prices WHERE item_id = ?').all(delItemId) as any[];
  check('item has one price row', rowsBefore.length === 1, `got ${rowsBefore.length}`);

  r = await call('DELETE', `/api/v1/items/${delItemId}`);
  check('item deleted', r.status === 200, `status ${r.status}`);
  const rowsAfter = raw.prepare('SELECT id FROM item_prices WHERE item_id = ?').all(delItemId) as any[];
  check('its price rows are gone (cascade)', rowsAfter.length === 0, `got ${rowsAfter.length}`);
  check('the transaction itself survives (only the link goes)',
        raw.prepare('SELECT id FROM transactions WHERE id = ?').get(delTx.body.id) !== undefined);

  console.log('\n=== cross-user isolation ===');
  // Both users exist in the real data. A token for one must not read or write
  // the other's rows.
  const other = raw.prepare('SELECT id FROM users WHERE id != ? ORDER BY id LIMIT 1').get(uid) as any;
  if (!other) {
    console.log('  (only one user in this database — skipped)');
  } else {
    const otherToken = await sign(
      { sub: other.id, email: 'o@local', username: 'o', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    const asOther = async (method: string, path: string, body?: any) => {
      const res = await app.request(path, {
        method,
        headers: { Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }, env as any);
      const t = await res.text();
      let j: any; try { j = JSON.parse(t); } catch { j = { __raw: t.slice(0, 120) }; }
      return { status: res.status, body: j };
    };

    // A price row owned by `uid`, addressed by its own transaction.
    const mine = raw.prepare(
      'SELECT transaction_id FROM item_prices WHERE user_id = ? AND transaction_id IS NOT NULL LIMIT 1'
    ).get(uid) as any;

    const list = await asOther('GET', '/api/v1/prices');
    check('other user sees none of my prices',
          list.status === 200 && Array.isArray(list.body) &&
          list.body.every((p: any) => p.user_id === other.id),
          `status ${list.status}, rows ${Array.isArray(list.body) ? list.body.length : 'n/a'}`);

    if (mine) {
      const t = await asOther('GET', `/api/v1/transactions/${mine.transaction_id}`);
      check("other user cannot read my transaction", t.status === 404, `status ${t.status}`);
      const d = await asOther('DELETE', `/api/v1/transactions/${mine.transaction_id}`);
      check("other user cannot delete my transaction", d.status === 404, `status ${d.status}`);
      check('my transaction still exists',
            raw.prepare('SELECT id FROM transactions WHERE id = ?').get(mine.transaction_id) !== undefined);
    }

    const item = raw.prepare('SELECT id FROM items WHERE user_id = ? LIMIT 1').get(uid) as any;
    if (item) {
      const h = await asOther('GET', `/api/v1/items/${item.id}/history`);
      check("other user cannot read my item history", h.status === 404, `status ${h.status}`);
      const p = await asOther('POST', '/api/v1/prices', { item_id: item.id, unit_price: 1 });
      check("other user cannot log a price against my item", p.status === 404, `status ${p.status}`);
    }
  }

  raw.close();
  try { unlinkSync(work); } catch { /* ignore */ }

  console.log('\n' + '='.repeat(60));
  console.log(`RESULT: ${checks - failures.length} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(failures.length ? 1 : 0);
}

await main();
