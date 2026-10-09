# AI Bookkeeping Assistant — 需求

状态：schema v2（含后续 003/004/005）与适配代码已完成并验证；**尚未上生产**。
AI 层 Phase 0–3 **均已完成并测试**（服务层、R3/R5 端点、DeepSeek 与 `/ai/chat`、
前端对话入口）。R1–R6 逐条对账完成，见 §9。**未接真实 DeepSeek 端点做自动化联调**
（本机 `.dev.vars` 有真实密钥，已用它手工验证过对话与写入）；代码未提交。

| | 需求 | 状态 |
|---|---|---|
| R1 | 界面：仅首页，三块内容 | 已实现（对话入口挂在首页，不新增路由） |
| R2 | 对话式记账（DeepSeek） | **已完成**：`POST /ai/chat`，AI 直接写、对话式纠正，前端对话坞 |
| R3 | 缺日与订阅提醒 | **已完成**：K=3 后端检查 + `/ai/gaps`、`/ai/gaps/no-spend`、`opening` 开场带出、前端提醒块与两个动作；模型侧亦有 `mark_no_spend` / `mark_partial` / `gaps` 工具（说话即可标记，不必点按钮） |
| R4 | 物品价格历史 | **已完成**：`item_prices`、unit 词表校验、merchant 归一（`resolve_merchant` 含别名）、`compareToHistory`（按单位归一 / 超均价 10%）、按商家比价，均由工具暴露 |
| R5 | 会话记忆与上下文预算 | **已完成**：按 `session_id` 分对话（刷新即新对话、旧对话保留不删）、有界 prompt（分区 + 总量硬顶）、90 天保留期、`ai_memory` 短便签 |
| R6 | 安全与正确性 | **已完成**：JWT 作用域（模型无法指定用户）、写入前服务端校验、工具失败可自我纠正、缺密钥降级 503 且**用户消息不丢**；token 用量已记录（每日上限按决定不设） |

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

AI 回答趋势问题时，**算术由 SQL 做，AI 只负责措辞**。

> 2026-10-09 决定：不再要求复用 `/api/v1/summary/*` 的聚合实现。`summarize` 是独立实现，
> 两者总额经核对一致（同一数据同为 2101.00），差别只在粒度——首页按父类归并（5 组），
> `summarize` 给叶子分类（10 组）。

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

- 对话存在服务端，按 `session_id` 区分。**刷新页面 = 新开一个对话**（客户端每次加载生成新 id），
  模型只看当前对话；更早的对话**保留在库里、不删**，用于成本账与以后回看。
  > 2026-10-09 变更：原文为"每用户**一条**连续对话，不设多会话"。用户改为"每次刷新新开一个
  > 对话，不保留上次对话内容；需要跨对话记忆的内容将随沉淀生成文档"。因为模型的历史是**按
  > `user_id` 取**的（当时没有会话字段），"不保留"若只做界面隐藏是无效的——模型照样读得到。
  > 因此加了 `session_id`（migration 005），而不是删数据：删除不可恢复，且会把 token 成本账
  > 一起归零。详见 §8.6e。跨对话的长期记忆仍在 `ai_memory`。
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
- **每请求**的 prompt 体积硬上限（R5 要求 prompt 有界）；记录 token 用量以便看见成本。
  每日上限**已决定不设**，见 §7.5——故 `SUM(tokens_*)` 只用于观察成本，不作为拒绝条件。

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
                 -- 深度 ≤2、子类型 = 父类型：本节原称"由 API 校验"，实际代码里
                 -- 从未实现（生产数据恰好合规）。2026-10-09 已在
                 -- src/services/categories.ts 补上，见 §8.1

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

ai_messages      id, user_id → users CASCADE, session_id, role(user|assistant|tool),
                 content NULL,        -- 纯工具调用的一轮没有文本
                 tool_calls, tokens_in, tokens_out, created_at
                 -- session_id（005）标识一次对话，索引 (user_id, session_id, id)。
                 -- 刷新页面 = 新会话：模型只看当前会话，旧的留在库里（成本账 +
                 -- 以后可回看），**不删**。迁移前的行归入 'legacy'；按保留期清理（R5）

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
| `migrations/005_ai_message_sessions.sql` | `ai_messages` 增加 `session_id NOT NULL DEFAULT 'default'`（重建表）；已有行归入 `'legacy'`；索引改为 `(user_id, session_id, id)`。在 004 之后 |
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

`/prices` 已实现；`/ai/*` **已全部实现**（另有 `/ai/sessions`、`/ai/status`、`/ai/units`、`/ai/memory`）。

```
POST   /ai/chat             发送消息；返回回复与本次写入列表
                            { message | opening:true, session, timezone?, today? }
GET    /ai/messages         分页聊天历史。**必须带 ?session=**，?before=<id> 向前翻页
GET    /ai/sessions         历史对话列表（条数、首末时间、token）。界面尚未使用
GET    /ai/status           是否已配置、工具清单、token 用量（daily_token_limit 恒为 null）
GET    /ai/gaps             未闭合提醒（缺日、逾期订阅）；?today= & ?timezone= 可固定参照
POST   /ai/gaps/no-spend    { date, status? } → upsert ledger_days
GET    /ai/units            单位词表（同 /units、/prices/units 三处挂载）
GET    /ai/memory           读记忆便签
PUT    /ai/memory           { memory } 整体替换（null 清空）
POST   /ai/memory/append    { fact } 追加一条
GET    /prices              ?item_id= 历史与统计（last/avg/min，按商家）
POST   /prices              记录一条价格观测（可不带交易）；body 可带 timezone
```

