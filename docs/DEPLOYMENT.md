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

缺失时**只执行一次**（或轮换密钥时）：

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
```

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

#### 例外：schema v2（`001` + `002`）是破坏性迁移，上述顺序要反过来

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

# 3. 前置修复：把 5 条"有价无 item"的行挂到 items，否则它们的价格会被丢弃
npx wrangler d1 execute bookkeeping-db --remote \
  --file=./migrations/001_link_priced_rows_to_items.sql

# 4. 重新导出并确认验证器到 33/0（要对新导出跑，不是第 1 步那个）
npx wrangler d1 export bookkeeping-db --remote --output=prod-backup-after-001.sql
python3 -I scripts/verify_migration.py prod-backup-after-001.sql

# 5. 同一分钟内：先 push（触发部署），紧接着应用 002，再应用 003
#    （003 针对的是 v2 schema，必须在 002 之后）
git push origin main
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/002_schema_v2.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/003_ai_layer_tables.sql
npx wrangler d1 execute bookkeeping-db --remote --file=./migrations/004_normalise_units_merchants.sql
```

**关键点：**

- **先 push 再迁移**：把不可控的部署延迟放前面，同步的 migration 紧接其后。
- **迁移窗口内不要 push 别的东西**。当前所有 schema v2 改动都是**未提交**状态，所以步骤 5 之前
  `main` 上仍是旧代码，这是对的；不要为了"先存个代码"而提前 push。
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

接口抽查（先登录拿 token，可直接沿用前端 localStorage 里那个）：

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
```

注意：**生产无法本地签 JWT**（`JWT_SECRET` 是 Worker secret），所以只能走登录拿 token。

## 什么会随 push 自动走，什么不会

| 类型 | 是否自动 |
|------|----------|
| 前端静态资源 / Worker 代码 | 是（Cloudflare Git CI/CD） |
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

## 本次（2026-07-15）发布清单参考

功能摘要：订阅续费闭环、Dashboard 分析图、交易页快捷筛选与收支汇总、物品删除等。

```text
[x] secret list 确认 JWT_SECRET、OPEN_EXCHANGE_RATES_API_KEY
[x] 生产 D1 备份
[x] 订阅续费表 migration（已应用，脚本已清理）
[x] Food 分类数据同步（已应用，一次性脚本已清理）
[ ] git push origin main → 等 Cloudflare 部署
[ ] 生产冒烟（见上）
```

## 相关路径

- 功能需求文档：`docs/features/`
- 后端配置：`backend-ts/wrangler.toml`
- 全量 schema：`backend-ts/db/schema.sql`
- 增量 migration：`backend-ts/migrations/`（当前无待执行脚本）
- 本地密钥：`backend-ts/.dev.vars`（勿提交）
