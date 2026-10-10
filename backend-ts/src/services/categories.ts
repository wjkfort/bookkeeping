/**
 * Category reads and writes.
 *
 * Extracted from `src/api/categories.ts` so the HTTP handlers and the AI tools
 * (`list_categories`, `add_category`, `rename_category`, `move_category`,
 * `delete_category`) share one implementation.
 *
 * The two structural rules the schema and the requirements doc always claimed
 * were enforced, and which were in fact absent from the codebase until
 * 2026-10-09, are:
 *
 *   - depth <= 2 (a child may not have children of its own)
 *   - child.type === parent.type
 *
 * Both are load-bearing for correctness, not cosmetics. `summary.ts` buckets
 * spending by joining `categories` for `c.type` and rolls a child up to its
 * parent with a single `LEFT JOIN` (one level). A third level would be counted
 * under a *non-root* parent that the roll-up never visits, and an income child
 * under an expense parent would have its amount classed by whichever type the
 * query happened to read. Either way a report number silently becomes wrong,
 * which R6 forbids.
 *
 * ENFORCEMENT LIVES IN THE DATABASE. `migrations/006` installs BEFORE
 * INSERT/UPDATE triggers on `categories` (a CHECK cannot express either rule,
 * because both compare the row against other rows and a CHECK may not hold a
 * subquery). This module keeps `assertParentAllowed` as a fast path that
 * produces a precise message — a 404 for a missing parent, prose naming the
 * rule — and converts a trigger's verdict into the same `ServiceError` shape
 * through `asServiceError`. The DDL is what makes the rule unbypassable; this
 * file is what makes the common failures pleasant to read.
 */

import type { Category, CreateCategoryRequest, UpdateCategoryRequest } from '../types';
import { asServiceError, badRequest, conflict, notFound, serverError } from './errors';

/** A child may not have children: the tree is at most two levels. */
export const MAX_CATEGORY_DEPTH = 2;

/** Build the root-first tree the API returns when `flat` is not requested. */
export function buildCategoryTree(categories: Category[]): Category[] {
  const categoryMap = new Map<number, Category>();
  const rootCategories: Category[] = [];

  categories.forEach(cat => {
    categoryMap.set(cat.id, { ...cat, children: [] });
  });

  categories.forEach(cat => {
    const category = categoryMap.get(cat.id)!;
    if (cat.parent_id === null) {
      rootCategories.push(category);
    } else {
      const parent = categoryMap.get(cat.parent_id);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(category);
      }
    }
  });

  return rootCategories;
}

/**
 * Categories store `translations` as JSON text; the wire shape has an object.
 *
 * A row whose text is not JSON used to throw out of `JSON.parse` and take the
 * whole category list down with a 500 — one bad row, every request. The column
 * is only TEXT in the schema, so this cannot be assumed away: return null (a
 * category with no translations is a valid thing to render) and leave a trail.
 * The trigger in migration 007 now refuses new values that are not JSON, so
 * this is about rows written before that.
 */
function parseTranslations(raw: unknown, categoryId?: number) {
  if (!raw) return null;
  try {
    return JSON.parse(raw as string);
  } catch {
    console.warn(`categories.translations is not JSON (category ${categoryId}): ignored`);
    return null;
  }
}

/** Categories are stored with `translations` as JSON text; the wire shape has an object. */
function toCategory(row: Category): Category {
  return { ...row, translations: parseTranslations(row.translations, row.id) };
}

export async function listCategories(
  db: D1Database, userId: number, flat = false,
): Promise<Category[] | Category[]> {
  const { results } = await db
    .prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY created_at ASC')
    .bind(userId)
    .all<Category>();

  const categories = results.map(toCategory);
  return flat ? categories : buildCategoryTree(categories);
}

export async function fetchCategory(
  db: D1Database, userId: number, id: number,
): Promise<Category | null> {
  const row = await db
    .prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Category>();
  return row ? toCategory(row) : null;
}

/**
 * Reject a parent that would break the two structural rules.
 * `selfId` excludes the category being moved from its own ancestry checks.
 */
async function assertParentAllowed(
  db: D1Database, userId: number, parentId: number, childType: string, selfId?: number,
): Promise<void> {
  if (selfId !== undefined && parentId === selfId) {
    throw badRequest('A category cannot be its own parent');
  }

  const parent = await db
    .prepare('SELECT id, parent_id, type FROM categories WHERE id = ? AND user_id = ?')
    .bind(parentId, userId)
    .first<{ id: number; parent_id: number | null; type: string }>();

  if (!parent) {
    throw notFound('Parent category not found');
  }

  // Depth: the parent must already be a root, otherwise the new child sits at
  // level 3 and no summary can roll it up correctly.
  if (parent.parent_id !== null) {
    throw badRequest(
      `Categories may not be nested more than ${MAX_CATEGORY_DEPTH} levels deep`,
    );
  }

  if (parent.type !== childType) {
    throw badRequest('A subcategory must have the same type as its parent');
  }
}