`session` 由客户端每次页面加载生成：**刷新即新对话**，旧对话按 `session_id` 留在库里而**不删**。
缺 `session` 返回 400 `SESSION_REQUIRED`（不静默兜底，否则会把不相关的对话混在一起）。

AI 调用与这些端点**相同的服务端函数**（tool calling），从不运行自己写的 SQL。

---

## 5. AI 层设计

AI 层**未写代码**。本节是唯一的实现依据。

### 5.1 工具清单

> **状态（2026-10-09）：本节全部已实现。** 共 **29 个工具**，注册在
> `src/services/tools.ts`，全部委托 `src/services/` 的服务函数——与 HTTP 路由是同一份实现，
> 没有任何工具自己写 SQL。两处与本节原文的差异已按实现修正：
>
> - `rename_category` 通过可选的 `parent` 参数承担了 `move_category` 的职责，因此没有单独的
>   `move_category` 工具。
> - `resolve_merchant` 已补齐（含别名），`mark_no_spend` / `mark_partial` / `gaps` 也已补齐——
>   原先只有 HTTP 端点，模型够不着，导致"那天没花钱"无法落地、同一句提醒反复出现。
>
> 服务端对每个工具做同样三件事：① 从 JWT 取 `user_id`（模型无法指定用户）② 校验参数
> ③ 执行。金额一律用**小数**（与 API 边界一致），服务端转 cents。


#### `transactions`

| 工具 | 参数 | 服务端行为 |
|---|---|---|
| `add_transaction` | `amount`, `currency`, `date?`（省略即用户时区的今天）, `category`(名或id), `description?`, `item?`{`name`,`unit_price?`,`quantity?`,`unit?`,`unit_raw?`,`merchant?`}, `subscription_id?` | 解析分类 → 写 `transactions(source='ai')`；若给了 `item`，同时写 `item_prices`（`unit_price` 缺省时取 `amount`——**本设计新定的规则**，口径与迁移处理历史数据一致，但那规则不自动作用于新写入） |
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
| `resolve_merchant` | `name` → `merchant_id`（不存在则新建），可选 `alias` 记录为同一家的另一种写法。**实测**：显式要求合并时可用（`aliases` 落库、后续用别名写的价格解析到同一 `merchant_id`）；但模型**不会主动**把"永辉"与"永辉超市"认作一家，需用户提出或经后续沉淀 |
| `update_price` / `delete_price` | 修正 / 撤销单条价格观测 |
| `price_stats` | 复用 `/prices/stats`（last/average/min/max），供"比上次贵了吗""是否超过均价 10%" |

写价格时有两条**由 schema 保证**（不是靠约定）的硬约束：

- **`unit` 必须是 `units.code` 之一**，写别的值会被外键拒绝——这正是要的：单位不统一时比价是错
  的。用户原话存进 `unit_raw`（"个"不会丢）。模型应先 `list_units` 再映射；映射不了就**保留原话、
  把 code 留空**，不要猜。
  - **补充（2026-10-09，实测后修正）**：服务层**不再因未知单位而报错**。原先硬拒 `'斤'`
    会返回 `UNKNOWN_UNIT`，而模型收到这个信号后的"纠正"是**把斤换算成 kg**——写出一个错数字
    （5 斤 = 2.5 kg，它记成 5 kg），污染了后续要用来比价的单价历史。现在：能被词表识别的才当
    code，识别不了的**当作用户原话存进 `unit_raw`、code 留空**。既没有编造代码，也没有丢信息，
    模型也不必为了绕过报错而换算。见 §8.6f。
- **`merchant` 原文与 `merchant_id` 都要写**：`merchant_id` 用于比价，原文保证解析失败时不丢信息。

#### `subscriptions`

| 工具 | 说明 |
|---|---|
| `list_subscriptions` | `include_archived?` |
| `add_subscription` / `update_subscription` / `archive_subscription` | 新增 / 修改 / 封存（暂停，不删历史） |
| `renew_subscription` | 推进 `end_date`，并生成一笔带 `subscription_id` 的交易（金额/分类取自订阅，可覆盖） |

#### `memory`

| 工具 | 说明 |
|---|---|
| `remember` | `text`。**整体替换**该用户的记忆便签（`users.ai_memory`）。超 2000 字返回 400 让模型自己压缩 |
| `recall` | 只读当前便签。便签每轮已在快照里，此工具用于显式重读 |

#### `ledger_days`

| 工具 | 说明 |
|---|---|
| `mark_no_spend` | `date`。写 `status='no_spend'`，此后不再追问那天 |
| `mark_partial` | `date`。写/改为 `status='partial'`：这天只记了一部分，仍应继续问 |
| `gaps` | 只读：返回待补日期与逾期订阅（见 §5.4）。同一份数据每轮已在快照里，此工具用于**取最新**（例如用户刚回答完某天） |

#### 完整索引（29 个，按注册表顺序）

