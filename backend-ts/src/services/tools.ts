/**
 * §5.1 — the tool registry.
 *
 * This is the only place the model's output meets the database. Every entry
 * delegates to the same `src/services/*` function the HTTP routes call, so a
 * write performed conversationally and a write performed over the API are one
 * implementation, one set of validations and one ownership check.
 *
 * Rules enforced structurally here rather than by convention:
 *
 *   - **The model never picks a user.** `userId` is bound in `createToolRunner`
 *     from the JWT and is not part of any tool's parameter schema. A tool cannot
 *     reach another user's row because it is never given the chance.
 *   - **The model never writes SQL.** Tools take typed arguments; the SQL lives
 *     in the services.
 *   - **A failure is information, not an exception.** A `ServiceError` (an
 *     unknown unit, a category that is still in use, a missing row) is returned
 *     as a tool result with `ok: false` so the model can correct itself in the
 *     same turn. Anything unexpected is also caught and reported, never thrown
 *     into the loop.
 */

import type { ToolDefinition } from './deepseek';
import {
  createTransaction, updateTransaction, deleteTransaction,
} from './transactions';
import {
  listCategories, createCategory, updateCategory, deleteCategory,
} from './categories';
import {
  listItems, createItem, renameItem, deleteItem,
} from './items';
import {
  logPrice, listPrices, getPriceStats, updatePrice, deletePrice, compareMerchants, priceBreakdown,
} from './prices';
import {
  listSubscriptions, createSubscription, updateSubscription,
  archiveSubscription, renewSubscription,
} from './subscriptions';
import { listUnits } from './units';
import { markLedgerDay, findGaps } from './gaps';
import { resolveMerchant, addMerchantAlias } from './merchants';
import { readMemory, writeMemory } from './memory';
import { findTransactions, summarize } from './queries';
import { asServiceError } from './errors';

export interface ToolResult {
  ok: boolean;
  /** Machine-readable tag on failure, e.g. UNKNOWN_UNIT. */
  code?: string;
  data?: unknown;
  error?: string;
}

export interface ToolContext {
  db: D1Database;
  userId: number;
  /**
   * The user's IANA zone, so a write that omits a date lands on the user's
   * calendar day rather than the server's UTC one. Defaults to UTC+8.
   */
  timezone?: string;
  /** Injectable clock so tool behaviour is testable off the wall clock. */
  now?: () => Date;
}

interface ToolSpec {
  definition: ToolDefinition;
  run: (ctx: ToolContext, args: any) => Promise<unknown>;
}

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });

/** ISO date, described once so every date field reads the same way. */
const DATE_DESC = 'Calendar date as YYYY-MM-DD.';

/**
 * Resolve "Food" or 12 to a category id.
 *
 * §5.1 lets the model pass a name or an id. A name is matched case-insensitively
 * against the user's own categories first as a leaf, then as a parent, because
 * "lunch" is usually the child and "Food" the parent.
 */
