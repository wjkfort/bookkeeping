/**
 * Capture real API responses from the actual Worker handlers, run against a
 * chosen database file.
 *
 * `wrangler dev` cannot be used for this here: it insists on writing its global
 * registry under ~/Library/Preferences, which the sandbox denies. Instead this
 * imports the Hono app directly and calls `app.request()`, with a D1-compatible
 * shim over node:sqlite. That exercises the real routes, the real SQL and the
 * real serialisation — only the D1 transport is replaced.
 *
 * Bundled with esbuild (already a dev dependency) because Node cannot import
 * TypeScript directly:
 *   npx esbuild scripts/api_capture.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/.build/api_capture.mjs
 *   node scripts/.build/api_capture.mjs <db.sqlite> > capture.json
 *
 * JWT_SECRET is read from .dev.vars; tokens are minted here rather than logging
 * in, so no password is involved.
 */

import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sign } from 'hono/jwt';
import app from '../src/index';

// Applied at module load, before any handler can fetch.
//
// The summary endpoints convert to a target currency, and the cached rates in
// the fixture databases are older than the 24h cache window, so the handlers
// try to refresh them from the live exchange-rate API. That must not happen
// during a capture: it would depend on the network and on a real key, and the
// two databases must see identical rates for the comparison to mean anything.
// So the refresh is answered from a fixed in-memory payload instead.
const realFetch = globalThis.fetch;
const SYNTHETIC_RATES: Record<string, number> = { USD: 1, CNY: 7.25 };
globalThis.fetch = ((input: any, init?: any) => {
  if ((globalThis as any).__dshNoNetwork) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ rates: SYNTHETIC_RATES }),
      text: async () => JSON.stringify({ rates: SYNTHETIC_RATES }),
    });
  }
  return realFetch(input, init);
}) as any;

/** Minimal D1Database over node:sqlite: prepare/bind/first/all/run/batch. */
class D1Shim {
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string) {
    return shimStatement(this.db, sql);
  }

  async batch(statements: any[]) {
    const out = [];
    for (const s of statements) out.push(await s);
    return out;
  }
}

function shimStatement(db: any, sql: string) {
  const make = (bound: any[]) => {
    const run = () => {
      const stmt = db.prepare(sql);
      const args = bound.map((v: any) => (v === undefined ? null : v));
      try {
        // Rows come back from queries and from anything using RETURNING, which
        // the handlers rely on via .first() after INSERT.
        const isQuery = /^\s*(select|with|pragma)/i.test(sql);
        if (isQuery || /\breturning\b/i.test(sql)) {
          const results = stmt.all(...args);
          if (isQuery) return { results };
          let meta = { changes: results.length, last_row_id: 0 };
          try {
            const info = stmt.run(...args);
            meta = { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) };
          } catch { /* RETURNING already executed the statement */ }
          return { results, success: true, meta };
        }
        const info = stmt.run(...args);
        return {
          success: true,
          meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
        };
      } catch (e: any) {
        throw new Error(`${e.message} [sql: ${sql.replace(/\s+/g, ' ').slice(0, 160)}]`);
      } finally {
        try { stmt.finalize?.(); } catch { /* already finalized */ }
      }
    };
    return {
      bind: (...args: any[]) => make(args),
      first: async () => run().results?.[0] ?? null,
      all: async () => run(),
      run: async () => run(),
    };
  };
  return make([]);
}

function jwtSecret() {
  // Resolved from the working directory, not import.meta.url: the esbuild
  // bundle lives in scripts/.build/, so a relative import path would not
  // reach the repo root. Run this from backend-ts/ like the other scripts.
  const raw = readFileSync('.dev.vars', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*JWT_SECRET\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('JWT_SECRET not found in .dev.vars');
}

async function main() {
  const dbPath = process.argv[2];
  if (!dbPath) {
    console.error('usage: api_capture.mjs <path/to/database.sqlite>');
    process.exit(2);
  }

  const secret = jwtSecret();
  const env = {
    DB: new D1Shim(dbPath),
    JWT_SECRET: secret,
    EXCHANGE_RATE_CACHE_HOURS: '24',
    OPEN_EXCHANGE_RATES_API_KEY: 'unused-in-capture',
  };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const userIds = db.prepare('SELECT id FROM users ORDER BY id').all().map((r: any) => r.id);
  const items = db.prepare('SELECT id, user_id FROM items ORDER BY id').all() as any[];
  const txs = db.prepare('SELECT id, user_id FROM transactions ORDER BY id').all() as any[];
  db.close();

  // No outbound network during a capture: the fetch patch above serves a fixed
  // rate payload instead of calling the live API.
  (globalThis as any).__dshNoNetwork = true;

  const out: any = { db: dbPath, responses: {} };

  for (const uid of userIds) {
    const token = await sign(
      { sub: uid, email: `u${uid}@local`, username: `u${uid}`,
        exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    const prefix = `user${uid}`;
    const paths = [
      '/api/v1/summary',
      '/api/v1/summary/monthly',
      '/api/v1/summary/by-category?level=leaf',
      '/api/v1/summary/by-category?level=parent',
      '/api/v1/items?with_stats=true',
      '/api/v1/subscriptions',
      '/api/v1/transactions?limit=100',
      '/api/v1/categories',
      // New in v2. There is no v1 counterpart, so these are checked for a 200
      // and a sane shape rather than diffed against a baseline.
      '/api/v1/prices',
      '/api/v1/prices/stats',
    ];
    for (const it of items) {
      if (it.user_id === uid) {
        paths.push(`/api/v1/items/${it.id}/history`);
        paths.push(`/api/v1/items/${it.id}`);
      }
    }
    for (const tx of txs) {
      if (tx.user_id === uid) paths.push(`/api/v1/transactions/${tx.id}`);
    }

    for (const p of paths) {
      try {
        const res = await app.request(
          p,
          { headers: { Authorization: `Bearer ${token}` } },
          env as any,
        );
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { __non_json: text.slice(0, 200) }; }
        out.responses[`${prefix} ${p}`] = { status: res.status, body };
      } catch (e: any) {
        out.responses[`${prefix} ${p}`] = { status: 0, error: e.message };
      }
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

await main();