`add_transaction` `update_transaction` `delete_transaction` `find_transactions` `summarize`
`list_categories` `add_category` `rename_category` `delete_category`
`list_items` `add_item` `rename_item` `delete_item`
`log_price` `price_stats` `update_price` `delete_price` `list_units`
`list_subscriptions` `add_subscription` `update_subscription` `renew_subscription` `archive_subscription`
`mark_no_spend` `mark_partial` `gaps`
`resolve_merchant` `remember` `recall`

（`rename_category` 兼作 `move_category`；`delete_price` 与 `update_price` 同行列出。
与 `src/services/tools.ts` 的注册表逐名对应，可用该文件核对。）

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

## 7. 已定的决策补充（2026-10-09）

原「待定」5 项中，两项已定，其余留待实现时决定：

1. **缺日窗口 = 最近 3 天。** 指**今天之前的 3 个完整日子**，不含今天（理由见 §8.6）。
   作为配置项保留（`GAP_LOOKBACK_DAYS`）。
2. 价格提示阈值：默认高出近期均价 10%，见 `PRICE_SPIKE_THRESHOLD_PCT`。
3. 比价币种：仍同币种内比较（当前数据全 CNY）。
4. 描述语言：存用户原话，不归一化。
5. **每日 token 上限：不设。** 用户决定不限制，故 **R6 不再要求每日上限**；
   `ai_messages` 的 `SUM(tokens_in + tokens_out)` **仍然保留并记录**，用于看见成本，
   只是不再作为拒绝条件。**每请求的 prompt 体积硬上限已实现**（R5，16000 字符），
   它与每日成本上限是两件事：前者防止单次请求撑爆上下文，后者才涉及花费。
6. **日期规则按时区算，默认 UTC+8**（2026-10-09 追加，用户要求）。
   见 §8.6a。

## 8. 实现进展（2026-10-09）

### 8.1 Phase 0：服务层抽取（**已完成**）

文档 §5.1 假定 AI 工具"调用与这些路由**相同的服务端函数**"。开始实现时发现该前提
**不成立**：`src/api/*.ts` 里没有任何可复用业务函数，逻辑全部内联在 Hono 处理器中并
直接依赖 `c`。因此先做 Phase 0 抽取 `src/services/`，处理器降为薄适配层。

全程以 `scripts/check.sh` 为护栏，现为 **8 层全绿**：

| 服务 | 状态 | 说明 |
|---|---|---|
| `services/errors.ts` | 完成 | `ServiceError` + 状态码映射，使服务层不依赖 HTTP |
| `services/transactions.ts` | 完成 | create/update/delete；新增 `source` 与 `merchant` 两个 AI 参数 |
| `services/categories.ts` | 完成 | CRUD **＋ 补上缺失的结构校验**（见下） |
| `services/items.ts` | 完成 | list/fetch/history/create/rename/delete/search；`resolveItemIdByName` 在此 |
| `services/prices.ts` | 完成 | 观测的读写、stats、按商家比价、R4 比较（`compareToHistory`） |
| `services/subscriptions.ts` | 完成 | CRUD、archive/restore、**renew**（120 行单体）、`listRenewals` |
| `services/units.ts` | 完成 | `units` 词表 + `assertKnownUnit`（把外键错误变成可读 400） |
| `services/merchants.ts` | 完成 | 别名 → 名称 → 新建 的商家解析；原文与实体都写 |
| `services/gaps.ts` | 完成 | R3 两项独立检查 + `ledger_days` 三态（Phase 1） |
| `services/memory.ts` | 完成 | R5 的 `ai_memory` 读写与长度校验（Phase 1） |
| `services/conversation.ts` | 完成 | `ai_messages` 存取、有界窗口、token 记账、保留期清理（Phase 2） |
| `services/deepseek.ts` | 完成 | DeepSeek 客户端：密钥隔离、超时、错误归类、可注入 fetch（Phase 2） |
| `services/prompt.ts` | 完成 | R5 的有界 prompt：分区上限 + 总上限（Phase 2） |
| `services/tools.ts` | 完成 | §5.1 工具注册表，**25 个工具**，全部委托 `src/services/` |
| `services/queries.ts` | 完成 | `find_transactions` 与 `summarize`（SQL 聚合，模型不做算术） |
| `services/chat.ts` | 完成 | §5.3 对话循环：工具调用、结果回灌、轮次上限、token 记账 |

**抽取中发现并修复的缺陷**（都不是事先假设的）：

1. **分类结构校验根本不存在。** §3.1 与 `db/schema.sql` 都声称"深度 ≤2、子类型 = 父类型
   由 API 校验"，但全代码库无相关逻辑。生产数据恰好合规（实测最深 2 层、0 处类型不匹配），
   是靠数据而非代码保住的。后果不是美观问题：`summary.ts` 用 `c.type` 分类且只做一层
   归并，第三层会被算到一个汇总从不访问的非根父类下，跨类型子类则按其父类类型计入——
   两种情况都会让报表数字**静默变错**，正撞 R6。已在 `services/categories.ts` 实现，
   并由 `services_test.ts` 覆盖。
2. **`transactions.source` 从未被写入 `'ai'`。** 旧 POST 把 `source` 硬编码为 `'manual'`，
   AI 写入若不改此处会全程错误标注。服务层现接受 `source`，HTTP 路径默认仍为 `'manual'`
   （行为不变），并有测试钉住两条路径。