export async function createCategory(
  db: D1Database, userId: number, input: CreateCategoryRequest,
): Promise<Category> {
  const { name, type, parent_id, translations } = input;

  if (!name || !type) {
    throw badRequest('Name and type are required');
  }

  if (type !== 'income' && type !== 'expense') {
    throw badRequest('Type must be income or expense');
  }

  if (parent_id !== undefined && parent_id !== null) {
    await assertParentAllowed(db, userId, parent_id, type);
  }

  const translationsJson = translations ? JSON.stringify(translations) : null;

  // Written explicitly rather than left to `DEFAULT (datetime('now'))`: the
  // default produces `2026-10-10 08:04:52` while everything else here writes
  // `toISOString()`, and the two sort differently as text (`' '` < `'T'`), which
  // `listCategories`' `ORDER BY created_at` would quietly get wrong. Migration
  // 007 normalised the rows that predate this.
  let result: Category | null;
  try {
    result = await db
      .prepare(
        'INSERT INTO categories (name, type, parent_id, translations, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
      )
      .bind(name, type, parent_id || null, translationsJson, userId, new Date().toISOString())
      .first<Category>();
  } catch (error) {
    // `assertParentAllowed` above is a fast path for a precise message; the
    // triggers in migrations/006 are the guarantee. Translating their verdict
    // here keeps this function's contract — caller-fixable problems leave as
    // `ServiceError`, never as a raw driver error.
    throw asServiceError(error) ?? error;
  }

  if (!result) {
    throw serverError('Failed to create category');
  }

  return toCategory(result);
}

export async function updateCategory(
  db: D1Database, userId: number, id: number, body: UpdateCategoryRequest,
): Promise<Category> {
  const updates: string[] = [];
  const values: any[] = [];

  if (body.type !== undefined && (body.type !== 'income' && body.type !== 'expense')) {
    throw badRequest('Type must be income or expense');
  }

  // Anything that touches structure needs the current row: to know its type
  // when only the parent changes, and to check its children before either a
  // type change or a reparent would break the two structural rules.
  const restructures =
    (body.parent_id !== undefined && body.parent_id !== null) || body.type !== undefined;

  let hasChildren = false;
  if (restructures) {
    const current = await fetchCategory(db, userId, id);
    if (!current) {
      throw notFound('Category not found');
    }

    // The parent rules are checked against the type the category will actually
    // have after this update, which may be the one being set right now.
    if (body.parent_id !== undefined && body.parent_id !== null) {
      await assertParentAllowed(db, userId, body.parent_id, body.type ?? current.type, id);
    }

    hasChildren = !!(await db
      .prepare('SELECT id FROM categories WHERE parent_id = ? AND user_id = ? LIMIT 1')
      .bind(id, userId)
      .first());

    // A category with children may not move under another category: its
    // children would land on level 3.
    if (hasChildren && body.parent_id !== undefined && body.parent_id !== null) {
      throw badRequest(
        `Categories may not be nested more than ${MAX_CATEGORY_DEPTH} levels deep`,
      );
    }

    // A type change must not leave children of a different type behind.
    if (hasChildren && body.type !== undefined) {
      const mismatched = await db
        .prepare('SELECT id FROM categories WHERE parent_id = ? AND user_id = ? AND type <> ? LIMIT 1')
        .bind(id, userId, body.type)
        .first();
      if (mismatched) {
        throw badRequest('A category with children must keep the type its children have');
      }
    }
  }

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.type !== undefined) {
    updates.push('type = ?');
    values.push(body.type);
  }
  if (body.parent_id !== undefined) {
    updates.push('parent_id = ?');
    values.push(body.parent_id);
  }
  if (body.translations !== undefined) {
    updates.push('translations = ?');
    values.push(JSON.stringify(body.translations));
  }

  if (updates.length === 0) {
    throw badRequest('No fields to update');
  }

  values.push(id, userId);

  let result: Category | null;
  try {
    result = await db
      .prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND user_id = ? RETURNING *`)
      .bind(...values)
      .first<Category>();
  } catch (error) {
    // The checks above cover the moves this file anticipates. The one it used
    // to miss — retyping a leaf so that it no longer matches the parent it
    // hangs under — is caught by the UPDATE trigger (migrations/006); reporting
    // its code is what makes that a 400 instead of a 500.
    throw asServiceError(error) ?? error;
  }

  if (!result) {
    throw notFound('Category not found');
  }

  return toCategory(result);
}

/**
 * Delete a category, refusing while it still has transactions.
 *
 * v2 changed `transactions.category_id` from ON DELETE CASCADE to RESTRICT, so
 * deleting a category no longer destroys its transactions. The count is read
 * first so the caller gets a 409 with the number instead of a raw constraint
 * error.
 */
export async function deleteCategory(
  db: D1Database, userId: number, id: number,
): Promise<void> {
  const inUse = await db
    .prepare(
      `SELECT COUNT(*) as count FROM transactions
       WHERE category_id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<{ count: number }>();

  if (inUse && inUse.count > 0) {
    throw conflict('Category still has transactions', {
      code: 'CATEGORY_IN_USE',
      transaction_count: inUse.count,
    });
  }

  try {
    const result = await db
      .prepare('DELETE FROM categories WHERE id = ? AND user_id = ? RETURNING id')
      .bind(id, userId)
      .first();

    if (!result) {
      throw notFound('Category not found');
    }
  } catch (error: any) {
    // A child category can still reference transactions, which blocks the
    // parent's cascade. Same conflict, different path.
    if (error?.message?.includes('FOREIGN KEY constraint')) {
      throw conflict('Category still has transactions', { code: 'CATEGORY_IN_USE' });
    }
    throw error;
  }
}
