/**
 * Smoke-test the AI-support endpoints over HTTP, through the real app and auth
 * middleware.
 *
 *   npx esbuild scripts/ai_endpoints_test.ts --bundle --platform=node --format=esm \
 *     --outfile=scripts/.build/ai_endpoints_test.mjs
 *   node scripts/.build/ai_endpoints_test.mjs <source.sqlite>
 *
 * Why this exists next to services_test.ts: that suite drives the service
 * functions directly, so it cannot catch a route that was never mounted, a path
 * shadowed by another route, or an endpoint that is reachable without a token.
 * Those are exactly the failure modes of `api.route(...)` wiring, and the
 * API-contract capture predates these routes so it does not cover them.
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
        const isQuery = /^\s*(select|with|pragma)/i.test(sql);
        const isReturning = /\breturning\b/i.test(sql);
        if (isQuery || isReturning) {
          const results = stmt.all(...args);
          return {
            results,
            success: true,
            meta: { changes: isQuery ? 0 : results.length, last_row_id: 0 },
          };
        }
        stmt.run(...args);
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
  if (!src) { console.error('usage: ai_endpoints_test.mjs <source.sqlite>'); process.exit(2); }
  const work = '/tmp/ai_endpoints_test.sqlite';
  try { unlinkSync(work); } catch { /* absent */ }
  copyFileSync(src, work);

  const raw = new DatabaseSync(work);
  const uid = raw.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get().id as number;
  const secret = process.env.JWT_SECRET || 'ai-endpoints-secret';
  const token = await sign(
    { sub: uid, email: 'ai@local', username: 'ai', exp: Math.floor(Date.now() / 1000) + 3600 },
    secret,
  );
  const env = { DB: new D1Shim(raw), JWT_SECRET: secret, EXCHANGE_RATE_CACHE_HOURS: '24', OPEN_EXCHANGE_RATES_API_KEY: 'x' };

  // Every chat turn and history read belongs to a conversation now.
  const SESSION = 'http-session-1';

  const call = async (method: string, path: string, body?: any, withToken = true) => {
    const res = await app.request(path, {
      method,
      headers: {
        ...(withToken ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env as any);
    const text = await res.text();
    let json: any; try { json = JSON.parse(text); } catch { json = { __raw: text.slice(0, 200) }; }
    return { status: res.status, body: json };
  };

  console.log('=== the routes are mounted and require a token ===');
  for (const [method, path] of [
    ['GET', '/api/v1/ai/gaps'],
    ['POST', '/api/v1/ai/gaps/no-spend'],
    ['GET', '/api/v1/ai/units'],
    ['GET', '/api/v1/ai/memory'],
    ['PUT', '/api/v1/ai/memory'],
    ['GET', '/api/v1/units'],
    ['GET', '/api/v1/prices/units'],
  ] as const) {
    const anon = await call(method, path, method === 'GET' ? undefined : {}, false);
    check(`${method} ${path} rejected without a token`, anon.status === 401, `status ${anon.status}`);
  }

  console.log('\n=== gaps ===');
  let r = await call('GET', '/api/v1/ai/gaps');
  check('GET /ai/gaps is 200', r.status === 200, `status ${r.status}`);
  check('it returns both checks', Array.isArray(r.body.missing_days) &&
        Array.isArray(r.body.overdue_subscriptions));
  check('the window is 3 days', r.body.window?.days === 3, `got ${r.body.window?.days}`);

  r = await call('GET', '/api/v1/ai/gaps?today=2030-06-15');
  check('the reference day can be pinned', r.body.window?.to === '2030-06-14',
        `got ${r.body.window?.to}`);
  check('the window ends yesterday, not today',
        r.body.window?.to !== '2030-06-15', `got ${r.body.window?.to}`);
  check('the three complete days before it are reported missing',
        r.body.missing_days.length === 3, `got ${r.body.missing_days.length}`);
  check('today itself is never offered as a missing day',
        !r.body.missing_days.some((m: { date: string }) => m.date === '2030-06-15'),
        JSON.stringify(r.body.missing_days.map((m: { date: string }) => m.date)));

  r = await call('GET', '/api/v1/ai/gaps?today=not-a-date');
  check('a malformed today is a 400', r.status === 400, `status ${r.status}`);

  console.log('\n=== the date rule runs in the caller\'s zone ===');
  // The window is derived from the reference day, so it lets the zone plumbing
  // be checked without any dependence on the wall clock.
  r = await call('GET', '/api/v1/ai/gaps?today=2026-10-09&timezone=Asia/Shanghai');
  check('the resolved zone is echoed back', r.body.timezone === 'Asia/Shanghai',
        `got ${r.body.timezone}`);
  check('UTC+8 window for 2026-10-09 is 10-06..10-08',
        r.body.window?.from === '2026-10-06' && r.body.window?.to === '2026-10-08',
        JSON.stringify(r.body.window));
  check('today is excluded from that window',
        !r.body.missing_days.some((m: { date: string }) => m.date === '2026-10-09') &&
        !r.body.missing_days.some((m: { date: string }) => m.date > '2026-10-09'),
        JSON.stringify(r.body.missing_days));

  r = await call('GET', '/api/v1/ai/gaps?today=2026-10-09');
  check('omitting the zone defaults to UTC+8', r.body.timezone === 'Asia/Shanghai',
        `got ${r.body.timezone}`);
  check('the default produces the same window as an explicit UTC+8',
        r.body.window?.from === '2026-10-06', JSON.stringify(r.body.window));

  r = await call('GET', '/api/v1/ai/gaps?today=2026-10-09&timezone=Not/AZone');
  check('an unknown zone is a 400 the caller can act on', r.status === 400, `status ${r.status}`);
  check('the 400 names the zone problem', r.body.code === 'UNKNOWN_TIMEZONE',
        JSON.stringify(r.body));

  r = await call('POST', '/api/v1/ai/chat', { message: 'hi', timezone: 'Not/AZone', session: SESSION });
  check('chat validates the zone before doing anything', r.status === 400, `status ${r.status}`);
  check('chat reports the zone error code', r.body.code === 'UNKNOWN_TIMEZONE',
        JSON.stringify(r.body));

  console.log('\n=== recording the answer about a day ===');
  // This date is inside the window (yesterday relative to 2030-06-15).
  r = await call('POST', '/api/v1/ai/gaps/no-spend', { date: '2030-06-13' });
  check('POST /ai/gaps/no-spend is 201', r.status === 201, `status ${r.status}`);
  check('the day is stored as no_spend', r.body.status === 'no_spend', `got ${r.body.status}`);

  r = await call('GET', '/api/v1/ai/gaps?today=2030-06-15');
  check('the recorded day drops out of the gaps', r.body.missing_days.length === 2,
        `got ${r.body.missing_days.length}`);

  r = await call('POST', '/api/v1/ai/gaps/no-spend', { date: '2030-06-14', status: 'partial' });
  check('partial is accepted', r.status === 201 && r.body.status === 'partial',
        `status ${r.status} / ${r.body.status}`);

  r = await call('POST', '/api/v1/ai/gaps/no-spend', { date: 'nope' });
  check('a malformed date is a 400', r.status === 400, `status ${r.status}`);

  r = await call('POST', '/api/v1/ai/gaps/no-spend', {});
  check('a missing date is a 400', r.status === 400, `status ${r.status}`);

  console.log('\n=== units (the vocabulary the model maps onto) ===');
  r = await call('GET', '/api/v1/ai/units');
  check('GET /ai/units is 200', r.status === 200, `status ${r.status}`);
  check('it returns codes and names', Array.isArray(r.body) && r.body[0]?.code !== undefined,
        JSON.stringify(r.body?.[0]));

  const alt = await call('GET', '/api/v1/prices/units');
  check('/prices/units is the same vocabulary',
        alt.status === 200 && alt.body.length === r.body.length,
        `status ${alt.status}, ${alt.body?.length} vs ${r.body?.length}`);

  const top = await call('GET', '/api/v1/units');
  check('/units is the same vocabulary', top.status === 200 && top.body.length === r.body.length,
        `status ${top.status}`);

  console.log('\n=== memory ===');
  r = await call('GET', '/api/v1/ai/memory');
  check('GET /ai/memory is 200', r.status === 200, `status ${r.status}`);
  check('it reports the limit from the schema', r.body.max_length === 2000,
        `got ${r.body.max_length}`);

  r = await call('PUT', '/api/v1/ai/memory', { memory: '午餐通常在公司附近' });
  check('PUT /ai/memory stores the note', r.status === 200 && r.body.memory === '午餐通常在公司附近',
        `status ${r.status} / ${JSON.stringify(r.body.memory)}`);

  r = await call('GET', '/api/v1/ai/memory');
  check('the note reads back', r.body.memory === '午餐通常在公司附近', `got ${r.body.memory}`);

  r = await call('PUT', '/api/v1/ai/memory', { memory: 'x'.repeat(2001) });
  check('an over-long note is a 400 the model can act on', r.status === 400, `status ${r.status}`);
  check('the error names the limit', r.body.max_length === 2000, JSON.stringify(r.body));

  r = await call('PUT', '/api/v1/ai/memory', {});
  check('a missing memory field is a 400', r.status === 400, `status ${r.status}`);

  console.log('\n=== status and chat history ===');
  r = await call('GET', '/api/v1/ai/status');
  check('GET /ai/status is 200', r.status === 200, `status ${r.status}`);
  check('it reports the AI layer as unconfigured without a key', r.body.configured === false,
        `got ${r.body.configured}`);
  check('it reports the daily cap as absent, by decision', r.body.daily_token_limit === null,
        `got ${JSON.stringify(r.body.daily_token_limit)}`);
  check('it lists the tools', Array.isArray(r.body.tools) && r.body.tools.length > 0,
        `${r.body.tools?.length} tools`);

  r = await call('GET', `/api/v1/ai/messages?session=${SESSION}`);
  check('GET /ai/messages is 200', r.status === 200, `status ${r.status}`);
  check('it returns an array', Array.isArray(r.body), JSON.stringify(r.body).slice(0, 80));

  console.log('\n=== chat history order (a UI bug hid here) ===');
  // The stored page is returned newest-first for cursor paging. That is only
  // observable once there is more than one message — an empty list is ordered
  // identically either way, which is why the fixture's empty table never caught
  // the dock rendering the newest turn at the top.
  //
  // Messages are stored even when the provider is unavailable (R6), so these
  // writes are real without needing a key.
  await call('POST', '/api/v1/ai/chat', { message: 'order-first', session: SESSION });
  await call('POST', '/api/v1/ai/chat', { message: 'order-second', session: SESSION });
  await call('POST', '/api/v1/ai/chat', { message: 'order-third', session: SESSION });

  r = await call('GET', `/api/v1/ai/messages?session=${SESSION}`);
  const ids = r.body.map((m: { id: number }) => m.id);
  check('history comes back newest first',
        ids.length > 1 && ids.every((id: number, i: number) => i === 0 || id < ids[i - 1]),
        JSON.stringify(ids));
  check('the newest message is head of the list',
        r.body[0]?.content === 'order-third',
        JSON.stringify(r.body[0]?.content));
  check('the oldest is last', r.body[r.body.length - 1]?.content === 'order-first',
        JSON.stringify(r.body[r.body.length - 1]?.content));

  // The cursor is what makes newest-first the right order for this endpoint:
  // `before` asks for what came earlier.
  const cursor = r.body[1].id;
  const older = await call('GET', `/api/v1/ai/messages?session=${SESSION}&before=${cursor}`);
  check('before=<id> pages to older messages',
        older.body.every((m: { id: number }) => m.id < cursor),
        JSON.stringify(older.body.map((m: { id: number }) => m.id)));
  check('the older page is still newest first',
        older.body.length < 2 || older.body[0].id > older.body[1].id,
        JSON.stringify(older.body.map((m: { id: number }) => m.id)));

  const badCursor = await call('GET', `/api/v1/ai/messages?session=${SESSION}&before=abc`);
  check('a malformed cursor is a 400', badCursor.status === 400, `status ${badCursor.status}`);

  console.log('\n=== conversations over HTTP ===');
  // A page load is a new conversation: it sends a new id and must see nothing
  // from the previous one. Verified end to end, because the whole point is that
  // hiding rows in the UI is not enough — the transcript itself is scoped.
  const OTHER = 'http-session-2';
  await call('POST', '/api/v1/ai/chat', { message: 'second-conversation-only', session: OTHER });

  const inOther = await call('GET', `/api/v1/ai/messages?session=${OTHER}`);
  check('a new conversation contains only its own turn',
        inOther.body.length === 1 && inOther.body[0].content === 'second-conversation-only',
        JSON.stringify(inOther.body.map((m: { content: string }) => m.content)));
  check('its turns are tagged with its id',
        inOther.body.every((m: { session_id: string }) => m.session_id === OTHER),
        JSON.stringify(inOther.body.map((m: { session_id: string }) => m.session_id)));

  const stillFirst = await call('GET', `/api/v1/ai/messages?session=${SESSION}`);
  check('the earlier conversation is unaffected by the new one',
        stillFirst.body.some((m: { content: string }) => m.content === 'order-third') &&
        !stillFirst.body.some((m: { content: string }) => m.content === 'second-conversation-only'),
        JSON.stringify(stillFirst.body.map((m: { content: string }) => m.content)));

  // Conversations are kept, not deleted — the reason `session_id` beats wiping.
  const sessions = await call('GET', '/api/v1/ai/sessions');
  check('both conversations are on record', sessions.status === 200 &&
        sessions.body.map((s: { session_id: string }) => s.session_id)
          .includes(OTHER) &&
        sessions.body.map((s: { session_id: string }) => s.session_id)
          .includes(SESSION),
        JSON.stringify(sessions.body.map((s: { session_id: string }) => s.session_id)));
  check('each conversation reports its own size',
        sessions.body.every((s: { messages: number }) => typeof s.messages === 'number' && s.messages > 0),
        JSON.stringify(sessions.body));

  const orphanMessages = await call('GET', '/api/v1/ai/messages');
  check('a history read without a session is a 400', orphanMessages.status === 400,
        `status ${orphanMessages.status}`);
  check('the error names the missing session', orphanMessages.body.code === 'SESSION_REQUIRED',
        JSON.stringify(orphanMessages.body));

  const orphanChat = await call('POST', '/api/v1/ai/chat', { message: 'no session' });
  check('a chat turn without a session is a 400', orphanChat.status === 400,
        `status ${orphanChat.status}`);
  check('and it is refused before anything is stored',
        orphanChat.body.code === 'SESSION_REQUIRED', JSON.stringify(orphanChat.body));

  console.log('\n=== chat without a key degrades, it does not crash (R6) ===');
  // No DEEPSEEK_API_KEY in the test env: the endpoint must say so clearly and
  // must not be a 500, because R6 requires the rest of the app to keep working.
  r = await call('POST', '/api/v1/ai/chat', { message: 'hello', session: SESSION });
  check('POST /ai/chat reports 503 when unconfigured', r.status === 503, `status ${r.status}`);
  check('the error explains itself', typeof r.body.error === 'string' && r.body.error.length > 0,
        JSON.stringify(r.body));

  r = await call('POST', '/api/v1/ai/chat', { session: SESSION });
  check('an empty message is a 400', r.status === 400, `status ${r.status}`);

  // The opening turn is not an unconditional provider call. When the window has
  // no gaps there is nothing to say, so it returns without needing a key at all;
  // only when there IS something to raise does the missing key surface.
  //
  // The precondition is created explicitly rather than assumed: this suite runs
  // against whatever database it is handed, so "no gaps right now" has to be
  // made true for the default reference day before it can be asserted.
  const defaultWindow = await call('GET', '/api/v1/ai/gaps');
  for (const day of defaultWindow.body.missing_days ?? []) {
    await call('POST', '/api/v1/ai/gaps/no-spend', { date: day.date });
  }
  const closedWindow = await call('GET', '/api/v1/ai/gaps');
  check('the default window can be closed by answering every day',
        closedWindow.body.missing_days.length === 0,
        JSON.stringify(closedWindow.body.missing_days));

  r = await call('POST', '/api/v1/ai/chat', { opening: true, session: SESSION });
  check('an opening turn with nothing to raise does not need the provider',
        r.status === 200 && r.body.reply === null,
        `status ${r.status}, reply ${JSON.stringify(r.body.reply)}`);

  // Now guarantee a gap inside the window, using the window the server reports.
  const windowRes = await call('GET', '/api/v1/ai/gaps?today=2030-09-15');
  const gapDate = windowRes.body.missing_days?.[0]?.date;
  check('a gap exists to open with', gapDate === '2030-09-12',
        `got ${JSON.stringify(gapDate)} of ${JSON.stringify(windowRes.body.window)}`);

  r = await call('POST', '/api/v1/ai/chat', { opening: true, today: '2030-09-15', session: SESSION });
  check('an opening turn with a gap but no key reports 503', r.status === 503, `status ${r.status}`);
  check('the 503 explains itself rather than claiming a greeting',
        typeof r.body.error === 'string' && r.body.error.length > 0, JSON.stringify(r.body));

  const anonChat = await call('POST', '/api/v1/ai/chat', { message: 'hi', session: SESSION }, false);
  check('POST /ai/chat requires a token', anonChat.status === 401, `status ${anonChat.status}`);

  // ---------------------------------------------------------------------
  // The shapes the chat dock reads. A build cannot catch a missing field: the
  // UI would just render undefined, so the fields it touches are asserted here,
  // at the boundary, where they are cheapest to keep correct.
  // ---------------------------------------------------------------------
  console.log('\n=== response shapes the client depends on ===');

  r = await call('GET', '/api/v1/ai/status');
  check('status.configured is a boolean', typeof r.body.configured === 'boolean',
        typeof r.body.configured);
  check('status.tools is an array', Array.isArray(r.body.tools));
  check('status.usage.today has token fields',
        typeof r.body.usage?.today?.tokens_in === 'number' &&
        typeof r.body.usage?.today?.tokens_out === 'number');
  check('status.usage.total exists', typeof r.body.usage?.total?.messages === 'number');

  r = await call('GET', '/api/v1/ai/gaps?today=2030-06-15');
  check('gaps.missing_days entries carry date',
        Array.isArray(r.body.missing_days) &&
        (r.body.missing_days.length === 0 || typeof r.body.missing_days[0].date === 'string'),
        JSON.stringify(r.body.missing_days?.[0]));
  check('gaps.overdue_subscriptions entries carry name and end_date',
        Array.isArray(r.body.overdue_subscriptions),
        JSON.stringify(r.body.overdue_subscriptions?.[0]));
  check('gaps.window carries the lookback size', typeof r.body.window?.days === 'number',
        `got ${r.body.window?.days}`);

  const emptyMessages = await call('GET', `/api/v1/ai/messages?session=${SESSION}`);
  check('messages is an array the UI can filter', Array.isArray(emptyMessages.body));

  raw.close();
  try { unlinkSync(work); } catch { /* ignore */ }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${checks - failures.length} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAILED: ${f}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