3. **测试夹具对 `RETURNING` 语句会执行两次。** 两个 shim（`api_write_test.ts`、
   `services_test.ts`）对含 `RETURNING` 的写入先调 `stmt.all()` 取返回行、再调
   `stmt.run()` 取元数据。在 `node:sqlite` 上 `all()` **本身就已执行写入**，于是每条
   `INSERT ... RETURNING` 都插入两行。原先未暴露，是因为旧 `createTransaction` 写
   `item_prices` 用的是**不带 RETURNING** 的 INSERT（走单执行分支）；改用服务层的
   `logPrice`（带 RETURNING）后立刻表现为"价格行重复"。已修两个 shim，并补上
   `last_insert_rowid()` 取回 `meta.last_row_id`（`auth.ts` 注册流程依赖它）。

### 8.2 已核实的 D1 行为（影响 AI 工具设计）

在真实 `wrangler dev` + D1 上实测（非推理）：D1 连接上 **`PRAGMA foreign_keys = 1`**，
即外键**确实强制**。写入 `item_prices.unit = '个'` 或任何非 `units.code` 的值会失败：

```
D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
```

含义：§5.1「`unit` 必须是 `units.code` 之一，写别的值会被外键拒绝」**成立**。但错误是
数据库异常而非可读的 400。R6 要求模型输出是"不可信输入"并得到能自我纠正的反馈，
因此 **`log_price`/`add_transaction` 在服务层显式校验 `unit`**，返回带合法词表的 400：

```json
{"error":"Unknown unit \"个\". Use list_units and one of: bag, bottle, ...","code":"UNKNOWN_UNIT","allowed_units":[...]}
```

### 8.3 Phase 1：R3/R5 的非模型端点（**已完成**）

这些端点**不调用模型**：它们只计算与存储。因此 DeepSeek 不可用或缺密钥时，提醒逻辑
依然可被验证与使用（R6），`/ai/chat` 只负责把结果变成措辞。

| 端点 | 作用 |
|---|---|
| `GET /ai/gaps` | 缺日：**窗口是今天之前的 3 个完整日子，不含今天**（见 §8.6）+ 逾期订阅；两项独立查询，各自失败不阻塞另一项（`errors[]`） |
| `POST /ai/gaps/no-spend` | `{date, status?}`，upsert；`no_spend` 停止追问，`partial` 保留该日 |
| `GET/PUT /ai/memory` | R5 记忆便签的读与整体替换；超 2000 字返回可纠正的 400 |
| `POST /ai/memory/append` | 追加一条事实 |
| `GET /ai/units`、`/units`、`/prices/units` | §5.1 要求的单位词表（三个挂载点，供模型映射"个/袋/斤"） |

**新增测试层 3c**（`scripts/ai_endpoints_test.ts`，41 项）：`services_test.ts` 直接调服务
函数，**无法**发现"路由没挂上""路径被别的路由遮蔽""端点无需 token 即可访问"——而那正是
`api.route(...)` 接线与鉴权的失效方式，且既有的 API 契约基线早于这些路由。该层走真实
app 与鉴权中间件。

### 8.4 Phase 2：DeepSeek 与 `/ai/chat`（**已完成**）

| 端点 | 作用 |
|---|---|
| `POST /ai/chat` | `{message}` 走完整对话循环；`{opening:true}` 由服务端算出缺口后让模型开场 |
| `GET /ai/messages` | `?before=<id>` 分页聊天历史（R5） |
| `GET /ai/status` | 是否已配置、工具清单、token 用量（**`daily_token_limit: null`**） |

关键实现约束：

- **模型永远无法指定 user。** `userId` 在 `createToolRunner` 一侧从 JWT 绑定，任何工具的
  参数 schema 里都没有 `user_id`——这条由测试钉住（"no tool lets the model name a user"）。
- **模型永远不写 SQL。** 25 个工具全部委托 `src/services/`，与 HTTP 路由是同一份实现。
- **失败是信息，不是异常。** 工具拒绝（未知单位、分类仍被占用）以 `{ok:false, code}` 回灌
  模型，让它同一轮自我纠正。这条修掉了一个真实缺陷：`badRequest` 原先不接受 code，
  `UNKNOWN_UNIT` 只能塞在 `details` 里，模型拿到的是无意义的 `HTTP_400`。
- **每请求有界。** `PROMPT_CHAR_BUDGET = 16000`（分区各自有上限 + 总量再压一次）、
  `MAX_TOOL_ROUNDS = 6`。**每日上限不设**已定，故轮次上限是防止单轮失控的结构性保护；
  token 仍逐条记在 `ai_messages` 上以便看见成本。
- **开场指令不落库。** R3 的开场由服务端先算出缺口再让模型措辞；该指令是一条合成消息，
  `recordUser:false` 保证它**不会**以用户消息形式出现在聊天记录里（否则用户会看到自己
  没说过的话）。由测试钉住。
- **缺密钥不崩。** `POST /ai/chat` 返回 503 与可读原因，其余功能照常（R6）。密钥是 Worker
  secret，不进 `wrangler.toml` `[vars]`，本地用 `.dev.vars`。

### 8.5 Phase 3：前端对话入口（**已完成**）

`client/src/components/features/ChatDock.tsx`：右下角悬浮按钮 + 对话面板，挂在首页
（应用只有首页）。它按需求而非按习惯设计：

