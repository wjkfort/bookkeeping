/**
 * R5 — the bounded prompt.
 *
 * Everything the model is told each turn is assembled here, inside a hard
 * server-side character budget. Three rules from the requirements shape it:
 *
 *   1. **Never retrieve chat history to answer a price or trend question.**
 *      Trends come from SQL, and what reaches the prompt is the *result*, not
 *      the rows. The snapshot carries small computed figures only.
 *   2. **Every prompt is bounded**: recent messages, the memory note, a snapshot
 *      of categories/items/month total/gaps, and nothing else. A client or a
 *      model asking for more cannot widen it.
 *   3. **Long-term memory is a short note, not a replay.** `ai_memory` holds
 *      habits and preferences; numbers are deliberately excluded because they
 *      go stale and are recomputed each turn anyway.
 *
 * Each section is capped individually *and* the whole is capped again, so one
 * pathological section (a user with 500 items) cannot crowd out the others or
 * blow the request: sections are dropped in a defined order until it fits.
 */

import type { ChatMessage } from './deepseek';
import { readMemory } from './memory';
import { listCategories } from './categories';
import { findGaps } from './gaps';
import { summarize } from './queries';
import { loadRecentMessages, groupMessages, takeNewestGroups, readToolCallId, readToolName, readToolCalls } from './conversation';
import { todayInZone } from '../utils/time';
import type { AiMessage } from '../types';

/** Per-section ceilings. */
export const SNAPSHOT_MAX_CATEGORIES = 60;
export const SNAPSHOT_MAX_ITEMS = 40;
export const SNAPSHOT_MAX_GAPS = 10;

/** R5's hard ceiling on the whole assembled prompt, in characters. */
export const PROMPT_CHAR_BUDGET = 16_000;

/** The character budget reserved for the conversation transcript. */
export const PROMPT_TRANSCRIPT_BUDGET = 8_000;

export interface PromptSnapshot {
  today: string;
  categories: { id: number; name: string; type: string; parent_id: number | null }[];
  items: string[];
  month: { month: string; total: number; currency: string; by_category: { name: string; total: number }[] };
  gaps: { missing_days: string[]; overdue_subscriptions: { id: number; name: string; end_date: string }[] };
  memory: string | null;
  /** Sections that had to be trimmed, so the model can be told it is partial. */
  truncated: boolean;
}

/**
 * The system prompt.
 *
 * Written as constraints the model can act on, because these are the behaviours
 * the requirements single out: never invent a number, ask enough before writing,
 * map units rather than guess, and say plainly when something was refused.
 */
