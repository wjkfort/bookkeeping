# AI Bookkeeping Assistant — 需求

状态：schema v2（含后续 003/004）与适配代码已完成并验证；**尚未上生产**。AI 层未开始。

| | 需求 | 状态 |
|---|---|---|
| R1 | 界面：仅首页，三块内容 | 已实现 |
| R2 | 对话式记账（DeepSeek） | 未开始 |
| R3 | 缺日与订阅提醒 | 未开始 |
| R4 | 物品价格历史 | `item_prices` 与 `/prices` 已实现；AI 比价与提醒话术未开始 |
| R5 | 会话记忆与上下文预算 | 未开始 |
| R6 | 安全与正确性 | 服务端校验与 JWT 作用域已完成；token 上限与成本记录未开始 |

## 1. 问题与目标

逐笔手工记账很繁琐，于是会漏记，数据变得千疮百孔、无法用来观察趋势。同一件东西反复购买，
却看不到这次比上次贵还是便宜。

1. 用对话代替手工录入：用户说发生了什么，AI 记录。
2. 找出缺口（某天没有记录、订阅逾期）并主动提出，让账目保持连续。
3. 保留每件物品的价格历史（包括只看到、没买的价格），并在明显变贵时告知。
4. 让 AI 能回答趋势问题。
5. 简化数据库，同时完整迁移既有数据。

**非目标（v1）**：多用户共享账本、银行/账单导入、投资与税务、以及手工录入表单——表单与其按钮在
界面改为"仅首页"时（R1）已移除，当前**没有任何人工录入途径**。

---

## 2. 需求

### R1 — 界面

应用**只有首页**。交易列表、分类、物品三个页面已从路由与导航移除（组件文件留在磁盘上，未被
引用）；其他路径重定向到首页。首页只保留三块：

1. **当月总支出**（含日均）。月份选择器保留，因为它让"当月"可切换；另保留"全部"切换。
2. **支出分类饼图。**
3. **订阅**：进行中与已封存列表、续费 / 仅延期 / 封存 / 恢复 / 删除 / 新增。

按决定移除、且不应在未重新确认前加回：月度收支趋势图、分类月度趋势图、今日支出卡、收入与结余
数字卡（只留支出）；以及**手工新增交易的按钮与表单**。

同样不再做：**无记录天数条**（缺口信息将来由 AI 对话呈现）。物品价格趋势图**已存在**于物品历史
视图中，该视图目前无人引用；价格趋势将在 AI 层需要时经 `/prices` 回来。

AI 回答趋势问题时使用与 `/api/v1/summary/*` **相同的聚合逻辑**：算术由 SQL 做，AI 只负责措辞。

### R2 — 对话式记账

- Provider：**DeepSeek chat completions**。密钥存为 Worker secret（`DEEPSEEK_API_KEY`），
  不提交、不放进 `wrangler.toml` 的 `[vars]`、不发往浏览器。所有 AI 调用都在后端。
- AI 写之前会收集**足够**信息。一顿饭要确认在哪、吃了什么，而不只是金额；过于含糊时会追问。
- **AI 直接写入**，没有确认步骤。正确性靠写入前的严格服务端校验，以及用对话来纠正错误。
- **编辑是对话式且不可见的**："其实 35" 或 "那笔应该算交通" 由 AI 直接改。没有编辑/diff 界面，
  也没有变更提示。
  - **没有 change log，也不要求可追溯。** 正确性的检验就是报表本身：数字对就没问题。错的数字
    通过再对话一次修正（AI 发出反向操作）。因此 `transactions` 不需要幂等键，写入也不需要被归组
    成可撤销单元——防重与撤销是 AI 在对话层的职责，不是 schema 的。
- 一条购买消息可以产生一笔交易**和**多条价格记录（"超市 86，鸡蛋 12.8 一打，牛奶 6.5"）。

### R3 — 缺日与订阅提醒

- 投递方式：**打开应用时在对话里带出**。后端算出未闭合的缺口，AI 以它开场。v1 不做邮件、推送
  或 cron。
- 检查项：
  - **缺日**：最近若干日历天中零交易、且用户未在 `ledger_days` 标记过的日期。AI 询问并提议补记。
  - **逾期订阅**：`end_date` 已过，且该期间没有续费交易。记录续费即消解，因此不需要额外状态。