- **AI 直接写、没有确认步骤。** 没有批准按钮、没有 diff 视图；回复说明记了什么，
  报表就是检验。写入成功后调用 Dashboard 自己的 `loadData()` / `loadSubscriptions()`
  刷新，数字立刻变动。
- **提醒由服务端算出。** 面板显示 `GET /ai/gaps` 的结果，并把每一天交给两个动作
  （"那天没花钱" → `no_spend`；"只记了一部分" → `partial`），而不是让模型复述。
  首次打开时用 `opening:true` 让助手带出提醒；若已有对话则跳过，不重复开场。
- **缺密钥不破坏页面。** 先查 `GET /ai/status`；`configured:false` 时把输入框换成一句
  说明，而不是给一个必然报错的输入框（R6）。
- **工具拒绝要如实说。** `writes[]` 里有失败项时弹出错误（并显示服务端原因），
  因为助手的回复**不是**写入成功的证据。

**验证方式（真实浏览器，非仅构建）**：用 Playwright 连真实后端（`wrangler dev`
+ `/tmp/prod-staging` 真实数据）走查：

- 无密钥时正确渲染 `Assistant unavailable` 与解释文案，**0 个 console 错误**；
- 有提醒时渲染 `Reminders` + `No records for 2026-10-09` + 两个动作；
- 发送链路：POST `/ai/chat` → 重新拉取历史 → 消息气泡渲染（用一条真实持久化的
  `晚饭 42` 确认）；
- 失败链路：503 时乐观气泡被移除、显示服务端原因、空态文案回来。

> 走查中修正的两点：`playwright-cli route` 只拦截发往 Vite 端口（5174）的请求，
> 而客户端 API 在 8787，所以最初的打桩从未生效、测的是真实后端；据此才发现下面
> §8.7 的缺陷。

### 8.6 缺日窗口的语义修正（用户指出）

**原实现把"今天"也算进缺日窗口，于是每次打开都会提醒"今天没有记录"——这不成立。**
今天还没过完，用户可能只是还没花钱、或还没顾上说；拿它当缺口会在每次打开时都追问，
而答案（"还没有"）也不含任何信息。真正值得问的是**已经过完的日子**。

已把 `gapWindow` 改为返回**今天之前的 `days` 个完整日子**（K=3，即昨天、前天、大前天）。
窗口内所有日子都是已完结的，"没有记录"在那里才是一个真实的缺口。`GapsResult.window.to`
因此是**昨天**而不是今天。这条修正是用户指出的，不是自查发现的。

修正后连带发现并修掉的三处问题（都是这处语义的连带影响）：

1. **开场逻辑的测试断言此前是"假通过"。** `an opening turn without a key also reports
   503` 之所以通过，恰恰**因为**旧窗口含今天——今天没交易 → 有缺口 → 走到 provider
   检查 → 503。窗口改正后夹具里那三天都有记录、没有缺口，`runOpeningTurn` 便正确地
   早退返回 `{reply:null}` 且**不需要密钥**。现在的行为更对：没有缺口就没有什么要说，
   也不该因此失败。断言已重写为两条，分别覆盖"无缺口无需 provider"与"有缺口但无密钥
   返回 503"，且**自建前置条件**（先逐日回答以关闭默认窗口），不再依赖前序测试层留下的
   库状态。
2. **`today` 未贯穿到 `/ai/chat`。** `runOpeningTurn` 接受 `today`，但处理器没有把它
   从请求体传下去，于是无法固定参照日。已补上（与 `/ai/gaps` 的 `today` 同源），并校验
   格式。
3. 窗口跨月边界由 UTC 日期运算处理，已加断言（`2026-11-02` → `10-30, 10-31, 11-01`）。

### 8.6a 日期规则改为按时区（用户要求）

**原实现全部用 UTC 推"今天"** —— 全仓库没有任何时区处理，`findGaps`、`logPrice`、
`createTransaction`、renew 的默认日期都是 `new Date().toISOString().slice(0,10)`。
在 UTC+8 的凌晨 0:00–8:00，UTC 日期比本地日期**早一天**，于是提醒窗口整体错位去问
前天/昨天而**漏掉昨天**（用户刚过完的那天），同一时段写入也会落到错误日期上。

已按用户决定实现：**按用户时区，默认 UTC+8**（`DEFAULT_TIMEZONE = Asia/Shanghai`）。

- 新增 `src/utils/time.ts`：`localDateString`（用 `Intl.DateTimeFormat` 取指定时区的
  日历日，无需打包时区库）、`todayInZone`、`localGapWindow`、`requireTimezone`
  （非法时区返回 **400 + `UNKNOWN_TIMEZONE`**，不是静默回退）。
- **客户端**传它自己的 IANA 时区（`clientTimezone()`，取
  `Intl.DateTimeFormat().resolvedOptions().timeZone`，回退 `Asia/Shanghai`），
  三处日期相关调用都带上：`sendAiMessage`、`openAiConversation`、`getAiGaps`。
- **四处默认日期统一**：缺日窗口、`createTransaction` 的 `date`、`logPrice` 的
  `observed_on`、renew 的续费日期。都由同一个时区值推导，不会各算一套而互相错位。
- **显式给出的日期永不位移** —— 只有"省略日期"才解析。这条有测试：
  `an explicitly supplied date is never shifted`。
- `add_transaction` 的 `date` 因此改为**可选**（"今天买的东西"本来就没人会报日期）。
- `/ai/gaps` 与 `/ai/chat` 的响应/入参都接受 `timezone`，`gaps` 会**回显**生效时区，
  客户端不必假设。

