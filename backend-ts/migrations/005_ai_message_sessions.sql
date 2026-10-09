-- Migration 005 — conversations become identifiable.
--
-- Run AFTER 001–004.
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/005_ai_message_sessions.sql
--
-- Why:
--
-- R5 originally specified one continuous conversation per user, forever. That is
-- no longer what is wanted: a page load starts a new conversation. Because the
-- model's context is loaded by `user_id` alone (there was no session column),
-- "do not carry the previous conversation over" could only have been implemented
-- by DELETING the old transcript — which throws away history that is expensive
-- to lose and impossible to recreate.
--
-- `session_id` makes the same behaviour non-destructive: each conversation's
-- messages are tagged, the model is given only the current session's turns, and
-- every earlier conversation stays in the table for cost accounting and for a
-- future "browse past conversations" view.
--
-- Existing rows are attributed to a 'legacy' session rather than discarded.
-- They were, by definition, part of the one continuous conversation that used to
-- exist; grouping them under one id preserves exactly that meaning.
--
-- ---------------------------------------------------------------------------
-- Why the table is rebuilt
--
-- `session_id` must be NOT NULL so that no message can ever be written without a
-- conversation. SQLite cannot add a NOT NULL column to an existing table, so the
-- table is recreated — the same conclusion 003 reached for `content`.
--
-- The order follows 002/004: build the replacement under a temporary name, copy,
-- drop the original, then rename the temporary one into place. It deliberately
-- does NOT rename the original first: `ALTER TABLE ... RENAME` rewrites
-- REFERENCES clauses in other tables, which would leave anything pointing at
-- `ai_messages` aiming at the parked table.
--
-- The DEFAULT on `session_id` is not cosmetic. `verify_migration.py` compares
-- this migration's result against db/schema.sql object by object, and a
-- pre-existing test seeds rows with raw SQL that names no session; without a
-- default those inserts fail and every seeded row would need a session id it has
-- no opinion about. The default is honest for those callers: a turn with no
-- session belongs to the same unnamed one.
-- ---------------------------------------------------------------------------

CREATE TABLE ai_messages_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Which conversation this turn belongs to. All rows of one conversation
    -- share it; the model is only ever shown the current one.
    session_id TEXT NOT NULL DEFAULT 'default',
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content    TEXT,   -- nullable: a tool-call turn has no text
    tool_calls TEXT,
    tokens_in  INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Columns are named rather than `SELECT *`: the column order differs (session_id
-- is new), and naming them keeps the copy correct if either side changes later.
INSERT INTO ai_messages_new
    (id, user_id, session_id, role, content, tool_calls, tokens_in, tokens_out, created_at)
SELECT id, user_id, 'legacy', role, content, tool_calls, tokens_in, tokens_out, created_at
  FROM ai_messages;

DROP TABLE ai_messages;

ALTER TABLE ai_messages_new RENAME TO ai_messages;

-- Loading a conversation is now scoped by session, so the index carries it.
-- Cost accounting still filters by (user_id, created_at), which this index
-- serves as a prefix.
DROP INDEX IF EXISTS idx_ai_messages_user;
CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages (user_id, session_id, id);