- 用户说"那天没花钱"，AI 写一条 `ledger_days`，此后不再追问那天。
- 每项检查是各自独立的查询，按 `user_id` 作用域；一项失败不得阻塞其他项。

### R4 — 物品价格历史

- `item_prices` 每行记录一次**看到的价格**：物品、单价、数量、单位、商家、日期，以及可选的来源
  交易链接。
- 价格可以**不带交易**记录（"今天街角店鸡蛋 15"）。
- 单位受 `units` 词表约束（`REFERENCES units(code)`），原话保留在 `unit_raw`；商家解析为
  `merchants` 实体，原话保留在 `merchant`。理由：单位不同的价格比较本身是错的；"永辉"与
  "永辉超市"必须是同一家才能比价。
- AI 应当：
  - 把新价格与该物品自身的历史（最近、平均、最低）比较，直说贵了还是便宜了、差多少。
  - 明显高于近期均价时提示（默认高出 10% 以上；可配置）。
  - 在有商家数据时比较不同商家。
- **价格趋势由 SQL 计算，不交给模型。** 价格行从不整体载入 prompt 去算趋势（见 R5）。

### R5 — 会话记忆与上下文预算

- 每个用户**一条连续对话**，存在服务端，刷新与换设备都还在。不设多会话——记账不需要。
- **绝不用检索聊天历史来回答价格或趋势问题。** 聊天会无限增长。由此三条规则：
  - 趋势、均价、"上次是不是更便宜"一律来自对 `item_prices` 与 `transactions` 的 **SQL**；
    只把算好的小结果交给模型。
  - 每个 prompt 都是**有界的**：最近 N 条消息，加上服务端构造的快照（分类、物品名、本月合计、
    未闭合缺口），加上用户的记忆便签。
  - 长期记忆是每个用户一段**短文本**（`users.ai_memory`，长度受限）。它存偏好与习惯
    （"常去的午餐地点是 X""超市购物算 Y 类"），不存数字。AI 偶尔更新它，它不是历史回放。
- 服务端强制 prompt 体积硬上限，无论客户端或模型请求多大。
- 旧聊天消息按保留期（默认 90 天）清理。不需要有东西比它活得更久：没有审计要留，习惯由
  `ai_memory` 延续。

### R6 — 安全与正确性

- 绝不编造数字。给用户看的每个数字都来自同一轮的 SQL 结果。
- 模型输出是**不可信输入**。金额、日期、ID 在任何写入前都在服务端解析与校验。
- 每一次 AI 可触达的写入都使用 JWT 的 `user_id`。模型无法选择用户。
- DeepSeek 不可用或缺密钥时，所有现有功能照常工作。
- 每请求与每日 token 上限；记录 token 用量以便看见成本。

---

## 3. 数据库

### 3.1 目标 schema（已实现）

12 张表（10 张核心 + 2 张 AI），10 个索引。`db/schema.sql` 与 `migrations/002_schema_v2.sql`
（及 003/004）构建的就是它；`scripts/verify_migration.py` **逐结构**比对两条路径（列、可空性、
默认值、外键、索引、CHECK），确保"新建库"与"迁移库"一致。

