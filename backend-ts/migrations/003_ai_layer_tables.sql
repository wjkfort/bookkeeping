-- Migration 003 — two changes to the AI-layer tables.
--
-- Run AFTER 001 and 002, against a database already on schema v2:
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/003_ai_layer_tables.sql
--
-- Both changes touch tables that no code writes yet and that hold no rows
-- (verified: ai_messages 0, ledger_days 0), so both are rebuilt rather than
-- migrated row by row. The copies below still carry rows across in case either
-- table has been populated by the time this runs.
--
-- ---------------------------------------------------------------------------
-- 1. ai_messages.content becomes nullable.
--
-- DeepSeek returns tool calls with an empty `content`. Forcing an empty string
-- into a NOT NULL column makes "this message only requested a tool" look the
-- same as "this message said nothing", which then pollutes the reconstructed
-- chat history that R5's bounded prompt is built from.
--
-- SQLite cannot drop NOT NULL in place, so the table is recreated. `content`
-- keeps its position so that `INSERT INTO ai_messages SELECT * FROM
-- ai_messages_old` stays valid.
--
-- `ALTER TABLE ... RENAME` rewrites REFERENCES clauses in other tables, which
-- would leave anything pointing at ai_messages aiming at the parked table — the
-- same hazard 002 documents. Nothing references ai_messages today (change_log
-- was dropped), and scripts/verify_migration.py compares this migration's result
-- against db/schema.sql object by object, so a reference appearing here would be
-- caught there rather than silently misdirected.
--
-- (A `SELECT RAISE(ABORT, ...)` guard was tried first and does not work: RAISE
-- is only valid inside a trigger, so it aborted unconditionally instead of
-- conditionally.)
-- ---------------------------------------------------------------------------

ALTER TABLE ai_messages RENAME TO ai_messages_old;

CREATE TABLE ai_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content    TEXT,
    tool_calls TEXT,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO ai_messages SELECT * FROM ai_messages_old;

DROP TABLE ai_messages_old;

CREATE INDEX idx_ai_messages_user ON ai_messages (user_id, id);

-- ---------------------------------------------------------------------------
-- 2. ledger_days gains a status.
--
-- The table could only say "this day had no spending". A conversational answer
-- is often partial: the AI asks about the 3rd, the user says "lunch, 20", and
-- the day is now *partly* recorded — neither empty (don't stop asking) nor
-- confirmed empty (do stop asking). Without a third state the AI cannot tell
-- whether to ask again, and every day with one entry looks finished.
--
--   no_spend  the user confirmed nothing was spent
--   partial   something has been recorded, but the day is not confirmed complete
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_days_new (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'no_spend'
               CHECK (status IN ('no_spend', 'partial')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
) WITHOUT ROWID;

-- Existing rows predate the distinction and only ever meant "no spending".
INSERT INTO ledger_days_new (user_id, date, status, created_at)
SELECT user_id, date, 'no_spend', created_at FROM ledger_days;

DROP TABLE ledger_days;

ALTER TABLE ledger_days_new RENAME TO ledger_days;
