/** Collect a category and all of its descendants for the given user. */
export async function getAllSubcategoryIds(
  db: D1Database,
  categoryId: number,
  userId: number,
): Promise<number[]> {
  const categoryIds = [categoryId];

  const { results: allCategories } = await db
    .prepare("SELECT id, parent_id FROM categories WHERE user_id = ?")
    .bind(userId)
    .all<{ id: number; parent_id: number | null }>();

  const findChildren = (parentId: number) => {
    const children = allCategories.filter((cat) => cat.parent_id === parentId);
    children.forEach((child) => {
      categoryIds.push(child.id);
      findChildren(child.id);
    });
  };

  findChildren(categoryId);
  return categoryIds;
}
