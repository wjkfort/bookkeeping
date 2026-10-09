# 订阅管理

跟踪周期性付款，并可视化距离下次扣款的天数。

## 概览

订阅是**提醒 + 账单模板**，本身不是一笔账。真正产生支出是在续费时（`create_transaction` 不为
false），向 `transactions` 插入一笔支出。

## 功能

- **增删改查**：创建、查看、更新、删除
- **封存 / 恢复**：暂停而不删除；恢复时需要新的到期日
- **续费**：把 `end_date` 推进 `cycle_days` 天，并（可选）生成一笔带 `subscription_id` 的支出
- **进度可视化**：剩余天数进度条
- **紧急度配色**：绿 → 黄 → 红
- **弹层详情**：悬停/点击查看完整信息与操作
- **图标**：可选 emoji 或图片 URL

## 数据

```sql
CREATE TABLE subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    icon         TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 0,   -- 整数分
    currency     TEXT NOT NULL DEFAULT 'USD',
    cycle_days   INTEGER NOT NULL DEFAULT 30 CHECK (cycle_days > 0),
    end_date     TEXT NOT NULL,                -- 下次扣款日 YYYY-MM-DD
    category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    archived_at  TEXT,                         -- NULL = 进行中
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);
```

v2 相比 v1 的两处变化（文档此前描述的是旧结构）：

- **`subscription_renewals` 表已删除。** 续费改为 `transactions.subscription_id`——续费历史就是带
  该 `subscription_id` 的交易，不再单独存一张表。
- **`last_renewed_at` 列已删除。** 它不再是被写入的字段，而是**派生值**：该订阅最新一条续费交易的
  `created_at`。API 仍在响应里返回同名字段，因此客户端不受影响。

迁移时 `002` 会按 renew 端点自己写入的描述（`Subscription renewal: <name>`）回填
`subscription_id`，从而把历史续费找回来。

`archived_at` 在 v1 时通过 `backend-ts/migrations/add_archived_at_to_subscriptions.sql` 加到已有库；
新库直接从 `db/schema.sql` 获得。

**删除订阅**会把相关交易的 `subscription_id` 置为 NULL（`SET NULL`），**交易本身保留**——它们只是
不再关联这个订阅。旧文案曾说"续费记录会一并删除"，已不再成立。

## API

全部需要 JWT，前缀 `/api/v1`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/subscriptions` | 默认只返回进行中；`?include_archived=true` 含已封存。排序：进行中在前，再按 `end_date ASC` |
| GET | `/subscriptions/:id` | 单个（含 `category_name`） |
| POST | `/subscriptions` | 创建 |
| PUT | `/subscriptions/:id` | 部分更新 |
| POST | `/subscriptions/:id/renew` | 续费：推进 `end_date`，可选生成支出 |
| GET | `/subscriptions/:id/renewals` | 续费历史（现基于 `transactions` 实现） |
| POST | `/subscriptions/:id/archive` | 封存（写 `archived_at`），不删历史 |
| POST | `/subscriptions/:id/restore` | 恢复；需要 `end_date`，`cycle` 可选 |
| DELETE | `/subscriptions/:id` | 硬删除（交易保留，只断开关联） |

### 创建 / 更新请求体

```json
{
  "name": "Netflix",
  "icon": "https://example.com/icon.png",
  "amount": 15.99,
  "currency": "USD",
  "end_date": "2026-05-15",
  "cycle": 30,
  "category_id": null
}
```

创建需要 `name` 与 `end_date`（`YYYY-MM-DD`）。`cycle` 默认 30 且必须 ≥ 1。`category_id` 若给出，
必须属于当前用户。`(name, user_id)` 重复返回 **409**。

请求体与响应体**仍用 `cycle` 与小数 `amount`**（数据库里是 `cycle_days` 与 `amount_cents`），因为
API 契约不变。

### 响应

```json
{
  "id": 1,
  "user_id": 1,
  "name": "Netflix",
  "icon": null,
  "amount": 0,
  "currency": "USD",
  "end_date": "2026-05-15",
  "cycle": 30,
  "category_id": null,
  "category_name": null,
  "last_renewed_at": null,
  "archived_at": null,
  "created_at": "2026-04-08T12:00:00.000Z"
}
```

### 续费

```json
POST /api/v1/subscriptions/:id/renew
{
  "amount": 6,
  "currency": "CNY",
  "date": "2026-07-15",
  "category_id": 23,
  "create_transaction": true,
  "description": "Subscription renewal: iCloud"
}
```

字段全部可选。默认取订阅自身的金额/币种/分类，日期取今天，`create_transaction` 默认 true。

行为：

1. 已封存的订阅拒绝续费（先恢复）。
2. `period_start` = 当前 `end_date`；`period_end` = `end_date + cycle_days` 天（UTC）。
3. 若要生成交易且 `amount > 0`，则必须有 `category_id`（来自订阅或请求体）且必须是**支出**分类。
4. 当 `create_transaction !== false`、`amount > 0` 且分类存在时，插入一笔带 `subscription_id` 的
   `transactions`（`source='manual'`）。
5. 更新 `subscriptions.end_date`（以及 `category_id`，若本次指定）。
6. 响应里的 `renewal` 对象由上述值组装而成（**不再从 `subscription_renewals` 读**），同时返回
   `transaction_id`。

### 封存 / 恢复

```json
POST /api/v1/subscriptions/:id/archive
```

把 `archived_at` 设为当前时间。已封存的不出现在默认列表里，也不能续费。

```json
POST /api/v1/subscriptions/:id/restore
{ "end_date": "2026-09-01", "cycle": 30 }
```

`end_date` 必填（`YYYY-MM-DD`），`cycle` 可选，清空 `archived_at`。对未封存的行返回 404。

## 界面

订阅区在首页（应用已改为仅首页）。相关的组件与文案**未随页面精简而改动**：

- 图标（emoji 或图片 URL；图片加载失败时经 `/api/v1/proxy/image` 重试）
- 进度条（剩余天数 / `cycle_days`）
- 紧急度配色：绿 = 剩余 > 10 天，黄 = 5–10 天，红 = ≤ 5 天
- 弹层操作：续费（带支出）、仅延期、编辑、封存、删除
- 已封存区：恢复（新的到期日 + cycle）、编辑、删除

列表请求用 `GET /subscriptions?include_archived=true`，再按 `archived_at` 分成两组。

## 使用

1. 首页订阅区点 **+**
2. 填订阅信息（图标可选，emoji 或 URL）
3. 创建
4. 悬停/点击某条订阅可查看详情、续费、封存、编辑、删除
5. 已封存的在独立列表里，用新的到期日恢复

## 相关文件

- `backend-ts/db/schema.sql`（`subscriptions` 表定义）
- `backend-ts/migrations/add_archived_at_to_subscriptions.sql`
- `backend-ts/src/api/subscriptions.ts`
- `client/src/components/features/Dashboard.tsx`、`SubscriptionModal.tsx`、`Dashboard.css`、`api.ts`、`types/index.ts`

新库直接跑 `npm run db:schema:local`。已有生产库不要重跑历史 DDL；增量列走 `migrations/`。