```sql
users            id, email UNIQUE, password_hash, username,
                 ai_memory TEXT CHECK(length <= 2000),   -- R5 的短记忆便签
                 created_at, updated_at

categories       id, user_id → users CASCADE, name, type(income|expense),
                 parent_id → categories CASCADE, translations, created_at
                 UNIQUE INDEX (user_id, COALESCE(parent_id,0), name)  -- 真正的唯一性
                 -- 深度 ≤2、子类型 = 父类型 由 API 校验

subscriptions    id, user_id → users CASCADE, name, icon,
                 amount_cents INTEGER, currency, cycle_days CHECK(>0),
                 end_date, category_id → categories SET NULL, archived_at,
                 created_at, UNIQUE(user_id, name)
                 -- last_renewed_at 已移除：它 = 该订阅续费交易的 MAX(created_at)

transactions     id, user_id → users CASCADE,
                 category_id → categories RESTRICT,      -- 原为 CASCADE：会删数据
                 amount_cents INTEGER CHECK(>=0), currency, date, description,
                 subscription_id → subscriptions SET NULL,  -- 取代 subscription_renewals
                 source(manual|ai), created_at, updated_at
                 -- item_id / unit_price / quantity / unit 已移入 item_prices

items            id, user_id → users CASCADE, name, created_at, UNIQUE(user_id, name)

item_prices      id, user_id → users CASCADE, item_id → items CASCADE,
                 transaction_id → transactions SET NULL,  -- NULL = 只看到价格，没买
                 unit_price_cents INTEGER CHECK(>=0), quantity REAL CHECK(>0),
                 unit → units(code),      -- 编码，不是自由文本
                 unit_raw,                -- 用户原话，例如 "个"
                 currency, merchant,      -- 原话；即使解析成功也保留
                 merchant_id → merchants SET NULL,
                 observed_on, created_at

units            code PRIMARY KEY, name
                 -- 共享词表，不是用户数据：价格只在同一单位内比较才有意义

merchants        id, user_id → users CASCADE, name, created_at, UNIQUE(user_id, name)

merchant_aliases id, user_id → users CASCADE, merchant_id → merchants CASCADE,
                 alias, created_at, UNIQUE(user_id, alias)
                 -- 使 "永辉" 与 "永辉超市" 在比价时是同一家

exchange_rates   base_currency, target_currency, rate, fetched_at,
                 PRIMARY KEY (base_currency, target_currency) WITHOUT ROWID
                 -- upsert：每币种对一行，而不是每次抓取一行

ai_messages      id, user_id → users CASCADE, role(user|assistant|tool),
                 content NULL,        -- 纯工具调用的一轮没有文本
                 tool_calls, tokens_in, tokens_out, created_at
                 -- 每用户一条连续对话；按保留期清理（R5）

ledger_days      user_id → users CASCADE, date,
                 status(no_spend|partial) DEFAULT no_spend, created_at,
                 PRIMARY KEY (user_id, date) WITHOUT ROWID
                 -- no_spend = 确认没花钱；partial = 只记了一部分，仍应继续问（R3）
```

已删除的表：`subscription_renewals`、`utility_*`、旧 `ai_conversations`、`change_log`。没有单独
的 `usage_log`：`ai_messages` 上的 token 计数足够实现每日上限。

### 3.2 迁移

| 文件 | 作用 |
|---|---|
| `migrations/001_link_priced_rows_to_items.sql` | 前置修复：给 5 条"有价无 item"的交易挂上 item，否则 002 会丢掉它们的价格。必须在 002 之前 |
| `migrations/002_schema_v2.sql` | 主体升级：删死表、暂存 v1 表、按最终名建 v2、拷贝数据、回填 `subscription_id`、删暂存表、建索引 |
| `migrations/003_ai_layer_tables.sql` | `ai_messages.content` 改为可空；`ledger_days` 增加 `status`。在 002 之后 |
| `migrations/004_normalise_units_merchants.sql` | `units` 词表、`merchants` + `merchant_aliases`；`item_prices` 增加 `unit_raw` 与 `merchant_id`，`unit` 约束到 `units(code)`。在 003 之后 |
| `scripts/verify_migration.py` | 在真实数据副本上应用整条链并检查 **38** 项 |
| `db/schema.sql` | 新建/空库用；验证器逐结构证明它与迁移结果一致 |

迁移规则：

| 从 | 到 | 规则 |
|---|---|---|
| `transactions.amount` | `amount_cents` | `CAST(ROUND(amount*100) AS INTEGER)` |
| 有 `unit_price` 的交易 | `item_prices` | **原样拷贝**，绝不重算——因为 `unit_price × quantity ≠ amount` 在 18 条中有 8 条 |
| 挂 item 但无 `unit_price` 的交易（prod 5） | `item_prices` | `amount` 就是实付价，作为 `unit_price_cents`；`quantity` 留 NULL 而不臆测 |
| 有 `unit_price` 但**无** item 的交易（prod 5） | `item_prices` | 由 `001` 先挂上 item 再迁移 |
| `subscriptions.amount / cycle` | `amount_cents / cycle_days` | 直接对应 |
| `subscriptions.last_renewed_at` | 派生 | 该订阅最新续费交易的 `created_at` |
| 续费交易 | `transactions.subscription_id` | 按 renew 端点自己写入的描述 `Subscription renewal: <name>` 回填 |
| `exchange_rates`（194 行） | 每币种对一行（2） | `ROW_NUMBER() OVER (PARTITION BY pair ORDER BY fetched_at DESC, id DESC)`；必须有 tiebreak，因 97 行共享同一时间戳 |
| `unit` 自由文本 | `units.code` + `unit_raw` | 只接受词表中的 code；不认识的值留在 `unit_raw` 并把 code 置空，**不猜** |