实测（真实 `wrangler dev`）：默认返回 `timezone: Asia/Shanghai`、窗口 `2026-10-06 →
2026-10-08`；显式 `America/New_York` 被接受；`Mars/Olympus` 返回 400
`UNKNOWN_TIMEZONE`。决定性的一对断言在 `services_test.ts`：同一时刻
`2026-10-09T17:00Z`，UTC 称 `2026-10-09`、UTC+8 称 `2026-10-10`，
两个窗口因此相差整整一天。

`addDays`（订阅周期推算）保持纯日历运算、锚定 UTC 午夜：一个计费周期是**天数**，
不应因某地夏令时变成 29 或 31 天。它回答的是"日历加几天"，与"现在是哪天"是两件事，
后者才归 `utils/time.ts`。

### 8.6b 比价按单位归一 —— 修掉一个真实误算（用户场景驱动）

用户描述的场景（"上个月买 30ml，这个月买 50ml，希望比较单价"）暴露了 R4 比价里的一个
真实错误：

```sql
-- 原 compareToHistory
WHERE user_id = ? AND item_id = ?     -- 不看 unit，不看 quantity
AVG(unit_price_cents)                 -- 直接平均
```

**不同规格的价格被混在一起平均。** 生产数据里已经中招：`G7速溶三合一咖啡` 有
`pack` 单位的 1 / 50 / 100 三个数量、单价 0.91 / 0.96 / 0.68，原代码把三者直接平均。

用户定的规则：**同单位内比，但不同单位的同款商品要列出来**。已实现：

- `groupPricesByUnit`：按 `unit` 分组，每组把 `unit_price_cents / quantity` 归一到
  **每单位价**。同一样本里所有金额统一为**元**（曾出现 `min_per_unit=120` 与
  `average_per_unit=1.35` 混在同一对象内的缺陷，会让模型说出"每 ml 要 120 元"，已修
  并加断言）。
- `compareToHistory` 增加 `unit` / `quantity`，**只在同一 unit 内**取较早观测求均值；
  其他单位作为 `other_units` 单独返回、**绝不参与平均值**；无单位观测单列
  `without_unit`，明确不可归一。
- `price_stats` 工具改为返回 `comparable` / `other_units` / `without_unit` 三段，
  模型拿不到"可混合的平均值"。
- prompt 增加两条：尺寸用 `quantity` + 单位码、**尺寸不写进物品名**；只在同单位内比。

实测（30ml/45 元 与 50ml/60 元）：

```
50ml 总价更贵，但每 ml 便宜 → change_pct === -20   （正是用户要的答案）
跨单位 → 返回 null，并单列 piece 组
无单位 → 单列且 average_per_unit 为 null
```

用户确认的物品写法：**物品名不带尺寸**（`洗发水`），尺寸放 `quantity + unit`。
**不需要改表结构** —— `quantity` 与 `unit` 就是为此准备的。

### 8.6c 助手不能改表结构（用户加的规则）

用户要求"助手不能修改表结构"。核实后确认**现在本来就没有这条路径**：服务层无 DDL，
工具只收结构化参数、从不执行模型给的 SQL。因此这条做的是"把已成立的事实写成明文
并加锁"，三层落地：

1. **system prompt** 明文禁止，并要求**如实反馈**："If a request would need a
   structural change, say so plainly and describe what is missing… Do not pretend the
   change happened."
2. **结构锁进测试**：遍历全部工具定义，任何描述里出现 DDL、或参数里出现
   `sql`/`query`/`ddl`/`statement`/`migration` 即失败。今天没有所以通过；以后加工具
   就会红。这是防止未来破坏的机制，不是修补漏洞。
3. **断言伪 SQL 工具被拒**（`run_sql` → `UNKNOWN_TOOL`）。

### 8.6d 细致程度：由 AI 判断，底线是产品名 + 单位 + 数量（用户定）

用户明确："由 AI 来判断是否细致，底线是产品名称、单位和数量。如果当前表结构不满足时，
助手要反馈用户。"

- **底线写进 prompt**：一条账够细 = 有产品名 **且** 有单位 **且** 有数量；只有金额不算。
  要求它**先记账再追问**（"one short question, not an interrogation"），并且
  **不许臆造缺失的细节**。
- **`find_transactions` 增加字段存在性筛选**（`missing_detail` / `missing_field`）。
  这是"通用能力"而非专用工具：它回答的是**缺失**，而缺失无法靠翻页发现——账本比一轮
  能翻的量大（实测一轮只能到 300/487）。**这是让上一条规则可执行的必要条件**，否则
  prompt 让助手去查、而它查不动。
- 该筛选**只判断字段是否存在，不评价描述写得好不好**（描述里有测试钉住这一点）。
- 实测真数据：`missing_detail: true` 命中 50（上限截断，实际 464 笔没挂物品）；
  `missing_detail: false` 命中像 `G7速溶三合一咖啡` 这种完整的。

> 相关实测：`find_transactions` 单次上限 50、一轮工具上限 6，487 笔在**单轮内翻不完**
> （最多 300 笔）。这不是能力问题而是配置，但**字段存在性筛选让"哪些记粗了"这类问题
> 无需翻页即可回答**，因此第 2 条可以落地。

