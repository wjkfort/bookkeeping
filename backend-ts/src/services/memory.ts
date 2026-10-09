/**
 * R5 — the per-user memory note (`users.ai_memory`).
 *
 * A short piece of text, not a history replay: it holds preferences and habits
 * the model cannot infer from the numbers ("the usual lunch place is X",
 * "supermarket shopping counts as Y"). Numbers deliberately do not belong here,
 * because every figure is recomputed from SQL each turn and a remembered number
 * would go stale silently.
 *
 * The mechanism is server-side only; what is worth remembering is the model's
 * judgement (§5.2). The server enforces the length limit from the schema and
 * hands back an error the model can act on by compressing what it wrote.
 */

import { badRequest } from './errors';

/** Mirrors the `CHECK (length <= 2000)` on `users.ai_memory`. */
export const AI_MEMORY_MAX_LENGTH = 2000;

export interface AiMemory {
  memory: string | null;
  length: number;
  max_length: number;
}

export async function readMemory(
  db: D1Database, userId: number,
): Promise<AiMemory> {
  const row = await db
    .prepare('SELECT ai_memory FROM users WHERE id = ?')
    .bind(userId)
    .first<{ ai_memory: string | null }>();

  const memory = row?.ai_memory ?? null;
  return {
    memory,
    length: memory?.length ?? 0,
    max_length: AI_MEMORY_MAX_LENGTH,
  };
}

/**
 * Replace the memory note. Called by the model at the end of a turn when it
 * decided something is worth keeping.
 *
 * Overwriting rather than appending is the design: the field is a summary the
 * model maintains, not a log. Passing null or an empty string clears it.
 */
export async function writeMemory(
  db: D1Database, userId: number, text: string | null,
): Promise<AiMemory> {
  const normalised = text === null || text === undefined ? null : text;

  if (normalised !== null && normalised.length > AI_MEMORY_MAX_LENGTH) {
    // Not a silent truncation: the model is told the limit so it can compress.
    throw badRequest(
      `Memory is ${normalised.length} characters; the limit is ${AI_MEMORY_MAX_LENGTH}. Compress it and try again.`,
      { max_length: AI_MEMORY_MAX_LENGTH },
      'AI_MEMORY_TOO_LONG',
    );
  }

  await db
    .prepare('UPDATE users SET ai_memory = ?, updated_at = ? WHERE id = ?')
    .bind(normalised, new Date().toISOString(), userId)
    .run();

  return readMemory(db, userId);
}

/** Append a fact to the memory note, respecting the length limit. */
export async function appendMemory(
  db: D1Database, userId: number, fact: string,
): Promise<AiMemory> {
  const current = await readMemory(db, userId);
  const trimmed = fact.trim();
  if (trimmed.length === 0) return current;

  const combined = current.memory ? `${current.memory}\n${trimmed}` : trimmed;
  return writeMemory(db, userId, combined);
}
