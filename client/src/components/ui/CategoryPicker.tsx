import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Text } from "@radix-ui/themes";
import type { Category } from "../../types";
import "./CategoryPicker.css";

const RECENT_STORAGE_KEY = "bk_recent_category_ids";
const RECENT_LIMIT = 8;

export type CategoryTypeFilter = "all" | "income" | "expense";

export interface CategoryPickerProps {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  /** Show a clear / "all categories" option (filters). Default false. */
  allowClear?: boolean;
  clearLabel?: string;
  placeholder?: string;
  /** Restrict by type. Default "all". */
  typeFilter?: CategoryTypeFilter;
  /**
   * Only show these category ids (+ their parents for path labels when present).
   * Used for "categories with data" on the dashboard.
   */
  onlyIds?: number[] | null;
  /** Remember selection as recently used. Default true. */
  trackRecent?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

function readRecentIds(): number[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

function pushRecentId(id: number) {
  try {
    const prev = readRecentIds().filter((x) => x !== id);
    const next = [id, ...prev].slice(0, RECENT_LIMIT);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

function getCategoryLabel(category: Category, lang: string): string {
  if (category.translations?.[lang]) return category.translations[lang];
  if (category.translations?.en) return category.translations.en;
  return category.name;
}

function sortWithChildren(cats: Category[]): Category[] {
  const result: Category[] = [];
  const parents = cats.filter((c) => !c.parent_id);
  const children = cats.filter((c) => c.parent_id);
  const seen = new Set<number>();

  parents.forEach((parent) => {
    result.push(parent);
    seen.add(parent.id);
    children
      .filter((c) => c.parent_id === parent.id)
      .forEach((child) => {
        result.push(child);
        seen.add(child.id);
      });
  });

  cats.forEach((c) => {
    if (!seen.has(c.id)) result.push(c);
  });

  return result;
}

const CategoryPicker: React.FC<CategoryPickerProps> = ({
  categories,
  value,
  onChange,
  allowClear = false,
  clearLabel,
  placeholder,
  typeFilter = "all",
  onlyIds = null,
  trackRecent = true,
  disabled = false,
  style,
  className,
}) => {
  const { t, i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<number[]>(() => readRecentIds());
  const [expandedParents, setExpandedParents] = useState<Set<number>>(
    () => new Set(),
  );
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Portal the menu into the nearest open Dialog content when present so that:
  // 1) it sits above the modal overlay (portaling to body/[data-radix-themes]
  //    leaves the menu under the dialog portal → clicks hit the overlay and
  //    dismiss the modal),
  // 2) Theme CSS variables still resolve.
  // position:fixed is still viewport-relative (dialog content has no transform
  // after the open animation). Outside dialogs, fall back to theme root / body.
  const getPortalTarget = (): HTMLElement =>
    (rootRef.current?.closest(
      ".rt-BaseDialogContent, .rt-DialogContent",
    ) as HTMLElement | null) ??
    (document.querySelector("[data-radix-themes]") as HTMLElement | null) ??
    document.body;

  const byId = useMemo(() => {
    const m = new Map<number, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const labelOf = (cat: Category) => getCategoryLabel(cat, i18n.language);

  const pathOf = (cat: Category): string => {
    const name = labelOf(cat);
    if (!cat.parent_id) return name;
    const parent = byId.get(cat.parent_id);
    if (!parent) return name;
    return `${labelOf(parent)} / ${name}`;
  };

  const baseList = useMemo(() => {
    let list = categories;
    if (typeFilter !== "all") {
      list = list.filter((c) => c.type === typeFilter);
    }
    if (onlyIds != null) {
      const allow = new Set(onlyIds);
      list = list.filter((c) => allow.has(c.id));
    }
    return sortWithChildren(list);
  }, [categories, typeFilter, onlyIds]);

  const selected = value != null ? byId.get(value) ?? null : null;

  useEffect(() => {
    if (!open) {
      setQuery(selected ? labelOf(selected) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, selected, i18n.language, open]);

  // Auto-expand parent of selected value when opening
  useEffect(() => {
    if (!open || !selected?.parent_id) return;
    setExpandedParents((prev) => {
      if (prev.has(selected.parent_id!)) return prev;
      const next = new Set(prev);
      next.add(selected.parent_id!);
      return next;
    });
  }, [open, selected?.parent_id]);

  const updateMenuPos = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const gap = 4;
    const spaceBelow = window.innerHeight - rect.bottom - gap - 12;
    const spaceAbove = rect.top - gap - 12;
    const preferBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(
      160,
      Math.min(360, preferBelow ? spaceBelow : spaceAbove),
    );
    const top = preferBelow
      ? rect.bottom + gap
      : Math.max(8, rect.top - gap - maxHeight);
    setMenuPos({
      top,
      left: rect.left,
      width: Math.max(rect.width, 280),
      maxHeight,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onScroll = () => updateMenuPos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return baseList;
    return baseList.filter((cat) => {
      const labels = [
        cat.name,
        getCategoryLabel(cat, i18n.language),
        cat.translations?.en,
        cat.translations?.zh,
      ]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase());
      if (labels.some((s) => s.includes(q))) return true;
      if (cat.parent_id) {
        const parent = byId.get(cat.parent_id);
        if (parent) {
          const parentLabel = getCategoryLabel(
            parent,
            i18n.language,
          ).toLowerCase();
          if (parentLabel.includes(q)) return true;
          if (
            `${parentLabel} / ${getCategoryLabel(cat, i18n.language).toLowerCase()}`.includes(
              q,
            )
          ) {
            return true;
          }
        }
      }
      return false;
    });
  }, [baseList, q, i18n.language, byId]);

  const recentCats = useMemo(() => {
    if (q) return [];
    return recentIds
      .map((id) => byId.get(id))
      .filter((c): c is Category => {
        if (!c) return false;
        if (typeFilter !== "all" && c.type !== typeFilter) return false;
        if (onlyIds != null && !onlyIds.includes(c.id)) return false;
        return true;
      });
  }, [recentIds, byId, q, typeFilter, onlyIds]);

  const grouped = useMemo(() => {
    if (q) {
      return {
        mode: "flat" as const,
        items: filtered,
      };
    }

    const parents = filtered.filter((c) => !c.parent_id);
    const children = filtered.filter((c) => c.parent_id);
    const groups: { parent: Category | null; items: Category[] }[] = [];

    parents.forEach((p) => {
      const kids = children.filter((c) => c.parent_id === p.id);
      groups.push({ parent: p, items: kids });
    });

    const orphanKids = children.filter(
      (c) => !parents.some((p) => p.id === c.parent_id),
    );
    if (orphanKids.length) {
      groups.push({ parent: null, items: orphanKids });
    }

    return { mode: "grouped" as const, groups };
  }, [filtered, q]);

  const select = (id: number | null) => {
    onChange(id);
    if (id != null && trackRecent) {
      pushRecentId(id);
      setRecentIds(readRecentIds());
    }
    setOpen(false);
    if (id == null) {
      setQuery("");
    } else {
      const cat = byId.get(id);
      setQuery(cat ? labelOf(cat) : "");
    }
  };

  const toggleExpand = (parentId: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const ph =
    placeholder ||
    t("categoryPicker.placeholder") ||
    t("transactions.selectCategory") ||
    "Select category";

  const allLabel =
    clearLabel ||
    t("categoryPicker.all") ||
    t("dashboard.allCategories") ||
    t("transactions.allCategories") ||
    "All categories";

  const showEmpty =
    !allowClear && filtered.length === 0 && recentCats.length === 0;

  const dropdown =
    open && menuPos
      ? createPortal(
          <div
            ref={dropdownRef}
            className="category-picker-dropdown"
            role="listbox"
            // Modal dialogs set body { pointer-events: none }; re-enable so
            // the menu is clickable when portaled outside Dialog.Content.
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
              pointerEvents: "auto",
              zIndex: 100000,
            }}
          >
            {allowClear && (
              <button
                type="button"
                className={`category-picker-item clear ${value == null ? "selected" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(null);
                }}
              >
                {allLabel}
              </button>
            )}

            {recentCats.length > 0 && (
              <div className="category-picker-section">
                <div className="category-picker-section-title">
                  {t("categoryPicker.recent") || "Recent"}
                </div>
                {recentCats.map((cat) => (
                  <button
                    key={`r-${cat.id}`}
                    type="button"
                    className={`category-picker-item ${value === cat.id ? "selected" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(cat.id);
                    }}
                  >
                    <span className="category-picker-name">{pathOf(cat)}</span>
                    <span className="category-picker-type">
                      {t(`categories.${cat.type}`)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {grouped.mode === "flat" ? (
              <div className="category-picker-section">
                {recentCats.length > 0 && (
                  <div className="category-picker-section-title">
                    {t("categoryPicker.results") || "Results"}
                  </div>
                )}
                {grouped.items.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`category-picker-item ${value === cat.id ? "selected" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select(cat.id);
                    }}
                  >
                    <span className="category-picker-name">{pathOf(cat)}</span>
                    <span className="category-picker-type">
                      {t(`categories.${cat.type}`)}
                    </span>
                  </button>
                ))}
                {grouped.items.length === 0 && (
                  <Text size="1" color="gray" className="category-picker-empty">
                    {t("categoryPicker.noMatch") || "No matching categories"}
                  </Text>
                )}
              </div>
            ) : (
              <>
                {!q && (
                  <Text size="1" color="gray" className="category-picker-hint">
                    {t("categoryPicker.expandHint") ||
                      "Search or expand a group"}
                  </Text>
                )}
                {grouped.groups.map((g, gi) => (
                  <div
                    key={g.parent?.id ?? `orphan-${gi}`}
                    className="category-picker-section"
                  >
                    {g.parent ? (
                      <>
                        <div className="category-picker-row">
                          {g.items.length > 0 ? (
                            <button
                              type="button"
                              className="category-picker-expand"
                              aria-label="expand"
                              onMouseDown={(e) =>
                                toggleExpand(g.parent!.id, e)
                              }
                            >
                              {expandedParents.has(g.parent.id) ? "▾" : "▸"}
                            </button>
                          ) : (
                            <span className="category-picker-expand placeholder">
                              ·
                            </span>
                          )}
                          <button
                            type="button"
                            className={`category-picker-item parent ${value === g.parent.id ? "selected" : ""}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              select(g.parent!.id);
                            }}
                          >
                            <span className="category-picker-name">
                              {labelOf(g.parent)}
                              {g.items.length > 0 && (
                                <span
                                  style={{
                                    color: "var(--gray-11)",
                                    fontWeight: 400,
                                    marginLeft: 6,
                                    fontSize: 12,
                                  }}
                                >
                                  ({g.items.length})
                                </span>
                              )}
                            </span>
                            <span className="category-picker-type">
                              {t(`categories.${g.parent.type}`)}
                            </span>
                          </button>
                        </div>
                        {expandedParents.has(g.parent.id) &&
                          g.items.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              className={`category-picker-item child ${value === cat.id ? "selected" : ""}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                select(cat.id);
                              }}
                            >
                              <span className="category-picker-name">
                                <span className="category-picker-indent">
                                  └
                                </span>
                                {labelOf(cat)}
                              </span>
                              <span className="category-picker-type">
                                {t(`categories.${cat.type}`)}
                              </span>
                            </button>
                          ))}
                      </>
                    ) : (
                      g.items.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          className={`category-picker-item ${value === cat.id ? "selected" : ""}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            select(cat.id);
                          }}
                        >
                          <span className="category-picker-name">
                            {pathOf(cat)}
                          </span>
                          <span className="category-picker-type">
                            {t(`categories.${cat.type}`)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ))}
              </>
            )}

            {showEmpty && (
              <Text size="1" color="gray" className="category-picker-empty">
                {t("categoryPicker.noMatch") || "No matching categories"}
              </Text>
            )}
          </div>,
          getPortalTarget(),
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={`category-picker ${className || ""}`}
      style={style}
    >
      <input
        ref={inputRef}
        type="text"
        className="category-picker-input"
        disabled={disabled}
        placeholder={ph}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          // Clear selected label so user can type to search immediately
          if (selected && query === labelOf(selected)) {
            setQuery("");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setQuery(selected ? labelOf(selected) : "");
          }
          if (e.key === "Backspace" && allowClear && !query && value != null) {
            select(null);
          }
        }}
        autoComplete="off"
      />
      {dropdown}
    </div>
  );
};

export default CategoryPicker;