### 8.6e 会话隔离：刷新页面 = 新对话（用户改需求，**推翻 §3.1 的原始设计**）

原文 §3.1 写的是"每用户**一条**连续对话，刷新与换设备都还在。不设多会话——记账不需要"。
用户改了这条：**每次刷新页面改为新开一个对话，不保留上次对话内容**；需要跨对话记住的东西
以后随沉淀生成文档再加。

这条改动有个**关键陷阱**，动手前已核实：

```
loadRecentMessages:  WHERE user_id = ?          ← 模型的历史只按 user 取，没有会话概念
```

所以"界面不显示旧对话"是**假的**——模型照样读得到、照样被影响。要做到"从 0 开始"，
**只有两条路**：把旧对话删掉，或者给对话加标识。

第一版选了"删"，被用户否掉，改为 **session id**，这是更好的方案：

| | 删 | **session_id（采纳）** |
|---|---|---|
| 模型只看当前对话 | ✅ | ✅ |
| 旧对话留存 | ❌ 不可恢复 | ✅ 成本账、以后可回看 |
| token 成本统计 | ❌ 一起归零 | ✅ 仍然跨会话汇总 |

**落地内容**：

- **migration 005**：`ai_messages` 增加 `session_id TEXT NOT NULL DEFAULT 'default'`，
  已有行归入 `'legacy'`（它们本来就是一整段连续对话，归到一个 id 正好保留原意），
  索引改为 `(user_id, session_id, id)`。重建表而非 ALTER，因为 SQLite 无法给已存在的表
  加 NOT NULL 列——与 003 同一个结论。
- **读写全部按会话**：`loadRecentMessages` / `pageMessages` / `recordMessage` 都带
  `session_id`；`buildPrompt` 与 `runChatTurn` 必须传（缺失返回 400 `SESSION_REQUIRED`，
  不静默兜底——静默兜底会把不相关的对话混在一起）。
- **客户端每次页面加载生成一个新 id**（内存中，不持久化），随 `/ai/chat` 与
  `/ai/messages` 一起发送。刷新自然产生新 id，就是"刷新 = 新对话"。
- **`GET /ai/sessions`**：列出历史对话（条数、首末时间、token）。**UI 还没用**，
  但没有它，"保留而不删"就没有意义。
- **`ai_memory` 不受影响**：它才是跨对话的长期记忆，正是"沉淀"该去的地方。

**验证**（服务层 + HTTP 层都有）：新会话的 prompt **不含**旧会话任何一句；旧会话内容
原封不动；分页按会话隔离；空/超长会话 id 返回 400；token 用量跨会话汇总。

真数据预演也补了对 005 的断言——原先预演**只验证了 003**（"content is nullable after
003"），005 是空跑。现在检查列存在、NOT NULL、索引、默认值、拒绝 NULL：

```
[PASS] ai_messages gained session_id after 005
[PASS] session_id is NOT NULL after 005  — notnull=1
[PASS] the conversation index is present after 005
[PASS] a turn written without a session is still recorded  — default
[PASS] session_id rejects NULL
```

### 8.6f 单位不换算 —— 修掉一个错数字，以及造成它的那个信号

**用户报告助手输出是双语**，查下去牵出两个更严重的问题。

**① 双语（已修）**：那条英文是**工具调用前的过渡话**（`content` 非空 + 带 `tool_calls`）。
system prompt 原本只写 `Reply in the language the user writes in`，模型理解为只管最终回复，
于是过渡话用了 prompt 的语言。而它**会存进历史、每轮重放**，所以不是一次性瑕疵。

修了三处：system prompt 明确"从第一个字起、工具调用之间的句子也算、绝不混用"；**每轮追加一条
语言指令**放在最末紧贴用户消息（system 里的规则太远）；**新增"不要预告"规则**。实测表明
**第三条才是根治**——中间轮现在全是纯工具调用（`content: null`），不再有英文句子。
界面侧同时修了 `visibleMessages`：它原先只过滤 `tool` 角色，**没过滤带 `tool_calls` 的助手
消息**，导致一条用户消息出现两个助手气泡、且把内部叙事暴露给用户。

**② 单位换算（严重）**：模型把用户说的"**5 斤**"记成 `quantity=5, unit=kg`。5 斤 = 2.5 kg，
**这是一个错数字**，而且写进了以后要用来比价的单价历史。

根因不是模型笨，而是**我们给的信号错了**：服务层对未知单位硬拒（`UNKNOWN_UNIT`），模型为了
完成任务就"换算"绕过。prompt 里写着 "Never invent a unit code"，它用转换绕过了这条。

修法：

- **服务层不再因未知单位报错**。能被词表识别的才当 code，识别不了的当作用户原话存 `unit_raw`、
  code 留空。没有编造代码，也没有丢信息，模型也不必为绕过报错而换算。
- prompt 增加硬规则：**NEVER convert between units**，并点名这个具体的坑（"5 斤 is not 5 kg"）、
  要求"按用户给的数字和措辞原样记录"、要求**如实说明**该单位无法参与比价。
- 工具描述（`log_price`、`add_transaction`）同步，避免与 prompt 冲突——模型先读工具描述。

**③ 该不该问规格（用户定：不做结构强制）**：用户明确"助手应该可以自行判断哪些物品需要记录
单位"。实测确认它本来就会判断：