**由测试在真实数据上发现并修复的缺陷**（不是事先假设的）：

- **5 条"有价无 item"的交易在生产里仍然存在。** 7 月导出与本地 clone 说法不一致（clone 里它们
  已挂到糖饼 / 优酷月卡 / iCloud，看起来像是生产已修好），2026-10-09 的导出证明并没有。由 `001`
  修复：创建这三个 item（生产里不存在）并把交易 17、21、28、40、42 挂上去。
- **`last_renewed_at` 并非每行都是 NULL。** 本文档原先据 7 月导出断言"4 行全 NULL"，实际有两个
  值：`iCloud 2026-09-24T03:31:54.060Z`、`Zenless Zone Zero 2026-08-05T08:43:32.195Z`。由于 v2
  改为从续费交易派生，直接删列会静默丢失。002 现按描述回填 `subscription_id`，**精确**恢复了
  iCloud。Zenless Zone Zero 找不到任何可对应的交易（当天唯一候选 tx 346 金额与描述都不符），
  属**已知接受的丢失**（在两处脚本里显式登记，不是被忽略）。
- **删除物品现在会删掉它的价格历史**。`item_prices.item_id` 是 `ON DELETE CASCADE`。v1 里价格
  在交易行上，删物品只清标签、金额与价格仍在。交易本身在 v2 删除中仍存活，只有价格记录消失。
  这符合"物品信息只存一处"（§3.1），且已被写路径测试钉住；两种语言的删除文案依然准确，未改动。
- **v1 的物品价格统计会静默漏算。** `items.ts` 的价格查询带 `unit_price IS NOT NULL`，因此一条
  挂了 item 但没记单价的购买会被排除在 `last_unit_price` / `average_unit_price` 之外。迁移会给
  这类行补上价格，所以这些物品迁移后价格会**合理地**变化（当前数据：物品 1、2、4、21、22）。
  `scripts/api_diff.py` 仅在价格集合严格变大且仍包含 v1 全部值时才算作 `IMPROVED`。

两个必须绕开的 SQLite 行为（开发中均复现过）：`DROP TABLE users` 会触发隐式 DELETE，从而对其
他表的 `ON DELETE CASCADE` 连锁，把刚填好的 v2 表清空；`ALTER TABLE x RENAME` 会改写**其他**表
的 `REFERENCES`，让 v2 表指向即将被删的表。因此顺序是：把 v1 表暂存为 `*_old`、按**最终**名建
v2、拷贝、再删暂存表——绝不重命名在用表。

### 3.3 003 / 004 为什么这样写

- **`ai_messages.content` 可空**（003）：DeepSeek 返回**纯工具调用**时 `content` 为空。原来
  `TEXT NOT NULL`，硬写空串会让"这条只是发起调用"与"这条说了什么"无法区分，污染 R5 用于重建上下
  文的聊天历史。SQLite 无法原地去掉 NOT NULL，故重建该表，`content` 保持原列位置使 `SELECT *` 仍
  成立。
- **`ledger_days.status`**（003）：AI 问"3 号有消费吗"、答"午饭 20"，这天只是**部分记录**——既非
  空，也不该标为"无支出"。没有第三态，AI 无法判断这天要不要再问。`no_spend` = 确认没花钱；
  `partial` = 已记部分、仍应继续问（见 §5.3）。
- **unit 归一化必须重建 `item_prices`**（004）：`ALTER TABLE ADD COLUMN` **无法**添加 `REFERENCES`
  子句，而 `CHECK` 不能带子查询。用 ALTER 加列则插入 `'NOT_A_UNIT'` 会被接受，归一化形同虚设；重建
  后该插入被外键拒绝（实测）。重建顺序是"建新表 → 拷贝 → 删旧表 → 改名"，**不先改旧表名**，因为
  `ALTER TABLE RENAME` 会改写其他表的 `REFERENCES`。
- **merchant 归一化**（004）：`item_prices` 增加 `merchant_id`（`ON DELETE SET NULL`），并**同时
  保留 `merchant` 原文**，解析失败时不丢信息。

### 3.4 上线步骤

