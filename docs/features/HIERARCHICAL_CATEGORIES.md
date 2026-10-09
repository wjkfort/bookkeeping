# 层级分类

分类支持父子嵌套（深度 ≤ 2）：

```
Food (parent)
  ├── Restaurant (child)
  ├── Groceries (child)
  └── Takeout (child)
```

## 约束（由 schema 与 API 共同保证）

- `parent_id` 指向同表的父分类，`NULL` 表示顶级。删除父分类会**级联删除其子分类**
  （`ON DELETE CASCADE`）。
- **唯一性**用的是表达式索引：

  ```sql
  CREATE UNIQUE INDEX idx_categories_unique
      ON categories (user_id, COALESCE(parent_id, 0), name);
  ```

  用 `COALESCE(parent_id, 0)` 而不是 `UNIQUE(name, parent_id, user_id)`，因为 SQLite 认为
  NULL 互不相等——旧的写法**约束不到顶级分类**，可以重复建同名顶级分类（v2 之前确实如此）。
- **顶级分类与同名的子分类可以共存**（"Food" 下也能再有一个 "Food"）。
- 父与子必须同 `type`（都收入或都支出）。
- 分类不能以自己为父。
- 深度上限 2：**由 API 校验**，不是数据库约束。

## 删除分类的行为（v2 已改变）

`transactions.category_id` 是 **`ON DELETE RESTRICT`**，v1 时是 `ON DELETE CASCADE`。

- v1：删一个分类会**连带删掉它名下的所有交易**（实测：42 个分类里有 33 个会被牵连同删）。
- v2：只要分类本身**或其任一子分类**下还有交易，删除请求就被拒绝，返回 **409**：

  ```json
  { "error": "Category still has transactions", "code": "CATEGORY_IN_USE", "transaction_count": 6 }
  ```

  客户端据此提示用户先移动或删除那些交易。没有交易（也没有子分类交易）的分类可正常删除。

## API

前缀 `/api/v1`，全部需要 JWT。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/categories` | 树形返回（顶级分类含 `children`）；`?flat=true` 返回扁平列表 |
| GET | `/categories/:id` | 单个分类 |
| POST | `/categories` | `{ name, type, parent_id? }`。父分类必须属于当前用户且同 `type` |
| PUT | `/categories/:id` | 部分更新，含 `parent_id` |
| DELETE | `/categories/:id` | 仍有交易时 **409**（见上） |

重名返回 **409**（`Category with this name already exists`），依据就是上面那条表达式索引。

## 界面状态

**分类页面已随界面改为"仅首页"而移除**（R1），组件文件仍在磁盘上但已无路由。因此本文档只描述
API 与数据层现状：分类的增删改查目前**没有可用的界面入口**，将来由 AI 层通过工具调用完成
（见 [AI_BOOKKEEPING_ASSISTANT.md](AI_BOOKKEEPING_ASSISTANT.md) §5.1）。