```
买了瓶洗发水30ml，45元 → quantity=30 unit=ml   ✅ 记住了尺寸
剪了个头发35           → 无规格              ✅ 并说明"理发是一次性服务，没有规格"
```

prompt 因此补成按**物品性质**判断：按量购买的东西（食品、饮料、日用品、任何论斤论个的）有规格，
用户给就记、没给就问；**理发、打车、订阅、账单是一次性服务，没有单位，记金额且永不追问规格**。

**修复前后对比**（同一句"买了5斤苹果，30块"，看 `item_prices`）：

```
修复前  quantity=5  unit=kg      ← 换算成 kg，错
修复后  quantity=5  unit=(null)  ← 原样记录，unit_raw='斤' 保住原话
```

**验证**：服务层 229 项断言（本轮 +15），含"未知单位按原样存储且不折算成 kg"、
"理发类不加规格"。4 条旧断言（原先钉"未知单位必须 400"）随需求变更改写——它们钉的是被
本次修正故意改掉的行为。

### 8.7 Phase 3 中发现并修复的缺陷

**用户消息在 AI 不可用时被静默丢弃。** `runChatTurn` 先检查 `isAiConfigured` 再存
消息，于是缺密钥时直接 503，用户刚打的那句话**永远不存在**——与代码里"provider 失败
时消息不丢"的注释直接矛盾。已改为**先落库再检查配置**并在测试中钉住。实测确认修复：

```
POST /ai/chat -> HTTP 503          （仍是 503，行为对外不变）
ai_messages 行数 0 -> 1             （消息保住了）
GET /ai/messages -> [{"role":"user","content":"晚饭 42", ...}]
```

### 8.8 尚未完成

- 未接真实 DeepSeek 端点做联调（工具循环用注入的 completion 驱动，无需密钥与网络；
  真实密钥路径只验证了"缺失时优雅降级 503"与"消息不丢"）。
- 客户端没有测试基础设施（无 vitest/jest），故 UI 目前靠 typecheck + lint + build
  加一次人工浏览器走查，没有自动化回归。补测试框架是超出本次请求范围的依赖决定。
- 代码尚未提交；Phase 0–3 的改动都在工作区。

---

## 9. R1–R6 逐条对账（2026-10-09）

对全文档逐条比对**代码实际实现**，不是凭记忆。结论：**功能完成**，过程中发现并修掉 3 个真实
缺口，另有 2 处文档陈述与实现不符（已按实现修正）。

### 9.1 修掉的缺口

| # | 缺口 | 为什么是真问题 |
|---|---|---|
| ① | **模型没有 `ledger_days` 工具** | 只有 HTTP 端点，模型够不着。用户在对话里说"那天没花钱"，模型**只能口头答应、实际没写**，同一天会被反复追问——正是 R3 点名的场景。已补 `mark_no_spend` / `mark_partial` / `gaps` |
| ② | **`resolve_merchant` 缺失，`merchant_aliases` 是死代码** | `addMerchantAlias()` 写好但**从无调用点**，所以"永辉"与"永辉超市"无法归到一家，R4 的按商家比价失去意义。已补工具；测试钉住"用别名写的价格解析到同一 `merchant_id`" |
| ③ | **`summarize` 未复用 `/summary/*`** | 用户决定**不修**，并从文档中移除该要求。实测两者总额一致（同一数据同为 2101.00），差别只在粒度：首页 rollup 到父类（5 组），`summarize` 给叶子（10 组） |

### 9.2 文档与实现不符之处（已按实现修正）

| 文档原述 | 实际 | 处理 |
|---|---|---|
| §3.1 与 R5："每用户**一条**连续对话，不设多会话" | 按 `session_id` 分对话，刷新即新对话 | 正文按实现改写，变更理由见 §8.6e |
| §3.1 迁移表只列到 004 | 已有 `005_ai_message_sessions.sql` | 补入表中 |
| §5.1 开头："**下列工具目前都不存在**" | 29 个工具全部已实现 | 改为状态说明 + 完整索引 |
| §4："`/ai/*` 全部未实现" | 已全部实现，另有 4 个端点未在本文档出现过 | 端点清单补全 |
| §5.1 `add_transaction` 的 `date` 必填 | 已改为可选（省略即用户时区的今天） | 按实现修正 |
| §5.1 工具清单无 `memory` 一节 | `remember` / `recall` 存在但只在 §5.2 散文里提过 | 补表格 |

### 9.3 一个不修但需要知道的局限

**模型不会主动把两个拼写认作同一家店。** 实测：说"在永辉超市买了鸡蛋"和"在永辉买了牛奶"，
它建了 `永辉超市(3)` 与 `永辉(4)` 两个商家实体。但**显式要求合并时工具完全可用**（`aliases`
落库、后续用别名写的价格解析到同一 `merchant_id`）。

因此 R4 的"永辉/永辉超市必须是一家"目前**依赖用户提出或后续沉淀**，不是自动的。若要自动化，
需要在服务层做名称相似度匹配——那是一个独立决定，未做。

### 9.4 验证

```
scripts/check.sh                8 层全绿（服务层 244 项、端点层 79 项）
真实 DeepSeek 端点              用本机 .dev.vars 的密钥手工验证：对话、写入、多笔、
                                单位不换算、语言一致、缺口识别
浏览器                          对话坞渲染、顺序（最新在下）、提醒块、失败提示
```