顺序关键：**先 push 代码再迁移**。schema v2 不向后兼容（旧代码读不了 `amount_cents` /
`item_prices` / `cycle_days`，会直接 500），而 push 触发的部署延迟不可控、`d1 execute` 是同步的
——所以把不可控的那个放前面。详见 [DEPLOYMENT.md](../DEPLOYMENT.md)。

0. `python3 -I scripts/rehearse_migration.py prod-backup-<date>.sql` —— 在副本上预演整条流程
   （含"备份可恢复"）。上真机前最便宜的抓错方式。
1. `wrangler d1 export bookkeeping-db --remote --output=prod-backup-<date>.sql`。
2. 对新鲜导出跑 `verify_migration.py`。**原始导出预期会失败** 2 项前置检查（那 5 条未挂 item 的
   行），这正是下一步要修的。
3. 对生产执行 `001`，重新导出并重跑验证器：必须 **38/0** 才能继续。
4. 确认 `subscriptions.archived_at` 存在（2026-10-09 时已存在）。
5. 提交代码但**先不 push**。在同一分钟内：`git push`，紧接着依序执行 `002`、`003`、`004`。
6. 部署匹配的前后端代码。`wrangler d1 execute --file` 整文件单事务，失败会整体回滚（已在
   `--local` 验证），但**成功后再跑一次 002 会破坏数据**（它会把在用表改名为 `*_old`）——只跑
   一次。
7. 冒烟：本月金额、物品价格列、以及"删除一个有交易的分类应返回 409"。

需要接受的、已审阅的变化：Zenless Zone Zero 失去 `last_renewed_at`（无交易可支撑）；物品
1、2、4、21、22 显示被修正过的价格（v1 漏算了它们未记单价的购买）。

### 3.5 代码改动（已完成并验证）

- 金额在边界转换：API 仍收发小数，DB 存 cents（`src/utils/money.ts` 是唯一转换点）。作用于金额的
  `Math.round(*100)/100` 已全部消除。
- `items.ts` 的统计与 `/items/:id/history` 改读 `item_prices`。注意 v1 子查询里的
  `unit IS NOT NULL` / `unit_price IS NOT NULL` 筛选："最近"指的是**最近一条有值**的记录，而不是
  最近一条记录——丢掉这个筛选结果就会变。
- `subscriptions.ts` 续费改为插入带 `subscription_id` 的交易；`last_renewed_at` 由最新续费交易的
  `created_at` 派生（完整时间戳，与原列一致）。`/:id/renewals` 改为基于交易实现。
- `utils/currency.ts` 改为 UPSERT 与单行读取。
- 删除分类时，若该分类或其子分类仍有交易，返回 409 而不是级联删除。
- `/translate` 与 `/exchange-rates` 现在需要鉴权（两者只在 `ProtectedRoute` 之后的页面被调用，
  客户端本就带 token）。
- 新增路由 `src/api/prices.ts`：`GET /prices`、`GET /prices/stats`、`GET /prices/merchants`、
  `POST /prices`，全部按 JWT 用户作用域，并有跨用户隔离测试。
- 客户端几乎不用改：`amount`、`cycle`、`last_renewed_at` 保留原名与小数单位，物品价格字段也以原
  形状到达。客户端改动只有分类 409 分支与两条 i18n 文案。
- `client/src/api.ts` 与 `client/src/types` **未**重构，且经检视**不应**重构：客户端看到的每个
  价格都已经来自 `item_prices`（在 `transactions.ts` 的 `TX_SELECT` 里 join 回来，在 `items.ts`
  里直接读），而它的形状对它所渲染的东西是合理的——物品历史弹窗正是把每个价格画在它对应的那次
  购买旁边。重构类型只会带来无收益的改动，并打断图表与历史表格。

---

## 4. API 面

全部在 `/api/v1` 下、全部需要 JWT。`/translate` 与 `/exchange-rates` 原先**无鉴权**，现在需要
token；`/proxy` 仍不需要（它是第三个无鉴权路由，会对外发起调用方指定的 URL——建议单独处理）。

`/prices` 已实现；`/ai/*` 全部未实现。

```
POST   /ai/chat             发送消息；返回回复与本次写入列表
GET    /ai/messages         ?before=<id> 分页聊天历史
GET    /ai/gaps             未闭合提醒（缺日、逾期订阅）
POST   /ai/gaps/no-spend    { date } → 写 ledger_days
GET    /prices              ?item_id= 历史与统计（last/avg/min，按商家）
POST   /prices              记录一条价格观测（可不带交易）
```

