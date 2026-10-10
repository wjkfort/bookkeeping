-- Migration 006 — the category structure rules become real constraints.
--
-- Run AFTER 000–005.
--   npx wrangler d1 execute bookkeeping-db --remote --file=migrations/006_category_structure_triggers.sql
--
-- ---------------------------------------------------------------------------
-- Why triggers and not CHECK constraints
--
-- Both rules compare a row against *other rows* of the same table:
--
--   depth <= 2              the parent must itself be a root
--   child.type = parent.type
--   child.user_id = parent.user_id
--
-- A SQLite `CHECK` may not contain a subquery, so none of them can be expressed
-- as one. `PRAGMA foreign_keys` cannot express them either: the parent reference
-- is valid, it is the parent's *shape* or *owner* that is wrong. A trigger is the
-- only mechanism the database offers, so this is where the rules have to live if
-- they are to bite at all.
--
-- The first two matter because `src/api/summary.ts` buckets spending by `c.type`
-- and rolls a child up to its parent with exactly one `LEFT JOIN`. A third level
-- sits under a non-root parent the roll-up never visits, and a child of the other
-- type is counted by whichever side the query happened to read. Either way a
-- report number silently becomes wrong, which R6 forbids — and silent is the
-- problem: a wrong total looks exactly like a correct one.
--
-- The user_id rule is not about reports. `buildCategoryTree` in
-- `src/services/categories.ts` silently drops a category whose `parent_id` is not
-- in the map it was given, and that map is built from one user's rows — so a
-- cross-user child would simply disappear from the UI while remaining in the
-- database, which is the worst of both. `assertParentAllowed()` already returns
-- 404 for it on the service paths (404 rather than 403 on purpose: it does not
-- confirm that the other user's category exists), so this trigger guards the
-- paths that do not go through the service layer.
--
-- ---------------------------------------------------------------------------
-- Why they are being added now
--
-- Until 2026-10-09 the rules existed only as a claim in this docstring family
-- ("enforced in the API"); nothing enforced them anywhere. That date added
-- `assertParentAllowed()` to `src/services/categories.ts`, which fixed the write
-- paths that go through the service layer — but left every other way into the
-- table unguarded, and left one hole *inside* the service layer: a leaf's `type`
-- could be changed without consulting its parent, so a child could be retyped to
-- the opposite of the category it hangs under. The DDL is the only place that
-- every writer must go through.
--
-- Data check before writing this file: max depth 2, 0 type mismatches, 0
-- self-references, 0 cross-user parents, across all 68 rows. The triggers
-- therefore reject only writes that would have corrupted the reports.
--
-- ---------------------------------------------------------------------------
-- Consequence worth knowing before you hit it
--
-- A category and its children can no longer be retyped one at a time: retyping
-- the parent fails while a child still has the old type, and retyping the child
-- first fails because the parent still has it. To change the type of a subtree,
-- detach first:
--
--   UPDATE categories SET parent_id = NULL WHERE id = <child>;   -- child becomes a root
--   UPDATE categories SET type = 'income' WHERE id = <parent>;   -- now childless
--   UPDATE categories SET type = 'income' WHERE id = <child>;
--   UPDATE categories SET parent_id = <parent> WHERE id = <child>;
--
-- The alternative — cascading the type change to the children — would make the
-- first statement succeed and silently rewrite an unknown number of rows, which
-- is the failure mode these triggers exist to prevent.
--
-- ---------------------------------------------------------------------------
-- The two statements below are byte-identical to the ones in db/schema.sql:
-- scripts/verify_migration.py compares that file against the migrated schema and
-- compares triggers by their stored SQL. Keep them in step.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS trg_categories_structure_insert
BEFORE INSERT ON categories
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'CATEGORY_CROSS_USER: a subcategory must belong to the same user as its parent')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE id = NEW.parent_id AND user_id <> NEW.user_id);

    SELECT RAISE(ABORT, 'CATEGORY_DEPTH: categories may not be nested more than 2 levels deep')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE id = NEW.parent_id AND parent_id IS NOT NULL);

    SELECT RAISE(ABORT, 'CATEGORY_TYPE_MISMATCH: a subcategory must have the same type as its parent')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE id = NEW.parent_id AND type <> NEW.type);
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_structure_update
BEFORE UPDATE ON categories
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'CATEGORY_SELF_PARENT: a category cannot be its own parent')
     WHERE NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id;

    SELECT RAISE(ABORT, 'CATEGORY_CROSS_USER: a subcategory must belong to the same user as its parent')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE id = NEW.parent_id AND user_id <> NEW.user_id);

    SELECT RAISE(ABORT, 'CATEGORY_DEPTH: categories may not be nested more than 2 levels deep')
     WHERE NEW.parent_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM categories
                     WHERE id = NEW.parent_id AND parent_id IS NOT NULL)
            OR EXISTS (SELECT 1 FROM categories
                        WHERE parent_id = NEW.id));

    SELECT RAISE(ABORT, 'CATEGORY_TYPE_MISMATCH: a subcategory must have the same type as its parent')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE id = NEW.parent_id AND type <> NEW.type);

    SELECT RAISE(ABORT, 'CATEGORY_TYPE_MISMATCH: a subcategory must have the same type as its parent')
     WHERE EXISTS (SELECT 1 FROM categories
                    WHERE parent_id = NEW.id AND type <> NEW.type);
END;
