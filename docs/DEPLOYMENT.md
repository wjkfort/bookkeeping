# 上线指南（Production Deploy）

本文说明如何把本仓库变更发到生产环境。  
**日常代码**走 Cloudflare 的 Git CI/CD（push 即部署）；**数据库结构变更**需本机用 Wrangler 显式执行，不会随 push 自动跑。

## 架构速览

| 组件 | 服务 | 标识 |
|------|------|------|
| 前端 | Cloudflare Pages | 项目名约 `bookkeeping-client-new`，URL: `https://bookkeeping-client-new.pages.dev` |
| 后端 | Cloudflare Workers | `bookkeeping-backend` → `https://bookkeeping-backend.stringwjk.workers.dev` |
| 数据库 | Cloudflare D1 | `bookkeeping-db`（id 见 `backend-ts/wrangler.toml`） |
| 源码 | GitHub | `https://github.com/wjkfort/bookkeeping`，生产分支一般为 `main` |

仓库内**没有** `.github/workflows`。前后端自动上线依赖 **Cloudflare Dashboard 里绑定的 Git 集成**（Pages / Workers 连接该仓库）。push 到绑定分支后由 Cloudflare 拉代码构建部署。

## 密钥（Secrets）— 不要写进仓库

生产密钥使用 **Workers Secrets**，与代码部署分离：

```bash
cd backend-ts
npx wrangler secret list
```

至少应存在：

- `JWT_SECRET`
- `OPEN_EXCHANGE_RATES_API_KEY`
- `DEEPSEEK_API_KEY`（AI 助手。缺失时 `/ai/*` 返回 503，**其余功能照常**，属 R6 的降级路径）

缺失时**只执行一次**（或轮换密钥时）：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
```

`wrangler.toml` 里有 `[env.production]` / `[env.development]` 两个空环境块，`secret put` 会警告"未指定环境"。
只要输出里是 `Creating the secret for the Worker "bookkeeping-backend"`（**没有** `-production` 后缀）就是对的：
它落在顶层环境，也就是线上那个 Worker。`ENVIRONMENT` 变量全仓库无人读取，这两个块是死配置。

说明：

- `wrangler deploy` / Cloudflare Git 部署**正常不会清空**已有 Secrets。
- 本地 `.dev.vars` **只用于** `wrangler dev`，不会同步到生产。
- **不要**把密钥放进 `wrangler.toml` 的 `[vars]`。
- 若更换 `JWT_SECRET`，所有已登录用户的 token 会失效，需重新登录。

若上线后登录或汇率异常，先 `secret list`，再查 Cloudflare Dashboard → Worker → Settings → Variables and Secrets。

## 标准上线流程

### 1. 确认登录与密钥

```bash
cd backend-ts
npx wrangler whoami
npx wrangler secret list
```

### 2. 有数据库变更时：先备份再迁移

```bash
# 可选但推荐：导出生产库
npx wrangler d1 export bookkeeping-db --remote \
  --output=prod-backup-$(date +%Y%m%d).sql

# 执行对应增量 migration（有文件时）
# npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/001_xxx.sql
```

校验示例：

```bash
npx wrangler d1 execute bookkeeping-db --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'subscription%';"
```

**注意：**

- 迁移与代码发布顺序：优先 **先 migration，再发会依赖新表的后端**，避免短窗口 500。
- `db/schema.sql` 面向**新库**初始化（`CREATE IF NOT EXISTS`），**不要**用它升级已有生产库。
- 增量 DDL 放 `backend-ts/migrations/`（序号命名，如 `001_xxx.sql`），并同步更新 `db/schema.sql`。
- 一次性业务数据脚本不要放进 `migrations/`；跑完可删。
- 备份文件含用户数据，已在 `backend-ts/.gitignore` 忽略 `prod-backup.sql` 等；勿提交。

#### 例外：schema v2（`001`–`005`）是破坏性迁移，上述顺序要反过来

> 本节记录的是 **2026-10-09 实际执行完毕**的那次发布（001–005 一次跑完）。生产库已迁移到 v2，
> 现在的待执行清单是空的；保留本节是因为**下一次破坏性迁移仍然适用同一套推理**。

"先 migration 再发代码"对**向后兼容**的变更是对的，但 schema v2 **不向后兼容**：旧代码读不了
新 schema（`amount_cents` / `item_prices` / `cycle_days` 都不存在），会直接 500。两种顺序各有一
个窗口，必须选**可控**的那个：

| 顺序 | 结果 |
|---|---|
| 先 migration，再 push 代码 | 从迁移完成到 Worker 部署完成之间，**线上是坏的**。而 push 触发 Cloudflare CI/CD，部署要几十秒到几分钟，这个窗口你控制不了 |
| 先 push 代码，再 migration | 从 Worker 部署完成到迁移完成之间线上是坏的，但 migration 是你用 `wrangler d1 execute` **同步执行**的，可以紧接在部署之后几秒内完成 |

**正确顺序：**

```bash
cd backend-ts