export function systemPrompt(): string {
  return [
    'You are the bookkeeping assistant for one person\'s personal ledger. You record what they tell you and answer questions about their spending.',
    '',
    'Hard rules:',
    '- Never invent a number. Every figure you show must come from a tool result or the snapshot in this turn. If you do not have it, call a tool.',
    '- Never do arithmetic yourself for totals or trends. Call summarize.',
    '- Writes happen immediately; there is no confirmation step. So collect enough detail first: for a meal, where and what, not just the amount. If the user was too vague, ask before writing.',
    '- To fix a mistake, use update_transaction or delete_transaction. The edit is invisible to the user — there is no change log — so just do it and say what you corrected.',
    '- Describe an item purchase with the `item` field so its price is tracked too.',
    '- To record how big something was, use `quantity` with a unit code (`quantity: 30, unit: "ml"`), and keep the size OUT of the item name: the item is "shampoo", not "shampoo 30ml". Then a later 50ml bottle is the same item and the two can be compared per ml — including when the bigger one is cheaper per unit but dearer overall.',
    // Which entries carry a size is a judgement about the thing bought, not a
    // rule, so it is described as one. Services and experiences have no size;
    // anything bought by amount has one, and it is what makes the price
    // comparable later.
    '- Decide per purchase whether a size belongs, and do not ask about one that does not exist. Anything bought by amount — food, drink, household goods, anything you would weigh, measure or count — has a size, so record it when the user gives it and ask for it when they do not. A haircut, a taxi ride, a subscription, a bill: these are single services that have no unit, so record the amount and never ask for a size.',
    '- Compare prices only within one unit. Prices per ml and per piece are different quantities and must never be averaged together or converted; when an item was also bought in another unit, say so and state plainly that it cannot be compared.',
    '- An entry is detailed enough when it names the product AND gives a unit and a quantity. The amount alone is not enough: nobody can compare, or even recognise a repeat purchase, without the name and the size. So when a user reports a purchase with only an amount, record it, then ask for the missing pieces in the same reply — one short question, not an interrogation. Do not refuse to record, and do not invent the missing detail.',
    '- When the user asks what needs filling in, or you notice vague entries, use find_transactions with missing_detail rather than paging through the ledger. Report what you find in plain language and offer to fix the ones they care about.',
    '- If a user asks for something the current structure cannot express, say exactly what is missing and that it needs a change to the database, which you cannot make. Do not approximate it, and do not pretend you did it.',
    '- Before recording a price with a unit, call list_units and map the user\'s wording onto one of those codes. Record the user\'s own wording in `unit_raw` at the same time, so nothing is lost if the code is imperfect.',
    // Reported after the tea egg: the reply said "1 个（piece）" because the
    // vocabulary is English ("piece"), and the model reached for the only token
    // it had. The code is the database's vocabulary, not the user's; `unit_raw`
    // already holds what they actually said, so prose has no reason to name a
    // code at all.
    '- Talk about a unit the way the user did, not with the code. Their own wording is in `unit_raw` — reuse it. When there is none, use the ordinary word for that unit in their language (a "piece" is 个, not "piece"). The code is what the database compares on; it is not how you address the user.',
    '- NEVER convert between units. If the user says 斤, 两, or 打 and it is not in the vocabulary, record their number and their wording exactly as given, put the wording in unit_raw, and either map the code or leave it empty — do not translate 斤 into kg and do not do the arithmetic. 5 斤 is not 5 kg; a converted number is a wrong number, and it corrupts the price history it is compared against.',
    '- Say plainly that the unit was not in the vocabulary and that comparisons for it are therefore unavailable, so the user can decide. Recording the raw wording is what makes that recoverable later.',
    '- If a tool refuses something (a category still in use, for example), tell the user plainly what happened. Do not claim success.',
    '- Never change the database structure. You cannot create, alter or drop tables, columns or indexes, and you must not try — you only read and write rows through your tools. If a request would need a structural change, say so plainly and describe what is missing, so the user can decide what to change. Do not pretend the change happened.',
    // Asked for explicitly because a pre-tool-call line is pure noise to the
    // reader, and it is also where the mixed-language bug showed up.
    '- Do not announce what you are about to do. Call the tool, then write your answer. A line like "let me check that" adds nothing.',
    // The language rule is stated twice, and the second wording is the point:
    // "reply in the user's language" was read as governing only the FINAL
    // message, so the short line emitted before a tool call came out in English
    // — the language of this prompt. That line is stored and replayed on every
    // later turn, so the wrong language persisted rather than being a one-off.
    '- Write everything in the same language the user writes in, from your first word: any sentence you emit before or between tool calls counts, not only the final reply. Never mix two languages in one turn.',
    '- Keep one language for the whole conversation unless the user switches; if they switch, follow them.',
    '',
    'Memory: keep habits, preferences and context in your memory note via `remember` (for example "the usual lunch place is X", "supermarket shopping counts as Food"). Do not store numbers or totals there — they are recomputed every turn and a remembered number goes stale.',
  ].join('\n');
}

/**
 * Build the bounded snapshot.
 *
 * Note the deliberate shape of `month`: a total and a per-category breakdown,
 * both from SQL, rather than transactions. That is what makes "how much have I
 * spent this month" answerable without ever loading the ledger into the prompt.
 */