AI 调用与这些端点**相同的服务端函数**（tool calling），从不运行自己写的 SQL。

---

## 5. AI 层设计

AI 层**未写代码**。本节是唯一的实现依据。

### 5.1 工具清单

**下列工具目前都不存在。** 标注"复用现有路由"的指底层查询已有 HTTP 实现（`/summary/*`、
`/prices/*`、`/categories`、`/items`、`/subscriptions`）；AI 工具应调用与这些路由**相同的服务端
函数**，而不是另写 SQL。`/ai/*` 与 `remember` 全是新的。

模型**只产出参数**，不产出 SQL。每个工具在服务端：① 从 JWT 取 `user_id`（模型无法指定用户）
② 校验参数 ③ 执行。金额一律用**小数**（与 API 边界一致），服务端转 cents。

#### `transactions`

| 工具 | 参数 | 服务端行为 |
|---|---|---|
| `add_transaction` | `amount`, `currency`, `date`, `category`(名或id), `description?`, `item?`{`name`,`unit_price?`,`quantity?`,`unit?`}, `subscription?`(id) | 解析分类 → 写 `transactions(source='ai')`；若给了 `item`，同时写 `item_prices`（`unit_price` 缺省时取 `amount`——**本设计新定的规则**，口径与迁移处理历史数据一致，但那规则不自动作用于新写入） |
| `update_transaction` | `id` + 任意可改字段 | 只改传入字段；若改了 `amount` 而该笔价格原本由金额推导，则同步价格 |
| `delete_transaction` | `id` | **先删它的 `item_prices` 行**，再删交易——否则因 `ON DELETE SET NULL` 留下无主价格，会与"手工记的价格"无法区分并污染统计 |
| `find_transactions` | `date_from/to?`, `category?`, `amount?`, `keyword?`, `limit?` | 只读。用于"上周吃饭花了多少""是不是重复记过" |
| `summarize` | `group_by`(category/month/day), `date_from/to?`, `currency?` | 复用 `/summary/*` 的 SQL；**算术不在模型里做** |

#### `categories`

| 工具 | 说明 |
|---|---|
| `list_categories` | 返回树（父子、type、translations） |
| `add_category` | `name`, `type`, `parent?` |
| `rename_category` / `move_category` | 同样受"深度 ≤2、子类型 = 父类型"约束（现由 API 校验） |
| `delete_category` | **仍有交易时会被拒绝（409）**。工具必须把 409 如实转述，不能假装成功 |

#### `items` 与 `item_prices`

| 工具 | 说明 |
|---|---|
| `list_items` | `with_stats?` |
| `add_item` / `rename_item` | |
| `delete_item` | 会**级联删掉该物品的全部价格记录**（`ON DELETE CASCADE`），删除前必须明确告知用户 |
| `log_price` | `item`(名或id), `unit_price`, `currency?`, `observed_on?`, `quantity?`, `unit?`, `merchant?`, `transaction_id?`。**可不带交易**——这是 R4 的主场景 |
| `list_units` | 返回单位词表，供模型把"个/袋/斤"映射到 code |
| `resolve_merchant` | 名称/别名 → `merchant_id`，解析不到时可新建。让"永辉"与"永辉超市"归到同一家 |
| `update_price` / `delete_price` | 修正 / 撤销单条价格观测 |
| `price_stats` | 复用 `/prices/stats`（last/average/min/max），供"比上次贵了吗""是否超过均价 10%" |

写价格时有两条**由 schema 保证**（不是靠约定）的硬约束：

- **`unit` 必须是 `units.code` 之一**，写别的值会被外键拒绝——这正是要的：单位不统一时比价是错
  的。用户原话存进 `unit_raw`（"个"不会丢）。模型应先 `list_units` 再映射；映射不了就**保留原话、
  把 code 留空**，不要猜。
- **`merchant` 原文与 `merchant_id` 都要写**：`merchant_id` 用于比价，原文保证解析失败时不丢信息。

#### `subscriptions`

| 工具 | 说明 |
|---|---|
| `list_subscriptions` | |
| `add_subscription` / `update_subscription` / `archive_subscription` | |
| `renew_subscription` | 推进 `end_date`，并生成一笔带 `subscription_id` 的交易（金额/分类取自订阅，可覆盖） |

