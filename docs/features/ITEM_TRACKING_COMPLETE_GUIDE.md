# 物品与价格历史

跟踪反复购买的物品，记录**每一次看到的价格**，用于观察涨跌、比较商家。

## 概念

价格数据存在 **`item_prices`**，每行是一条"看到的价格"。关键点：它**不附属在交易上**。

- `transaction_id` **可空**：价格可以脱离交易单独记录（"今天街角店鸡蛋 15"，没买）。这是该表存在
  的主要理由之一。
- 删除交易时是 `SET NULL` 而不是级联，所以价格记录不会因为交易被删而消失——因此**删除交易时，
  API 会显式先删掉它对应的价格行**，否则会留下无法与"手工记的价格"区分、却仍计入统计的无主记录。
- 删除物品时是 `CASCADE`：物品的全部价格记录随之删除（价格是物品的历史，脱离物品没有意义）。

单位与商家都已归一化：`unit` 受 `units` 词表约束（写别的值会被外键拒绝），用户原话保留在
`unit_raw`；商家由 `merchants` + `merchant_aliases` 表示，原话保留在 `merchant`。

## 数据

```sql
CREATE TABLE items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name)
);

CREATE TABLE item_prices (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id          INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    transaction_id   INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    quantity         REAL CHECK (quantity IS NULL OR quantity > 0),
    unit             TEXT REFERENCES units(code),   -- 编码，不是自由文本
    unit_raw         TEXT,                          -- 用户原话，如 "个"
    currency         TEXT NOT NULL DEFAULT 'CNY',
    merchant         TEXT,                          -- 原话；即使已解析也保留
    merchant_id      INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
    observed_on      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

v1 里 `item_id / unit_price / quantity / unit` 曾是 `transactions` 上的列，**v2 已全部移除**——物品
价格只存一处。

## API

前缀 `/api/v1`，全部需要 JWT。

### 物品

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/items` | 列表；`?with_stats=true` 附统计 |
| GET | `/items/:id` | 单个 |
| GET | `/items/:id/history` | 该物品的购买历史 + 统计（数据来自 `item_prices`） |
| POST | `/items` | `{ name }`，重名返回 409 |
| PUT | `/items/:id` | 重命名 |
| DELETE | `/items/:id` | 删除（**连带删除其全部价格记录**） |
| GET | `/items/search/:query` | 按名搜索 |

### 价格

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/prices` | `?item_id=`、`?merchant=`、`?limit=`（默认 100） |
| GET | `/prices/stats` | `?item_id=`；每物品的 last / average / min / max |
| GET | `/prices/merchants` | `?item_id=`；按商家的均价与区间 |
| POST | `/prices` | 记录一条价格观测，**可不带交易** |

### 响应示例（实测）

`GET /prices` 的一行：

```json
{
  "id": 23, "user_id": 1, "item_id": 22, "item_name": "牛奶",
  "transaction_id": 436, "unit_price": 27, "quantity": null, "unit": null,
  "currency": "CNY", "merchant": null, "observed_on": "2026-09-09",
  "created_at": "2026-09-09T12:14:48.559Z"
}
```

`GET /prices/stats` 的一行：

```json
{
  "item_id": 1, "count": 1,
  "last_unit_price": 23.5, "last_observed_on": "2026-03-04",
  "average_unit_price": 23.5, "min_unit_price": 23.5, "max_unit_price": 23.5
}
```

`GET /items?with_stats=true` 的一行：

```json
{
  "id": 22, "user_id": 1, "name": "牛奶", "created_at": "2026-09-09T12:14:48.360Z",
  "total_purchases": 1, "total_spent": 27, "average_price": 27,
  "last_purchase_date": "2026-09-09",
  "last_unit_price": 27, "average_unit_price": 27, "total_quantity": 0, "unit": null
}
```

`GET /items/:id/history` 返回 `{ item, transactions, stats }`，其中 `transactions` 是该物品各次购买
（每个元素带有从 `item_prices` 取来的 `unit_price` / `quantity` / `unit`）。

**注意"最近"的语义**：`last_unit_price` 指的是**最近一条有单价**的记录，不是最近一条记录——v1 的
子查询带 `unit_price IS NOT NULL` / `unit IS NOT NULL` 筛选，移植时必须保留，否则最后一条没有单价
的购买会把它变成 null。

### 记录一个只看不买的价格

```bash
curl -X POST http://localhost:8787/api/v1/prices \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "item_name": "鸡蛋", "unit_price": 15, "unit": "piece", "merchant": "街角店", "observed_on": "2026-10-09" }'
```

`item_id` 与 `item_name` 至少给一个（给名字时不存在会新建）。`unit` 必须是 `units` 里的 code。

## 界面状态

**物品页面已随界面改为"仅首页"而移除**（R1），组件文件仍在磁盘上但已无路由。因此物品与价格的
增删改查目前**没有可用的界面入口**，将来由 AI 层通过工具调用完成（见
[AI_BOOKKEEPING_ASSISTANT.md](AI_BOOKKEEPING_ASSISTANT.md) §5.1）。价格趋势图此前位于物品历史弹窗，
现同样不可达；`/prices` 端点已就绪，等 AI 层需要时接入。

## 典型用途

- **汽油**：跟踪 $/加仑的波动，比较不同加油站
- **生鲜**：跟踪 $/kg，比较不同超市，观察通胀
- **囤货**：比较单位价格，评估批量购买的收益
- **订阅类支出**：跟踪每月价格变化

## 常见问题

- **价格没出现**：确认该物品确实有 `item_prices` 行。物品挂了但当时没记单价的购买，迁移时会把
  实付金额当作单价补上——所以部分物品迁移后 "最近/平均单价" 会**变化**，这是修复 v1 的漏算，不是
  回归（当前数据受影响的是物品 1、2、4、21、22）。
- **单位写不进去**：`unit` 必须是 `units.code`。先查词表（`SELECT * FROM units`），映射不了就把
  原话写进 `unit_raw`、`unit` 留空，不要猜。
- **比价对不上**：确认两条价格单位相同——单位不同时比较本身没有意义，这正是加外键约束的原因。