export async function buildSnapshot(
  db: D1Database, userId: number, today: string, timezone?: string,
): Promise<PromptSnapshot> {
  const month = today.slice(0, 7);

  const [memory, categories, gaps, monthSummary] = await Promise.all([
    readMemory(db, userId),
    listCategories(db, userId, true),
    findGaps(db, userId, { today, timezone }),
    summarize(db, userId, { group_by: 'category', date_from: `${month}-01`, date_to: today }),
  ]);

  let truncated = false;

  const flatCategories = (categories as any[]).map(c => ({
    id: c.id as number,
    name: c.name as string,
    type: c.type as string,
    parent_id: (c.parent_id ?? null) as number | null,
  }));
  if (flatCategories.length > SNAPSHOT_MAX_CATEGORIES) truncated = true;
  const cappedCategories = flatCategories.slice(0, SNAPSHOT_MAX_CATEGORIES);

  // Item names only: their price history is fetched by tool when it is actually
  // needed, never carried in the prompt (R4/R5).
  const { results: itemRows } = await db
    .prepare('SELECT name FROM items WHERE user_id = ? ORDER BY name ASC LIMIT ?')
    .bind(userId, SNAPSHOT_MAX_ITEMS + 1)
    .all<{ name: string }>();
  if (itemRows.length > SNAPSHOT_MAX_ITEMS) truncated = true;
  const items = itemRows.slice(0, SNAPSHOT_MAX_ITEMS).map(r => r.name);

  const missingDays = gaps.missing_days.map(m => m.date);
  if (missingDays.length > SNAPSHOT_MAX_GAPS) truncated = true;
  const overdue = gaps.overdue_subscriptions.map(o => ({
    id: o.subscription_id, name: o.name, end_date: o.end_date,
  })).slice(0, SNAPSHOT_MAX_GAPS);

  return {
    today,
    categories: cappedCategories,
    items,
    month: {
      month,
      total: monthSummary.total,
      currency: monthSummary.currency,
      by_category: monthSummary.buckets.slice(0, 15).map(b => ({ name: b.label, total: b.total })),
    },
    gaps: { missing_days: missingDays, overdue_subscriptions: overdue },
    memory: memory.memory,
    truncated,
  };
}

/**
 * Render the snapshot as the compact block placed in the prompt.
 *
 * Compact on purpose: this text is paid for on every turn, and whitespace is
 * tokens.
 */
export function renderSnapshot(s: PromptSnapshot): string {
  const lines: string[] = [];
  lines.push(`Today: ${s.today}`);
  lines.push(`This month (${s.month.month}): ${s.month.total} ${s.month.currency} total across ${s.month.by_category.length} categories`);
  if (s.month.by_category.length > 0) {
    lines.push(`  by category: ${s.month.by_category.map(c => `${c.name}=${c.total}`).join(', ')}`);
  }

  if (s.categories.length > 0) {
    lines.push(`Categories: ${s.categories.map(c => `${c.id}:${c.name}(${c.type}${c.parent_id ? `,in ${c.parent_id}` : ''})`).join(', ')}`);
  }

  if (s.items.length > 0) {
    lines.push(`Tracked items: ${s.items.join(', ')}`);
  }

  if (s.gaps.missing_days.length > 0) {
    lines.push(`Days with nothing recorded: ${s.gaps.missing_days.join(', ')}`);
  }
  if (s.gaps.overdue_subscriptions.length > 0) {
    lines.push(`Overdue subscriptions: ${s.gaps.overdue_subscriptions.map(o => `${o.id}:${o.name}(ended ${o.end_date})`).join(', ')}`);
  }

  if (s.memory) {
    lines.push(`Your memory note: ${s.memory}`);
  }
  if (s.truncated) {
    lines.push('(Some lists were shortened. Use the tools to look up what is missing rather than guessing.)');
  }

  return lines.join('\n');
}

/**
 * The dominant script of a piece of text, as a language name.
 *
 * Deliberately crude: it only needs to catch "the user is writing Chinese" so a
 * directive can be placed at the END of the prompt, right before the user's own
 * words. A hundred-line language detector would be a dependency and a liability
 * for a decision this coarse, and being wrong here is recoverable by the user
 * simply writing in the other language.
 */
export function detectLanguage(text: string): string {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cjk > 0 && cjk >= latin / 4) return 'Chinese';
  return 'English';
}

