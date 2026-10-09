# 货币换算

## 概览

应用的展示货币跟随界面语言：**English → USD，中文 → CNY**。汇率取自 Open Exchange Rates，
缓存 24 小时以节省额度（免费档 1000 次/月）。

所有 API 返回的都是**小数金额**；数据库存的是整数分（`amount_cents`），换算在 API 边界完成。
详见 [AI_BOOKKEEPING_ASSISTANT.md](AI_BOOKKEEPING_ASSISTANT.md) §3.5。

## 配置

密钥是 Worker secret，**不是** `.env`，也绝不放进 `wrangler.toml` 的 `[vars]`：

```bash
cd backend-ts
npx wrangler secret put OPEN_EXCHANGE_RATES_API_KEY
```

本地开发放在 `backend-ts/.dev.vars`（已被 gitignore）：

```
OPEN_EXCHANGE_RATES_API_KEY=your_key_here
JWT_SECRET=any_local_value
```

后台依赖只有 `hono` 与 `bcryptjs`，没有额外的 Python 包；`npx wrangler dev` 即起本地服务。

## 行为

- **自动检测**：English → USD，中文 → CNY（前端 `useCurrency` 随语言切换）。
- **缓存**：汇率存 `exchange_rates`，24 小时内直接命中缓存；API 失败时沿用旧值。
- **自动换算**：概要接口按 `target_currency` 换算后返回；交易列表同时显示换算值与原币金额；
  新建交易以当前语言的货币保存。

## API

两个接口都需要 JWT（原先无鉴权，v2 起已加上）。

### `GET /api/v1/exchange-rates/rates`

```
?base=USD&force_refresh=false
```

```json
{
  "base": "USD",
  "rates": { "USD": 1.0, "CNY": 6.8672 },
  "last_updated": "2026-02-25T08:54:06.096Z"
}
```

### `GET /api/v1/exchange-rates/convert`

```
?amount=100&from_currency=USD&to_currency=CNY
```

```json
{
  "amount": 100,
  "from_currency": "USD",
  "to_currency": "CNY",
  "rate": 6.8672,
  "converted_amount": 686.72
}
```

### `GET /api/v1/summary?target_currency=CNY`

```json
{
  "total_income": 6867.20,
  "total_expense": 3433.60,
  "balance": 3433.60,
  "currency": "CNY"
}
```

## 数据

`exchange_rates` 是**每个币种对一行**，通过 UPSERT 更新（v2 之前是每次抓取追加一行，读时只取最新
一条）：

```sql
CREATE TABLE exchange_rates (
    base_currency   TEXT NOT NULL CHECK (length(base_currency) = 3),
    target_currency TEXT NOT NULL CHECK (length(target_currency) = 3),
    rate            REAL NOT NULL,
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (base_currency, target_currency)
) WITHOUT ROWID;
```

`transactions.currency` 每个交易各存一份（默认 `CNY`），因此历史记录一直保留其原始币种。

## 排查

- **汇率取不到**：确认 Worker secret 已设；未设时接口返回 500 且概要接口会失败——已有功能不受影响，
  但换算类视图会报错。缺密钥时的报错是 `OPEN_EXCHANGE_RATES_API_KEY not configured`。
- **没有换算**：确认交易本身有 `currency`；确认缓存里有该币种对（缓存是每对一行）。
- **超出额度**：免费档 1000 次/月；默认 `force_refresh=false` 会走缓存。
