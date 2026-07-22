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

接口抽查（替换 `TOKEN`）：

```bash
curl -s "https://bookkeeping-backend.stringwjk.workers.dev/api/v1/summary/monthly?months=6&target_currency=CNY" \
  -H "Authorization: Bearer TOKEN" | head -c 300
```

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
| 数据库 | 用上线前 `d1 export` 的 SQL 谨慎恢复；新表/新列旧代码通常可忽略 |
| 密钥 | `secret put` 写回正确值；JWT 变更后用户需重新登录 |

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