# 0. 先在副本上预演整个序列（12 项断言，含"备份可恢复"）
python3 -I scripts/rehearse_migration.py prod-backup-<date>.sql

# 1. 备份。这是真正的安全网（已验证可完整恢复）
npx wrangler d1 export bookkeeping-db --remote --output=prod-backup-<date>.sql

# 2. 把代码提交好，但【先不要 push】
git add … && git commit -m "…"

# 3. 前置列修复（仅当生产缺 subscriptions.archived_at 时）：先探测再决定
npx wrangler d1 execute bookkeeping-db --remote --command \
  "SELECT name FROM pragma_table_info('subscriptions') ORDER BY cid"
# 缺 archived_at 才执行——该文件不可重复运行，第二次会报 duplicate column name
npx wrangler d1 execute bookkeeping-db --remote \
  --file=./migrations/000_add_archived_at_to_subscriptions.sql

# 4. 前置修复：把 5 条"有价无 item"的行挂到 items，否则它们的价格会被丢弃
npx wrangler d1 execute bookkeeping-db --remote \
  --file=./migrations/001_link_priced_rows_to_items.sql

# 5. 重新导出并确认验证器到 40/0（要对新导出跑，不是第 1 步那个）
npx wrangler d1 export bookkeeping-db --remote --output=prod-backup-after-001.sql
python3 -I scripts/verify_migration.py prod-backup-after-001.sql