async function resolveCategoryId(
  db: D1Database, userId: number, category: string | number | undefined,
): Promise<number | undefined> {
  if (category === undefined || category === null) return undefined;
  if (typeof category === 'number') return category;

  const value = category.trim();
  if (/^\d+$/.test(value)) return parseInt(value, 10);

  const exact = await db
    .prepare('SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
    .bind(userId, value)
    .first<{ id: number }>();
  if (exact) return exact.id;

  const partial = await db
    .prepare('SELECT id FROM categories WHERE user_id = ? AND LOWER(name) LIKE LOWER(?) LIMIT 1')
    .bind(userId, `%${value}%`)
    .first<{ id: number }>();
  return partial?.id;
}

/**
 * Resolve "eggs" or 7 to an item id, without creating one.
 * `add_transaction` and `log_price` create on demand through their services.
 */
async function resolveItemId(
  db: D1Database, userId: number, item: string | number | undefined,
): Promise<number | undefined> {
  if (item === undefined || item === null) return undefined;
  if (typeof item === 'number') return item;

  const value = item.trim();
  if (/^\d+$/.test(value)) return parseInt(value, 10);

  const row = await db
    .prepare('SELECT id FROM items WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1')
    .bind(userId, value)
    .first<{ id: number }>();
  return row?.id;
}

// ---------------------------------------------------------------- registry

export const TOOLS: Record<string, ToolSpec> = {
  // ------------------------------------------------------------ transactions
  add_transaction: {
    definition: {
      type: 'function',
      function: {
        name: 'add_transaction',
        description:
          'Record one purchase or income. Collect enough detail before calling: for a meal, where and what, not just the amount. Writes immediately — there is no confirmation step, so only call this once the user has said what happened. If the purchase was of a specific item, pass `item` so a price observation is recorded at the same time.',
        parameters: {
          type: 'object',
          properties: {
            amount: num('Amount actually paid, in decimal units (e.g. 23.5).'),
            currency: str('Three-letter code, e.g. CNY.'),
            date: str(`When it happened. Omit it when the user means today — the server fills in their calendar day. ${DATE_DESC}`),
            category: {
              type: ['string', 'number'],
              description: 'Category name or id. Prefer a leaf category such as "lunch" over a parent.',
            },
            description: str('What it was, in the user\'s own words.'),
            item: {
              type: 'object',
              description: 'Set only when the purchase was of a named item (which also records its price).',
              properties: {
                name: str('Item name, e.g. "eggs".'),
                unit_price: num('Price per unit. Omit to use the amount paid.'),
                quantity: num('How many units.'),
                unit: str('A unit code from list_units, e.g. piece. Omit if the wording maps to nothing.'),
                unit_raw: str('The unit exactly as the user said it, e.g. "个" or "斤". Always set this when the user named a unit, and never convert it to another unit.'),
                merchant: str('Shop name as said, e.g. "永辉超市".'),
              },
              required: ['name'],
            },
            subscription_id: num('Set when this transaction is a subscription renewal.'),
          },
          required: ['amount', 'currency', 'category'],
        },
      },
    },
    run: async (ctx, args) => {
      const categoryId = await resolveCategoryId(ctx.db, ctx.userId, args.category);
      if (categoryId === undefined) {
        return { error: `No category matches "${args.category}"` };
      }
      return createTransaction(ctx.db, ctx.userId, {
        amount: args.amount,
        currency: args.currency,
        // Undefined when the user meant today: the service dates it in their zone.
        date: args.date,
        timezone: ctx.timezone,
        category_id: categoryId,
        description: args.description ?? null,
        source: 'ai',
        subscription_id: args.subscription_id ?? null,
        item: args.item
          ? {
              item_name: args.item.name,
              unit_price: args.item.unit_price,
              quantity: args.item.quantity,
              unit: args.item.unit ?? null,
              unit_raw: args.item.unit_raw ?? null,
              merchant: args.item.merchant ?? null,
            }
          : null,
      });
    },
  },

  update_transaction: {
    definition: {
      type: 'function',
      function: {
        name: 'update_transaction',
        description:
          'Correct an existing transaction. This is how a mistake is fixed ("actually 35", "that one was transport"): the edit is invisible and there is no change log, so the user only ever sees the corrected report. Pass only the fields that change.',
        parameters: {
          type: 'object',
          properties: {
            id: num('The transaction id, from find_transactions.'),
            amount: num('New amount.'),
            currency: str('New currency.'),
            date: str(`New ${DATE_DESC.toLowerCase()}`),
            category: { type: ['string', 'number'], description: 'New category name or id.' },
            description: str('New description.'),
          },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      const categoryId = await resolveCategoryId(ctx.db, ctx.userId, args.category);
      if (args.category !== undefined && categoryId === undefined) {
        return { error: `No category matches "${args.category}"` };
      }
      return updateTransaction(ctx.db, ctx.userId, args.id, {
        amount: args.amount,
        currency: args.currency,
        // Only forwarded when the model supplies one; an update never invents a
        // new date, and an existing date is never shifted into another zone.
        date: args.date,
        category_id: categoryId,
        description: args.description,
      });
    },
  },

  delete_transaction: {
    definition: {
      type: 'function',
      function: {
        name: 'delete_transaction',
        description:
          'Delete a transaction. Use this to undo a duplicate or a wrong entry. The price observation recorded with it is removed too, so it stops counting towards the item\'s price history.',
        parameters: {
          type: 'object',
          properties: { id: num('The transaction id.') },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      await deleteTransaction(ctx.db, ctx.userId, args.id);
      return { deleted: true, id: args.id };
    },
  },

  find_transactions: {
    definition: {
      type: 'function',
      function: {
        name: 'find_transactions',
        description:
          'Search recorded transactions. Use before writing when the user might be repeating something, to answer "how much did I spend on X", or to find entries that are too vague to be useful. Returns a bounded number of rows.',
        parameters: {
          type: 'object',
          properties: {
            date_from: str(DATE_DESC),
            date_to: str(DATE_DESC),
            category: { type: ['string', 'number'], description: 'Category name or id (includes subcategories).' },
            amount: num('Exact amount to match, for spotting a duplicate.'),
            keyword: str('Substring to look for in the description.'),
            missing_detail: {
              type: 'boolean',
              description:
                'true returns only entries that are NOT detailed enough — missing any of: product name, unit, quantity. false returns only the well-recorded ones. Use this when the user asks what needs filling in; do not try to find these by paging through everything.',
            },
            missing_field: {
              type: 'string',
              enum: ['item', 'unit', 'quantity', 'description'],
              description: 'Narrow the above to one specific missing field.',
            },
            limit: num('Maximum rows, capped at 50.'),
          },
        },
      },
    },
    run: async (ctx, args) => findTransactions(ctx.db, ctx.userId, {
      date_from: args.date_from,
      date_to: args.date_to,
      category_id: await resolveCategoryId(ctx.db, ctx.userId, args.category),
      amount: args.amount,
      keyword: args.keyword,
      missing_detail: args.missing_detail,
      missing_field: args.missing_field,
      limit: args.limit,
    }),
  },

  summarize: {
    definition: {
      type: 'function',
      function: {
        name: 'summarize',
        description:
          'Get spending totals grouped by category, month or day. Always use this for any total or trend question: never add up amounts yourself, and never quote a figure that did not come from this call or from the snapshot.',
        parameters: {
          type: 'object',
          properties: {
            group_by: { type: 'string', enum: ['category', 'month', 'day'], description: 'How to group.' },
            date_from: str(DATE_DESC),
            date_to: str(DATE_DESC),
            currency: str('Currency to total in. Defaults to CNY.'),
          },
          required: ['group_by'],
        },
      },
    },
    run: async (ctx, args) => summarize(ctx.db, ctx.userId, {
      group_by: args.group_by,
      date_from: args.date_from,
      date_to: args.date_to,
      currency: args.currency,
    }),
  },

  // -------------------------------------------------------------- categories
  list_categories: {
    definition: {
      type: 'function',
      function: {
        name: 'list_categories',
        description: 'List the user\'s categories, with parents and children. Call this before guessing which category something belongs to.',
        parameters: { type: 'object', properties: {} },
      },
    },
    run: async (ctx) => listCategories(ctx.db, ctx.userId, true),
  },

  add_category: {
    definition: {
      type: 'function',
      function: {
        name: 'add_category',
        description:
          'Create a category. A subcategory must have the same type as its parent, and categories may not be nested more than two levels deep — both are rejected, not silently accepted.',
        parameters: {
          type: 'object',
          properties: {
            name: str('Category name.'),
            type: { type: 'string', enum: ['income', 'expense'], description: 'Income or expense.' },
            parent: { type: ['string', 'number'], description: 'Parent category name or id, for a subcategory.' },
          },
          required: ['name', 'type'],
        },
      },
    },
    run: async (ctx, args) => {
      const parentId = await resolveCategoryId(ctx.db, ctx.userId, args.parent);
      if (args.parent !== undefined && parentId === undefined) {
        return { error: `No category matches "${args.parent}"` };
      }
      return createCategory(ctx.db, ctx.userId, {
        name: args.name, type: args.type, parent_id: parentId ?? null,
      });
    },
  },

  rename_category: {
    definition: {
      type: 'function',
      function: {
        name: 'rename_category',
        description: 'Rename a category, or move it under another one by passing `parent`.',
        parameters: {
          type: 'object',
          properties: {
            id: num('The category id.'),
            name: str('The new name.'),
            parent: { type: ['string', 'number'], description: 'New parent, to move the category. Pass null to make it top-level.' },
          },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      const parentId = await resolveCategoryId(ctx.db, ctx.userId, args.parent);
      if (args.parent !== undefined && args.parent !== null && parentId === undefined) {
        return { error: `No category matches "${args.parent}"` };
      }
      return updateCategory(ctx.db, ctx.userId, args.id, {
        name: args.name,
        ...(args.parent !== undefined ? { parent_id: parentId ?? null } : {}),
      });
    },
  },

  delete_category: {
    definition: {
      type: 'function',
      function: {
        name: 'delete_category',
        description:
          'Delete a category. This is refused while any transaction still uses it — if that happens, tell the user plainly which category is still in use rather than claiming success.',
        parameters: {
          type: 'object',
          properties: { id: num('The category id.') },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      await deleteCategory(ctx.db, ctx.userId, args.id);
      return { deleted: true, id: args.id };
    },
  },

  // ------------------------------------------------------------------- items
  list_items: {
    definition: {
      type: 'function',
      function: {
        name: 'list_items',
        description: 'List tracked items, optionally with purchase and price statistics.',
        parameters: {
          type: 'object',
          properties: {
            with_stats: { type: 'boolean', description: 'Include totals, average price and last price.' },
          },
        },
      },
    },
    run: async (ctx, args) => listItems(ctx.db, ctx.userId, args.with_stats === true),
  },

  add_item: {
    definition: {
      type: 'function',
      function: {
        name: 'add_item',
        description: 'Track a new item by name. Adding a price for an unknown item does this implicitly, so only call it when no price is involved.',
        parameters: {
          type: 'object',
          properties: { name: str('Item name.') },
          required: ['name'],
        },
      },
    },
    run: async (ctx, args) => createItem(ctx.db, ctx.userId, args.name),
  },

  rename_item: {
    definition: {
      type: 'function',
      function: {
        name: 'rename_item',
        description: 'Rename an item.',
        parameters: {
          type: 'object',
          properties: { id: num('The item id.'), name: str('The new name.') },
          required: ['id', 'name'],
        },
      },
    },
    run: async (ctx, args) => renameItem(ctx.db, ctx.userId, args.id, args.name),
  },

  delete_item: {
    definition: {
      type: 'function',
      function: {
        name: 'delete_item',
        description:
          'Delete an item AND every price ever recorded for it. That history is not recoverable, so say so before calling this. The purchases themselves are kept — only the price records go.',
        parameters: {
          type: 'object',
          properties: { id: num('The item id.') },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      await deleteItem(ctx.db, ctx.userId, args.id);
      return { deleted: true, id: args.id };
    },
  },

  // ------------------------------------------------------------------ prices
  log_price: {
    definition: {
      type: 'function',
      function: {
        name: 'log_price',
        description:
          'Record a price that was seen, with or without a purchase — this is the main way shelf prices get tracked ("eggs are 15 at the corner shop"). Call list_units first and map the wording onto one of those codes, and always pass `unit_raw` with the user\'s own wording. NEVER convert a unit: 斤 and 打 are not kg or piece, so record the number exactly as said and leave `unit` empty rather than translating it. A converted number is a wrong number.',
        parameters: {
          type: 'object',
          properties: {
            item: { type: ['string', 'number'], description: 'Item name or id. A name that is unknown is created.' },
            unit_price: num('Price per unit, decimal.'),
            currency: str('Three-letter code. Defaults to CNY.'),
            quantity: num('How many units at that price.'),
            unit: str('A unit code from list_units, e.g. piece.'),
            unit_raw: str('The unit exactly as the user said it, e.g. "个" or "斤". Never converted.'),
            merchant: str('Shop name as said.'),
            observed_on: str(`The date the price was seen. Defaults to today. ${DATE_DESC}`),
            transaction_id: num('Link to a purchase, when this price came with one.'),
          },
          required: ['item', 'unit_price'],
        },
      },
    },
    run: async (ctx, args) => {
      const itemId = await resolveItemId(ctx.db, ctx.userId, args.item);
      return logPrice(ctx.db, ctx.userId, {
        // An unresolved name is handed over as a name so the service creates it.
        item_id: itemId ?? null,
        item_name: itemId === undefined && typeof args.item === 'string' ? args.item : null,
        unit_price: args.unit_price,
        quantity: args.quantity,
        unit: args.unit ?? null,
        unit_raw: args.unit_raw ?? null,
        currency: args.currency,
        merchant: args.merchant,
        observed_on: args.observed_on,
        transaction_id: args.transaction_id,
        timezone: ctx.timezone,
      });
    },
  },

  price_stats: {
    definition: {
      type: 'function',
      function: {
        name: 'price_stats',
        description:
          'Price history for an item, grouped by unit and normalised to a cost per unit, computed in SQL. Use this whenever the user asks whether something is more expensive than before, or when they buy a different size of the same product. Prices in different units are returned separately because they cannot be compared — mention them, but do not average them or convert between them. Never estimate a price or a difference from remembered numbers.',
        parameters: {
          type: 'object',
          properties: {
            item: { type: ['string', 'number'], description: 'Item name or id.' },
            unit: str('The unit to compare on, e.g. ml. Call list_units first. Omit only when you have no unit to compare on.'),
          },
          required: ['item'],
        },
      },
    },
    run: async (ctx, args) => {
      const itemId = await resolveItemId(ctx.db, ctx.userId, args.item);
      if (itemId === undefined) return { error: `No item matches "${args.item}"` };

      const [breakdown, history, byMerchant] = await Promise.all([
        priceBreakdown(ctx.db, ctx.userId, itemId, args.unit ?? undefined),
        listPrices(ctx.db, ctx.userId, { item_id: itemId, limit: 20 }),
        compareMerchants(ctx.db, ctx.userId, itemId),
      ]);

      return {
        item_id: itemId,
        // Cost per unit within the requested unit. `average_per_unit` already
        // divides by quantity in SQL, so no arithmetic is left to you.
        comparable: breakdown.comparable,
        // Same product, other units. Report these; never fold them in.
        other_units: breakdown.other_units,
        // Observations with no unit cannot be normalised at all.
        without_unit: breakdown.without_unit,
        recent: history,
        by_merchant: byMerchant,
      };
    },
  },

  update_price: {
    definition: {
      type: 'function',
      function: {
        name: 'update_price',
        description: 'Correct a recorded price observation.',
        parameters: {
          type: 'object',
          properties: {
            id: num('The price observation id.'),
            unit_price: num('Corrected price per unit.'),
            quantity: num('Corrected quantity.'),
            unit: str('Corrected unit code.'),
            unit_raw: str('Corrected unit wording.'),
            merchant: str('Corrected shop name.'),
            observed_on: str(DATE_DESC),
          },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => updatePrice(ctx.db, ctx.userId, args.id, {
      unit_price: args.unit_price,
      quantity: args.quantity,
      unit: args.unit,
      unit_raw: args.unit_raw,
      merchant: args.merchant,
      observed_on: args.observed_on,
    }),
  },

  delete_price: {
    definition: {
      type: 'function',
      function: {
        name: 'delete_price',
        description: 'Retract a price observation that was recorded by mistake.',
        parameters: {
          type: 'object',
          properties: { id: num('The price observation id.') },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      await deletePrice(ctx.db, ctx.userId, args.id);
      return { deleted: true, id: args.id };
    },
  },

  list_units: {
    definition: {
      type: 'function',
      function: {
        name: 'list_units',
        description:
          'The unit vocabulary. Call this before writing any price with a unit, and map what the user said onto one of these codes. If nothing fits, do not invent one: leave the code out and pass the wording as unit_raw.',
        parameters: { type: 'object', properties: {} },
      },
    },
    run: async (ctx) => listUnits(ctx.db),
  },

  // ----------------------------------------------------------- subscriptions
  list_subscriptions: {
    definition: {
      type: 'function',
      function: {
        name: 'list_subscriptions',
        description: 'List subscriptions, including archived ones when asked.',
        parameters: {
          type: 'object',
          properties: {
            include_archived: { type: 'boolean', description: 'Include paused/archived subscriptions.' },
          },
        },
      },
    },
    run: async (ctx, args) => listSubscriptions(ctx.db, ctx.userId, args.include_archived === true),
  },

  add_subscription: {
    definition: {
      type: 'function',
      function: {
        name: 'add_subscription',
        description: 'Add a recurring subscription.',
        parameters: {
          type: 'object',
          properties: {
            name: str('Subscription name.'),
            amount: num('Amount per cycle, decimal.'),
            currency: str('Three-letter code.'),
            end_date: str(`When the current paid period ends. ${DATE_DESC}`),
            cycle: num('Length of one cycle in days, e.g. 30.'),
            category: { type: ['string', 'number'], description: 'Expense category name or id.' },
            icon: str('Short icon hint, optional.'),
          },
          required: ['name', 'end_date'],
        },
      },
    },
    run: async (ctx, args) => {
      const categoryId = await resolveCategoryId(ctx.db, ctx.userId, args.category);
      if (args.category !== undefined && categoryId === undefined) {
        return { error: `No category matches "${args.category}"` };
      }
      return createSubscription(ctx.db, ctx.userId, {
        name: args.name,
        amount: args.amount,
        currency: args.currency,
        end_date: args.end_date,
        cycle: args.cycle,
        category_id: categoryId ?? null,
        icon: args.icon,
      });
    },
  },

  update_subscription: {
    definition: {
      type: 'function',
      function: {
        name: 'update_subscription',
        description: 'Change a subscription\'s amount, cycle, end date, name or category.',
        parameters: {
          type: 'object',
          properties: {
            id: num('The subscription id.'),
            name: str('New name.'),
            amount: num('New amount per cycle.'),
            currency: str('New currency.'),
            end_date: str(`New period end. ${DATE_DESC}`),
            cycle: num('New cycle length in days.'),
            category: { type: ['string', 'number'], description: 'New category name or id.' },
          },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      const categoryId = await resolveCategoryId(ctx.db, ctx.userId, args.category);
      if (args.category !== undefined && categoryId === undefined) {
        return { error: `No category matches "${args.category}"` };
      }
      return updateSubscription(ctx.db, ctx.userId, args.id, {
        name: args.name,
        amount: args.amount,
        currency: args.currency,
        end_date: args.end_date,
        cycle: args.cycle,
        ...(args.category !== undefined ? { category_id: categoryId ?? null } : {}),
      });
    },
  },

  renew_subscription: {
    definition: {
      type: 'function',
      function: {
        name: 'renew_subscription',
        description:
          'Renew a subscription: advances the period end by one cycle and records the expense. This is what resolves an overdue subscription. Requires an expense category (from the subscription, or pass one).',
        parameters: {
          type: 'object',
          properties: {
            id: num('The subscription id.'),
            amount: num('Amount charged this time. Defaults to the subscription amount.'),
            currency: str('Currency charged. Defaults to the subscription currency.'),
            date: str(`Date of the renewal. Defaults to today. ${DATE_DESC}`),
            category: { type: ['string', 'number'], description: 'Expense category name or id.' },
            create_transaction: { type: 'boolean', description: 'Set false to advance the date without recording an expense.' },
            description: str('Description for the renewal transaction.'),
          },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => {
      const categoryId = await resolveCategoryId(ctx.db, ctx.userId, args.category);
      if (args.category !== undefined && categoryId === undefined) {
        return { error: `No category matches "${args.category}"` };
      }
      return renewSubscription(ctx.db, ctx.userId, args.id, {
        amount: args.amount,
        currency: args.currency,
        date: args.date,
        category_id: categoryId,
        create_transaction: args.create_transaction,
        description: args.description,
        source: 'ai',
        timezone: ctx.timezone,
      });
    },
  },

  archive_subscription: {
    definition: {
      type: 'function',
      function: {
        name: 'archive_subscription',
        description: 'Pause a subscription without deleting it or its history.',
        parameters: {
          type: 'object',
          properties: { id: num('The subscription id.') },
          required: ['id'],
        },
      },
    },
    run: async (ctx, args) => archiveSubscription(ctx.db, ctx.userId, args.id),
  },

  // ------------------------------------------------------------------ memory
  remember: {
    definition: {
      type: 'function',
      function: {
        name: 'remember',
        description:
          'Replace your memory note about this user. Keep habits, preferences and context ("the usual lunch place is X", "supermarket shopping counts as Food"). Do NOT store numbers or totals: every figure is recomputed each turn, and a remembered number goes stale silently. The limit is 2000 characters; if you exceed it you will be told, and should compress.',
        parameters: {
          type: 'object',
          properties: { text: str('The full replacement note, or an empty string to clear it.') },
          required: ['text'],
        },
      },
    },
    run: async (ctx, args) => writeMemory(ctx.db, ctx.userId, args.text ?? null),
  },

  recall: {
    definition: {
      type: 'function',
      function: {
        name: 'recall',
        description: 'Read your current memory note about this user.',
        parameters: { type: 'object', properties: {} },
      },
    },
    run: async (ctx) => readMemory(ctx.db, ctx.userId),
  },

  // ------------------------------------------------------------ ledger_days
  // Marking a day is how the reminders stop. Without these the assistant could
  // only agree in words when told "I spent nothing that day", and the same day
  // would come back every time the app opened.
  mark_no_spend: {
    definition: {
      type: 'function',
      function: {
        name: 'mark_no_spend',
        description:
          'Record that the user confirmed nothing was spent on a day, so you stop asking about it. Only call this when they actually said so — never because the day merely looks empty.',
        parameters: {
          type: 'object',
          properties: { date: str(`The day being confirmed. ${DATE_DESC}`) },
          required: ['date'],
        },
      },
    },
    run: async (ctx, args) => markLedgerDay(ctx.db, ctx.userId, args.date, 'no_spend'),
  },

  mark_partial: {
    definition: {
      type: 'function',
      function: {
        name: 'mark_partial',
        description:
          'Record that a day is only partly accounted for: something is recorded but the user has not confirmed it is complete, so keep asking about it. Use this after taking a few entries for a day you had asked about.',
        parameters: {
          type: 'object',
          properties: { date: str(`The day only partly recorded. ${DATE_DESC}`) },
          required: ['date'],
        },
      },
    },
    run: async (ctx, args) => markLedgerDay(ctx.db, ctx.userId, args.date, 'partial'),
  },

  gaps: {
    definition: {
      type: 'function',
      function: {
        name: 'gaps',
        description:
          'Re-read the outstanding reminders: days with nothing recorded, and subscriptions whose period has passed without a renewal. The same list is already in your context each turn, so use this when you need it fresh — for example after the user has answered about a day.',
        parameters: { type: 'object', properties: {} },
      },
    },
    run: async (ctx) => findGaps(ctx.db, ctx.userId, { timezone: ctx.timezone }),
  },

  // --------------------------------------------------------------- merchants
  resolve_merchant: {
    definition: {
      type: 'function',
      function: {
        name: 'resolve_merchant',
        description:
          'Turn a shop name into one merchant, creating it if it is new. Use this to tell that two spellings are the same shop — pass the name the user just said as `name` and another spelling of the same shop as `alias`, and every price at either spelling then compares as one merchant. Without it "永辉" and "永辉超市" stay two shops and comparing them is meaningless.',
        parameters: {
          type: 'object',
          properties: {
            name: str('The shop name, as the user said it.'),
            alias: str('Another spelling that means the same shop, to record as an alias.'),
          },
          required: ['name'],
        },
      },
    },
    run: async (ctx, args) => {
      const resolved = await resolveMerchant(ctx.db, ctx.userId, args.name);
      let aliased: string | null = null;
      if (args.alias && resolved.merchant_id !== null) {
        await addMerchantAlias(ctx.db, ctx.userId, resolved.merchant_id, args.alias);
        aliased = args.alias;
      }
      return { merchant: resolved.merchant, merchant_id: resolved.merchant_id, alias_added: aliased };
    },
  },
};

/** The definitions handed to the provider. */
export function toolDefinitions(): ToolDefinition[] {
  return Object.values(TOOLS).map(t => t.definition);
}

/**
 * Run one tool call.
 *
 * Never throws: a `ServiceError` becomes `{ok:false, error}` with its code, and
 * an unexpected failure is caught and reported the same way. The model sees the
 * failure and can correct itself, which is the whole point of §5.1's "the tool
 * must relay the 409 honestly, not pretend it succeeded".
 */
export async function runTool(
  ctx: ToolContext, name: string, rawArguments: string,
): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) {
    return { ok: false, code: 'UNKNOWN_TOOL', error: `There is no tool named "${name}".` };
  }

  let args: any = {};
  if (rawArguments && rawArguments.trim().length > 0) {
    try {
      args = JSON.parse(rawArguments);
    } catch {
      return {
        ok: false,
        code: 'INVALID_ARGUMENTS',
        error: `Arguments for ${name} were not valid JSON: ${rawArguments.slice(0, 200)}`,
      };
    }
  }

  try {
    const data = await tool.run(ctx, args);
    // A tool may report a recoverable problem by returning { error }.
    if (data && typeof data === 'object' && 'error' in (data as any) && !('id' in (data as any))) {
      return { ok: false, code: 'TOOL_REPORTED_ERROR', error: String((data as any).error) };
    }
    return { ok: true, data };
  } catch (e) {
    // `asServiceError` also recognises a DDL trigger violation (migrations/006),
    // so a structural rule broken by a tool call comes back as a fixable 400
    // with its code instead of an opaque TOOL_FAILED. That is what lets the
    // model retry the call correctly rather than give up (R6).
    const serviceError = asServiceError(e);
    if (serviceError) {
      return {
        ok: false,
        code: serviceError.code ?? `HTTP_${serviceError.status}`,
        error: serviceError.message,
        ...(serviceError.details ? { data: serviceError.details } : {}),
      };
    }
    return {
      ok: false,
      code: 'TOOL_FAILED',
      error: String((e as any)?.message ?? e),
    };
  }
}