/**
 * A per-turn language directive, placed immediately before the user's message.
 *
 * The rule is also in the system prompt, but that is far away and phrased as a
 * rule; this is placed where recency makes it hard to miss, and it names the
 * concrete requirement that actually broke: the short line emitted before a tool
 * call. That line is stored and replayed on later turns, so getting it wrong
 * once pollutes the conversation rather than being a one-off.
 */
export function languageDirective(language: string): string {
  return `Reply entirely in ${language} — every sentence, including anything you say before or between tool calls. Do not use English for those lead-ins. Do not mix languages.`;
}

export interface BuildPromptResult {
  messages: ChatMessage[];
  /** True when the transcript had to be clamped to fit the budget. */
  transcriptClamped: boolean;
  snapshot: PromptSnapshot;
}

/**
 * Assemble the full message list for one turn.
 *
 * Order is system → snapshot → transcript → new instruction, so the newest
 * instruction is last and the stable material is at the front. The transcript is
 * clamped first to its own budget, then the whole prompt is checked; if it is
 * still over, older transcript is dropped (never the snapshot or the system
 * prompt, which are what make the numbers trustworthy).
 */
export async function buildPrompt(
  db: D1Database, userId: number, userMessage: string,
  opts: {
    today?: string;
    timezone?: string;
    /** Which conversation's transcript to load. Required. */
    sessionId: string;
    recentLimit?: number;
    charBudget?: number;
  },
): Promise<BuildPromptResult> {
  const today = opts.today ?? todayInZone(opts.timezone);
  const snapshot = await buildSnapshot(db, userId, today, opts.timezone);

  const recent: AiMessage[] = await loadRecentMessages(db, userId, opts.sessionId, opts.recentLimit);

  // Group before anything is dropped. `groupMessages` also discards rows that can
  // never be replayed — a tool result whose request is gone — so a transcript
  // damaged by an earlier bug or a partial write heals here instead of reaching
  // the provider as a 400.
  const groups = groupMessages(recent);
  let kept = takeNewestGroups(groups, PROMPT_TRANSCRIPT_BUDGET);

  const head: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'system', content: `Current state:\n${renderSnapshot(snapshot)}` },
  ];

  const toChatMessage = (m: AiMessage): ChatMessage => {
    if (m.role === 'tool') {
      // The stored transcript is replayed faithfully: a tool result must carry
      // the id of the call it answers, and a `name` so the provider can match.
      const id = readToolCallId(m.tool_calls);
      const name = readToolName(m.tool_calls);
      return {
        role: 'tool',
        content: m.content ?? '',
        ...(id ? { tool_call_id: id } : {}),
        ...(name ? { name } : {}),
      };
    }
    const toolCalls = readToolCalls(m.tool_calls);
    return {
      role: m.role,
      content: m.content,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  };

  const assemble = (chosen: AiMessage[][]): ChatMessage[] => [
    ...head,
    ...chosen.flat().map(toChatMessage),
    // Last before the user's own words, where recency makes it hard to miss.
    { role: 'system', content: languageDirective(detectLanguage(userMessage)) },
    { role: 'user', content: userMessage },
  ];

  const budget = opts.charBudget ?? PROMPT_CHAR_BUDGET;
  const size = (msgs: ChatMessage[]) =>
    msgs.reduce((n, m) => n + (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);

  // Final whole-prompt check: drop the oldest transcript, still in whole groups.
  // The two system blocks, the language directive and the user's own message are
  // never dropped — the snapshot is what makes the numbers trustworthy, and the
  // user message is the question.
  //
  // This loop used to `splice(2, 1)`, one message at a time, with a
  // `length > 3` guard. That had the same pairing bug as the character clamp —
  // it could leave a tool result at the front — and it could also eat the
  // language directive sitting immediately before the user's message, which is
  // the one line that keeps a reply in the user's language.
  let messages = assemble(kept);
  while (size(messages) > budget && kept.length > 0) {
    kept = kept.slice(1);
    messages = assemble(kept);
  }

  const transcriptClamped = kept.flat().length !== recent.length;

  return { messages, transcriptClamped, snapshot };
}