# 6. 紧接着应用 002 → 003 → 004 → 005 → 006 → 007 → 008
#    （003 针对 v2 schema，必须在 002 之后；005 针对 003 建的表，必须在 003 之后；
#      006/007 建触发器，必须等 002 重建完 categories 之后；
#      008 重排分类树并改数据，必须在最后——它依赖 006 的触发器允许这些改动）
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/002_schema_v2.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/003_ai_layer_tables.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/004_normalise_units_merchants.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/005_ai_message_sessions.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/006_category_structure_triggers.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/007_value_domain.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/008_category_tree.sql
```

**006 可以单独补跑，不影响上面那次迁移的历史。** 它只建两个触发器、不改任何一行数据，幂等
（`CREATE TRIGGER IF NOT EXISTS`），也不依赖代码部署：应用后线上立刻多出三条约束。

对 2026-10-10 导出的生产库实测：**52 行分类**（17 个一级 + 35 个子分类）全部满足这三条规则
（最大深度 2、0 处类型不匹配、0 处自引用、0 处跨用户父分类），所以补跑不会拒绝任何存量数据。
（此前这里写的是 68 行——那是本地库的数字，本地库当时已被历次测试数据污染，不是生产。）

**实际执行时改了一点（更好）：不等 push，而是本机 `npx wrangler deploy` 先把后端发上去。**
实测后端确实绑了 Cloudflare Git CI/CD（push 后自动多出一次部署），但 CI 的部署延迟不可控；
本机 `wrangler deploy` 是同步的，命令返回即表示版本已上线，因此能把坏窗口压到"迁移语句的执行时间"。
2026-10-09 实测：`deploy` 9 秒，四条迁移合计 21 秒，**坏窗口约 20 秒**。
push 留到迁移完成之后再发（那时 CI 再部署一次同样的代码，无害），否则 Pages 会先用新前端打到旧后端。

**关键点：**

- **先 push 再迁移**：把不可控的部署延迟放前面，同步的 migration 紧接其后。
- **迁移窗口内不要 push 别的东西。**（2026-10-09 执行时，`main` 上领先 origin 6 个提交、
  全是未 push 的 v2 改动，所以步骤 5 之前线上仍是旧代码——这一点是对的，不要为了"先存个代码"提前 push。）
- **先确认生产到底在哪个版本**，不要相信文档：`wrangler deployments list` 的最后一个部署若与
  `git rev-parse origin/main` 对应，说明后端是 push 即部署；再用一条只读 SQL 探生产 schema：

  ```bash
  npx wrangler d1 execute bookkeeping-db --remote --command="SELECT
   (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='item_prices')  AS v2,
   (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_messages')  AS ai,
   (SELECT COUNT(*) FROM pragma_table_info('ai_messages') WHERE name='session_id') AS sess,
   (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='merchants')    AS mch;"
  ```

  `0,0,0,0` = 仍是 v1，要走完整破坏性序列；`1,1,0,1` = 只差 005；`1,1,1,1` = 已迁完。
  表不存在时这些子查询返回 0 而不是报错，所以四种状态都能安全区分。
- 若后端 Worker 也绑了 Cloudflare Git 集成，**push 本身就会部署后端**，无需再 `npm run deploy`；
  若只绑了前端，则 push 后执行 `cd backend-ts && npm run deploy`。
- `002` **不能重复执行**：它先把现有表改名为 `*_old` 再建新表，第二次跑会在中途失败并把数据留在
  `*_old` 里。`wrangler d1 execute --file` 是单事务，失败会整体回滚；但成功之后再跑一次就是主动
  破坏。只跑一次。
- 冒烟验证重点：金额（Dashboard 月趋势、交易汇总、物品价格列）与分类删除（有交易时应 409）。


### 3. 发布代码（CI/CD）

无 DB 变更、或 migration 已完成时：

```bash
# 仓库根目录
git status
git add …
git commit -m "…"
git push origin main
```

然后到 Cloudflare Dashboard 确认：

1. **Pages** 项目是否在 Build / Deploy 成功  
2. **Workers** `bookkeeping-backend` 是否出现新 Deployment  

若 Git 集成只绑了前端，后端需本机：

```bash
cd backend-ts
npm run deploy
```

若 Git 集成前后端都绑了，一般 **push 即可**，无需再本地 `deploy`。

**2026-10-09 确认：前后端都绑了。** 证据是 push 之后 `wrangler deployments list` 立刻多出一次部署
（本机 `wrangler deploy` 之外的第二次）。所以 push 会同时触发 Pages 构建和 Worker 部署——
**破坏性迁移时要记住这一点**（见下方"例外"一节：push 即部署后端，无法只推前端）。

### 4. 冒烟验证

打开生产前端并登录，建议检查：

- [ ] 登录正常（JWT）  
- [ ] Dashboard 月趋势 / 分类图有数据  
- [ ] 交易页：今天 / 本月快捷筛选；收入 / 支出 / 净额汇总  
- [ ] 物品页可删除物品  
- [ ] 订阅「续费」：有金额且已绑分类时生成支出并推进到期日（依赖 migration）  
- [ ] 金额换汇无 API key 报错  
- [ ] **物品价格列**：v1 只统计"录了单价"的购买，所以部分物品迁移后会显示**修正过的**最后/平均价
      （当前数据里是物品 1、2、4、21、22）。这是修复，不是回归
- [ ] **分类删除**：删一个有交易的分类必须被拒（409）并保持数据不动；删空分类应成功
- [ ] **AI 助手**（首次发布 AI 层时查）：
  - [ ] 右下角对话区能发出一轮问答，回复与问题同语言
  - [ ] **刷新页面 = 新对话**，不带上一次的内容；旧对话仍在库里（`SELECT session_id, COUNT(*) FROM ai_messages GROUP BY 1`）
  - [ ] 说"那天没花钱"后，该日期不再出现在补记提醒里
  - [ ] 让它报一个总额，与 Dashboard 对得上
  - [ ] `DEEPSEEK_API_KEY` 缺失时 `/ai/*` 应为 503 而降级，其余页面照常
- [ ] **注意 `/summary` 约需 60 秒**（见"已知问题"），页面能出数就说明没坏，不要误判成超时故障

接口抽查（先登录拿 token，可直接沿用前端 localStorage 里那个）：

> 用 Python `urllib` 直接打生产会被 Cloudflare 拦掉（`403`，`error code: 1010`）——它按 UA 判定，
> `curl` 默认 UA 没事。用脚本探测时记得带上浏览器 UA。

```bash
EMAIL='<你的登录邮箱>'
TOKEN=$(curl -s -X POST https://bookkeeping-backend.stringwjk.workers.dev/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"<你的密码>\"}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# 金额：应与迁移前一致
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/summary" \
  -H "Authorization: Bearer $TOKEN"
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/summary/monthly?months=6&target_currency=CNY" \
  -H "Authorization: Bearer $TOKEN" | head -c 300

# 新路由：应返回 200（未带 token 时应为 401）
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/prices/stats" \
  -H "Authorization: Bearer $TOKEN" | head -c 300

# AI 层
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/ai/status" \
  -H "Authorization: Bearer $TOKEN" | head -c 200     # configured 应为 true
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/ai/gaps" \
  -H "Authorization: Bearer $TOKEN" | head -c 300
```

注意：**生产用的 `JWT_SECRET` 与本地 `.dev.vars` 是同一个值**（2026-10-09 实测：用本地 secret
签出的 HS256 token 能直接打通生产）。所以冒烟不一定要走登录，也可以本地签一个
`{"sub":<user_id>,"exp":<未来>}` 的 token——本次上线就是这么做的。反过来说，`.dev.vars` 泄漏等于
生产令牌可伪造，**绝不能提交**（已在 `.gitignore` 中）。要切断这层关系就 `secret put` 换一个
新值，代价是所有已登录用户需要重新登录。

## 什么会随 push 自动走，什么不会

| 类型 | 是否自动 |
|------|----------|
| 前端静态资源 / Worker 代码 | 是（Cloudflare Git CI/CD，前后端都已确认绑定） |
| D1 schema 变更 | **否**，需 Wrangler 远程执行 |
| Workers Secrets | **否**，用 `secret put` 管理，勿每次重设 |
| 业务数据整理（如本地 Food 分类重命名） | **否**，勿把仅本地数据脚本当生产 migration |

## 回滚简述

| 层 | 做法 |
|----|------|
| 前端 | Pages → Deployments → 回滚上一成功版本 |
| 后端 | Workers → Deployments → 回滚；或 checkout 旧 commit 再 deploy |
| 数据库 | schema v2 **不能靠"旧代码忽略新列"回滚**，见下方专节 |
| 密钥 | `secret put` 写回正确值；JWT 变更后用户需重新登录 |

### 数据库回滚：schema v2 是破坏性的，必须走完整恢复

**不要相信"新表/新列旧代码可以忽略"。** 那条经验对向后兼容的变更是对的，但 v2 把
`transactions.amount` 换成了 `amount_cents`、把 `item_id/unit_price/quantity/unit` 移进了
`item_prices`、把 `subscriptions.cycle` 改名 `cycle_days` —— 旧代码读这些列会直接 500。回滚
**必须**把数据库也恢复成 v1。

**做法：把迁移前的导出重放进一个新建的 D1，然后把 Worker 指过去。**

不要试图在现有 v2 库上原地重建。实测两种原地做法都会失败：

- 直接把导出重放到 v2 库上 → `table exchange_rates already exists`（导出的 DDL 是裸
  `CREATE TABLE`）。整段在一个事务里，会安全回滚，但恢复不了。
- 先 `DROP TABLE` 再重放 → 生成的顺序不安全（`sqlite_master` 不保证父表在子表之后），
  实测在 `DROP TABLE users` 上因外键失败：`no such table: main.users`。

**实测过的步骤**（本机对 487 笔的副本验证：重放后行数与金额分毫不差）：

```bash
# 0. 前提：迁移前那份导出（上线流程第 1 步导出的）
BACKUP=prod-backup-<date>.sql

# 1. 建一个新的 D1 空库
npx wrangler d1 create bookkeeping-db-restore

# 2. 把迁移前的导出重放进去（v1 schema + 全部数据）
npx wrangler d1 execute bookkeeping-db-restore --remote --file=$BACKUP

# 3. 校验：应为 487 笔、金额一致，且列名是 amount（不是 amount_cents）
npx wrangler d1 execute bookkeeping-db-restore --remote \
  --command="SELECT COUNT(*) AS tx FROM transactions"

# 4. 把 backend-ts/wrangler.toml 的 database_id 改成新库的 id，然后 publish
#    （数据库内容没变，只是换了绑定；代码若也回滚则一并 deploy）

# 5. 确认无误后再删除旧库（先别急）
```

**注意：**

- 第 4 步之前，线上是坏的（新库还没接上、或代码与库不匹配），属于**最后手段**。
- **数据库回滚与代码回滚要一起完成**：只回滚代码，新代码会跑在 v1 上；只回滚数据库，旧代码
  会跑在 v2 上。两种都是 500。
- 顺序建议：先建好并重放新库 → 回滚代码（Workers → Deployments → 回滚上一版本）→ 切换
  `database_id` 并 deploy → 冒烟 → 最后删除旧库。
- `bookkeeping-db-restore` 这个库不含迁移前的备份数据以外的内容，是干净的；旧库原样保留，
  所以这次回滚本身也是可逆的。

## 已知问题（不阻塞使用，但要知道）

### `/summary` 需要约 60 秒 —— 既有的 N+1，不是本次引入

`src/api/summary.ts` 的查询**按交易逐行返回**（`SELECT t.amount_cents, t.currency, c.type …`，
没有 `GROUP BY`），然后在 `for` 循环里对**每一行**调用 `await getExchangeRate(...)`。
`getExchangeRate` 每次都会查一遍 `exchange_rates` 缓存表，于是 487 笔交易 = **487 次 D1 往返**。
2026-10-09 生产实测：`/summary` 58.9s、`/summary?month=2026-10` 58.6s，稳定复现。

这一条**在本次发布之前就存在**：`git diff 922c706 HEAD -- src/api/summary.ts src/utils/currency.ts`
显示循环结构未变，只把 `row.amount` 换成了 `centsToAmount(row.amount_cents)`、把缓存新鲜度判断从
SQL 挪到了 JS。`/summary/monthly` 因为结果按行数少得多而明显更快。

修法是按币种分组后只解析每行**唯一币种**的汇率（最多几次），或把汇率查询提到循环外。尚未修。

### 静态资源体积

前端单包 849 KB（gzip 263 KB），未做代码分割，`vite build` 会告警。

## 发布记录

### 2026-10-09 — schema v2 + AI 层（已完成）

功能摘要：AI 记账助手（29 个工具、按会话隔离的对话、补记提醒）、服务层抽取、`/ai/*` 与 `/units` 端点。

```text
[x] secret list 确认 JWT_SECRET、OPEN_EXCHANGE_RATES_API_KEY
[x] secret put DEEPSEEK_API_KEY
[x] 只读探针确认生产仍是 v1（v2=0 ai=0 sess=0 mch=0）
[x] 生产 D1 备份（两份，逐字节相同 → 数据未变）
[x] rehearse_migration.py 预演通过；verify_migration.py 38 passed / 0 failed
[x] 远端 001 预检修复（5 条"有价无 item"的行 → 0 条，新建 3 个 item）
[x] 重新导出 + 校验（prod-backup-after-001.sql）
[x] 本机 wrangler deploy → 紧接着 002/003/004/005（坏窗口约 20 秒）
[x] 迁移后核对：487 笔不变、CNY 7,201,277 分不变、item_prices 23、items 14、categories 52
[x] git push origin main → Pages 发布新前端（产物哈希与本地构建一致）
[x] 生产冒烟：/ai/status configured=true、/ai/chat 往返 2.5s、落库带 session_id、CORS 预检 204
```

发布前的关键判断：生产 `origin/main` = `922c706`（2026-08-20），与最后一次 Worker 部署时间吻合 →
**代码是 push 即部署、且 v2 从未上过生产**。这个结论来自 `wrangler deployments list` + 只读探针，
不是来自本文档；当时文档里"v2 改动均未提交"那句话已经过期。

### 历史参考：2026-07 订阅续费 / Dashboard 发布

功能摘要：订阅续费闭环、Dashboard 分析图、交易页快捷筛选与收支汇总、物品删除等。

```text
[x] secret list 确认 JWT_SECRET、OPEN_EXCHANGE_RATES_API_KEY
[x] 生产 D1 备份
[x] 订阅续费表 migration（已应用，脚本已清理）
[x] Food 分类数据同步（已应用，一次性脚本已清理）
[x] git push origin main → 等 Cloudflare 部署
[x] 生产冒烟（见上）
```

## 相关路径

- 功能需求文档：`docs/features/`
- 后端配置：`backend-ts/wrangler.toml`
- 全量 schema：`backend-ts/db/schema.sql`
- 增量 migration：`backend-ts/migrations/`（已应用到 `005`，**当前无待执行脚本**）
- 本地密钥：`backend-ts/.dev.vars`（勿提交）
- 生产导出：`backend-ts/prod-backup-*.sql`（含真实用户数据，已在 `.gitignore` 中，勿提交）