#### `ledger_days`

| 工具 | 说明 |
|---|---|
| `mark_no_spend` | `date`。写 `status='no_spend'`，此后不再追问那天 |
| `mark_partial` | `date`。写/改为 `status='partial'`：这天只记了一部分，仍应继续问 |
| `gaps` | 只读：返回待补日期与逾期订阅（见 §5.4） |

### 5.2 记忆：`ai_memory` 的读写时机

记什么由接入的 AI 自行判断，服务端只定义机制：

| 时机 | 行为 |
|---|---|
| 每轮开始 | 读取 `users.ai_memory`，作为快照的一部分放进 prompt（R5 要求 prompt 有界） |
| 每轮结束前 | 模型可自行决定调用 `remember(text)` 覆盖该字段，也可不调 |
| 上限 | `CHECK(length <= 2000)`；超长时服务端拒绝并回错误给模型，让它自己压缩 |

建议写进 system prompt（不是 schema 约束）：**记忆放"习惯 / 偏好 / 业务语境"，不放数字**——数字
每次由 SQL 现算更准，而记忆的价值在于模型自己不知道的判断依据。例如：

- 归类习惯：「超市购物算 Food / 日用」
- 偏好：「午餐通常在公司附近」「牛奶常买 piece 装」
- 语境：「XX 是我的固定订阅」

### 5.3 每轮对话的流程

```
用户消息
  → 存 ai_messages(role='user')
  → 服务端构造有界快照：
       · 最近 N 条消息
       · ai_memory
       · 分类树（名称/父子/type）
       · 物品名列表
       · 本月合计（SQL 算好）
       · 待补日期 + 逾期订阅
  → DeepSeek chat completions（带工具定义）
  → 若返回 tool_calls：逐个服务端校验并执行，结果回灌模型
  → 模型输出最终文本 → 存 ai_messages(role='assistant', tokens_in/out)
  → 返回 { reply, writes[] }
```

**prompt 预算**：快照各部分各有上限，总额由服务端硬顶（R5），模型请求再大也不突破。
**token 上限**：`SUM(tokens_in+tokens_out) FROM ai_messages WHERE user_id=? AND created_at>=今日`
——这就是 R6 每日上限的依据，不需要额外 usage 表。

### 5.4 提醒（R3）的实现要点

两项独立查询，各自按 `user_id` 作用域，任一失败不阻塞另一项：

1. **缺日**：最近 K 天中「无交易」且「不在 `ledger_days`」的日期。K 待定（3/7/30 天），实现时作为
   配置。注意 `status='partial'` 的那天**仍应继续问**——这是加 `status` 列的原因（§3.3）。
2. **逾期订阅**：`end_date` 已过，且该 `subscription_id` 没有对应期间的续费交易。记录续费即消解，
   无需额外状态。

---

## 6. 已定的决策

| 主题 | 决策 |
|---|---|
| AI provider | DeepSeek；密钥存 Worker secret |
| 写入方式 | AI 直接写；纠正在对话里发生 |
| 编辑 UX | 不可见：没有编辑/diff 界面。没有 change log——靠对话纠正，靠报表检验 |
| 提醒投递 | 打开应用时在应用内 |
| 价格追踪 | `item_prices` 独立于交易；取代 `transactions` 上的 item 列 |
| 单位/商家 | 归一化：`units` 词表 + `merchants`/`merchant_aliases`；原话保留 |
| 会话记忆 | 每用户一条对话 + 短 `ai_memory`；趋势一律来自 SQL |
| 撤销 / 防重 | 都由 AI 在对话层处理，不落 schema |
| 兜底分类 | **不做**：让 AI 先猜最可能的并在回复里说明，比引入会沉淀成垃圾堆的"未分类"更好 |
| Schema | 可变；须保留全部数据且更简单。迁移与代码适配已完成，未上生产 |
| Utility 数据 | 删除，不归档 |

---

## 7. 待定（都属 AI 层）

1. **缺日窗口**：向前回看 3、7 还是 30 天？
2. **价格提示阈值**：默认高出近期均价 10%，还是按物品配置？
3. **比价币种**：同币种内比较，还是先换算？当前数据全是 CNY，可缓。
4. **描述语言**：存用户原话，还是归一成单一语言？
5. **DeepSeek 成本上限**：每用户每日 token 上限是多少？R6 的成本控制需要它。
