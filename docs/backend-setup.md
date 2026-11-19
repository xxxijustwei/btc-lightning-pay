# Breez Spark 后端接入与部署

`apps/backend` 是 Cloudflare Worker 业务后端，`apps/wallet` 是北美 Bun 1.4.2 钱包服务（wallet-service）。钱包服务直接运行 `@breeztech/breez-sdk-spark` 0.28.4，平台控制一个主网 Spark 钱包；商户、订单和结算由 Worker 管理。用户前端不加载 SDK、不接触钱包密钥。

## 本地初始化

1. 安装 Bun 1.4.2（`bun --version` 核对），再执行 `pnpm install --frozen-lockfile`。SDK 的可选 SQLite 构建被禁用，实际使用 PostgreSQL。
2. 准备一个项目专用的 Supabase PostgreSQL。Worker 用 `btc_backend` 访问 `public` 中的业务表，钱包用 `btc_wallet` 访问 `breez_wallet` 中的 SDK 表。关闭 Supabase Data API，详见 [认证配置](auth-setup.md)。
3. 在 `packages/db/.env` 配置所有者连接 `DATABASE_ADMIN_URL`，执行 `pnpm --filter @btc-lightning-pay/db run migrate`。在同一个数据库中用所有者依次执行 [provision-backend-role.sql](../packages/db/sql/provision-backend-role.sql) 和 [provision-wallet-role.sql](../packages/db/sql/provision-wallet-role.sql)，再为两个运行账号分别设置密码。钱包脚本将 `btc_wallet` 的 `search_path` 设为 `breez_wallet`，SDK 首次启动时自行建表。
4. 业务表结构以 `packages/db/migrations/` 为准。`migrate` 只应用尚未记录在 `drizzle.__drizzle_migrations` 的迁移，每个迁移一个事务，可在已有数据库上重复执行。修改 `packages/db/src/schema.ts` 后执行 `pnpm --filter @btc-lightning-pay/db generate --name <变更名>` 生成下一个迁移并重建 `sql/schema.sql`（全部迁移的拼接，仅供测试和审阅）。新表需在其迁移中补 `FORCE ROW LEVEL SECURITY`，手写 SQL 用 `generate --custom --name <变更名>`。`0000_baseline` 之前建过的开发库与基线不兼容，在新的开发数据库中初始化业务表，保留原库及钱包数据。
5. 首次创建钱包时，安全生成并备份 BIP39 助记词。如果已有钱包，先按 [钱包部署](#dokploy--orbstack) 中的说明迁移数据，沿用原助记词。将 `apps/wallet/.env.example` 复制为 `.env` 后填写。助记词不应来自文档示例、聊天或代码仓库。执行 `pnpm --filter @btc-lightning-pay/wallet identity` 离线导出公钥，将输出填入 `BREEZ_IDENTITY_PUBKEY`。服务启动会校验该身份，配置错误时拒绝启动。
6. 在 Worker `.dev.vars` 中合并下表配置；不要覆盖已有认证配置。分别执行 `pnpm dev:wallet` 和 `pnpm dev:backend`。默认钱包入口为 `127.0.0.1:9741`。Wallet 的 dev/start/identity 脚本均使用 Bun，显式读取 `apps/wallet/.env`；不自动加载其他 `.env.*`。

| 变量                          | 位置     | 用途                                                                  |
| ----------------------------- | -------- | --------------------------------------------------------------------- |
| `WALLET_URL`                  | Worker   | 本地 HTTP loopback 或生产 HTTPS 钱包服务 origin                       |
| `WALLET_TOKEN`                | 两端     | 至少 32 字符的随机服务间 Bearer token                                 |
| `WALLET_ACCESS_CLIENT_ID`     | Worker   | Cloudflare Access service token ID；生产必填                          |
| `WALLET_ACCESS_CLIENT_SECRET` | Worker   | 同上的 secret；本地开发可留空                                         |
| `BREEZ_API_KEY`               | 钱包服务 | Breez 接入凭证                                                        |
| `BREEZ_MNEMONIC`              | 钱包服务 | 平台钱包助记词，仅本地开发使用                                        |
| `BREEZ_MNEMONIC_FILE`         | 钱包服务 | 只含助记词的文件路径（部署用，二者只能设一个）                        |
| `BREEZ_IDENTITY_PUBKEY`       | 钱包服务 | 预期的钱包身份公钥                                                    |
| `BREEZ_DATABASE_URL`          | 钱包服务 | 同一个 PostgreSQL 数据库的 `btc_wallet` 连接串，远端连接验证 TLS 证书 |
| `WALLET_HOST` / `WALLET_PORT` | 钱包服务 | 默认 127.0.0.1 / 9741                                                 |

平台不向商户扣收款手续费，订单 API 和数据库均没有费用字段。商户应收为固定 `amountSat`；`receivedMsat` 直接来自 SDK 收款金额乘 1000。完成且到账金额不少于 invoice 金额的支付即为已付；多付部分记为 `excessMsat`，归平台人工处理，不计入商户应收。到账少于 invoice 金额、或 invoice 与订单不符的记录是异常：钱包返回 409 `PAYMENT_MISMATCH`，Worker 记 `payment_anomaly` 日志，订单保持原状，付款页照常显示。Worker 对钱包给出的每条事实（查询结果、到账同步的收款、新开的发票）都在入账模块（`payments/crediting.ts`）里再核对一次，日志的 `anomaly` 字段说明原因：`unknown_order`（没有对应订单）、`contradicts_order`（订单号、发票、hash 或金额不符）、`underpaid`（到账不足）、`amount_changed`（已付订单的到账金额被改报）、`wallet_reported`（钱包自己返回 409）。开票时的异常同样释放占位并返回 `WALLET_UNAVAILABLE`，但记为异常而不是故障。Spark 收款不扣费（`fees` 为 0）；上线前在真实环境确认一次 `receivePayment` 返回的 `fee` 为 0。

## 给 Claude 的接口约定

共享 Schema 从 `@btc-lightning-pay/api` 导入；完整路径和字段位于 [payments.ts](../packages/api/src/payments.ts)。前端添加同源 `/api/public/*` 与 `/api/admin/*` 代理，复用 `proxyBackendRequest` 和 `BACKEND` binding；不要把 Wallet token 暴露给浏览器。后端关闭了 `workers_dev` 和预览 URL，只能经前端的服务绑定访问。管理员写请求必须保留 `Origin`，且与 `BETTER_AUTH_URL` 的 origin 相同（末尾斜杠不影响）；管理接口同时要求真实会话和启用的管理员账号。这些检查只在一处：契约给 `adminPayments` 组声明了 `AdminSession` middleware，后端实现（`payments/admin-session.ts`）依次检查认证配置（不可用返回 503）、写请求的 `Origin`（`ORIGIN_REJECTED`）、会话和管理员状态（未通过返回 401），通过后向管理接口提供 `AdminActor`，并回写刷新后的会话 cookie。公开接口拿不到 `AdminActor`，误用会是类型错误。

账号与商户接口完整说明见 [用户管理与前端交接](user-management.md)。管理员由数据库 `role=admin` 且 `banned=false` 授权，使用同一套邮箱 OTP 登录。

创建商户：`POST /api/admin/merchants`，JSON `{"name":"Onne 商户","email":"merchant@example.com","slug":"onne"}`。一次事务创建用户和商户，返回内部 UUID `id` 与独立 `slug`。商户名称、邮箱仅管理接口返回。`slug` 为 3–32 位小写字母、数字或连字符，必须字母开头，创建后不可改、不回收。`PATCH /api/admin/merchants/:merchantId` 支持 `name`、`enabled`；禁用同步禁用账号、撤销会话并阻止新订单，已有 invoice 和结算继续处理。

公开读取 `GET /api/public/merchants/onne` 返回：

```json
{
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "slug": "onne",
  "enabled": true,
  "currency": "USD",
  "minAmountUsdCents": 100,
  "maxAmountUsdCents": 30000
}
```

创建订单：`POST /api/public/merchants/onne/orders`，`Idempotency-Key` 使用一次用户提交产生的 UUID，重试复用该值；请求体为 `{"amountUsdCents":1500,"reference":"可选订单号"}`。金额以整数美分传输，范围 100–30000。备注最多 128 字符。行情为 100000 USD/BTC 时的示例响应：

```json
{
  "id": "12345678-1234-4234-8234-123456789abc",
  "merchantId": "11111111-1111-4111-8111-111111111111",
  "amountUsdCents": 1500,
  "amountSat": 15000,
  "status": "pending",
  "invoice": "lnbc150u1...",
  "expiresAt": "2026-11-17T13:00:00.000Z",
  "serverTime": "2026-11-17T12:00:00.000Z"
}
```

HTTP 200 时订单和 invoice 都已保存，状态为 `pending`（同一幂等键重试可能返回已 `paid` 或 `expired` 的原订单），前端可直接展示二维码，无需再查一次。同一幂等键的另一个请求仍在开票时返回 409 `ORDER_IN_PROGRESS`（`Retry-After: 1`），付款页用同一幂等键每秒重试，最多 20 次。钱包开票失败返回 503 `WALLET_UNAVAILABLE`，不保存订单；前端停留在金额页提示重试，并复用同一幂等键。付款页 `/invoice/:orderId` 每 3 秒调用 `GET /api/public/orders/:orderId`，页面不可见时放缓；失败退避，不把网络失败画成未支付或已过期。`expired` 后每 15 秒查询，到期 10 分钟后停止（之后后端也不再为付款人向钱包查询，由定时同步兜底）。用 `serverTime` 校正倒计时，只有后端 `paid` 才显示成功。`expired` 后仅由用户主动新建订单，使用新幂等键。订单状态只有 `pending`、`paid`、`expired`。

公开响应不包含备注、payment hash、费用或结算信息；链接持有者可以查看本笔付款信息，不可列出商户历史。支付状态说明见 [方案](backend-phase-one.md)。Cash App 入口按参考页使用 `https://cash.app/launch/lightning/{invoice}`；这一跳转仍待真机验证。

商户和订单列表 API 默认 `limit=50&offset=0`，最大 100，offset 最大 100000。订单支持 `merchantId`、`status`、`from`（含）、`to`（不含）；时间用 ISO8601。返回数组，没有总数或游标。订单详情额外返回报价、备注、实际到账金额 `receivedMsat`、超额 `excessMsat`、到账时间及 `settlementId`、`settlementStatus`；金额单位是 millisatoshi，1 sat = 1000 msat。打开订单详情时总会向钱包核对一次未付订单，订单列表和汇总只读数据库。

`GET /api/admin/merchants/:merchantId/summary` 返回 `merchantId` 和以下口径（金额单位 sats）：

| 字段                     | 含义                                                 |
| ------------------------ | ---------------------------------------------------- |
| `paidSat`                | 全部已确认支付订单的商户应付                         |
| `settledSat`             | 已确认结算完成的金额                                 |
| `unsettledSat`           | 未结清金额，包括待付款批次                           |
| `pendingSettlementSat`   | 已生成结算单、尚未确认付款的占用金额                 |
| `availableSettlementSat` | 未被批次占用，可以生成新结算单的金额                 |
| `unconfirmedOrderCount`  | 尚未过期、等待付款的订单数量；已过期未付的订单不计入 |

恒等式：`unsettledSat = paidSat - settledSat`，`availableSettlementSat = unsettledSat - pendingSettlementSat`。这些数值不是钱包可用余额，平台节点成本不从商户应付扣除。

### 结算单接口

流程：生成固定结算单 → 平台人工转账 → 填写凭证确认完成。服务端不执行转账。同商户允许多张互不重叠的待付款单，同一天可以多次结算。

```http
POST /api/admin/settlements
Idempotency-Key: 8b562e87-a348-4e04-9705-3c09b4ea7195
Content-Type: application/json

{"merchantId":"11111111-1111-4111-8111-111111111111"}
```

创建时不再传 orderIds、amountSat 或 proof，旧字段和其他未知字段返回 400。后端在同一事务内固定该商户全部已确认到账、未被有效批次占用的订单及总金额，不限制为 100 笔；无可选订单返回 409 `NO_ELIGIBLE_ORDERS`。停用商户仍能结算历史收款。

新建返回 201；同幂等键、同商户重试返回 200 和原批次当前状态。响应包含 `id, merchantId, status, amountSat, orderCount, cutoffAt, createdAt, createdBy, proof, confirmedAt, confirmedBy, cancelReason, cancelledAt, cancelledBy`，不返回整个订单 ID 数组，也不暴露幂等键。未填写的审计字段为 null。

| 接口                                      | 说明                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `GET /api/admin/settlements`              | 支持 merchantId、status、from、to、limit、offset；按创建时间倒序          |
| `GET /api/admin/settlements/:id`          | 读取批次金额、笔数、状态和审计记录                                        |
| `GET /api/admin/settlements/:id/orders`   | 分页读取固定明细，每条含 orderId、merchantId、amountSat；取消后明细仍保留 |
| `POST /api/admin/settlements/:id/confirm` | `{ "proof": "外部转账凭证" }`，仅待付款单可确认                           |
| `POST /api/admin/settlements/:id/cancel`  | `{ "reason": "尚未付款，重新核对" }`，仅待付款单可取消                    |

结算列表和明细列表返回 `{items,total,limit,offset}`；默认 50、每页最多 100、offset 最大 100000。批次列表时间过滤针对 createdAt，from 含、to 不含。详情明细按订单 ID 排序。订单详情中的 settlementStatus 独立于支付 status：pending 表示占用，settled 才是已结算；不能只看 settlementId 非空就显示已结算。

状态为 pending（待付款）、settled（已结算）、cancelled（已取消）。生成时只增加占用，确认时才计入已结算，取消释放占用但不删除明细。已结算不可取消、改凭证或删除；取消后不可确认。

凭证去首尾空白后为 1–1000 字符，取消原因 1–500 字符。同批次相同凭证重复确认／相同原因重复取消返回原结果，保留首次操作者和时间；不同内容返回对应 409 冲突。确认与取消并发只有一个成功。转账结果不明时保持待付款，先核实，不取消或再次付款。

截止时刻由数据库在生成时取快照，按毫秒记录；包含快照可见且 paidAt 不晚于截止时刻的订单，包括往日积累。之后的新到账、迟到确认不改变本批，顺延下一批。API 返回 UTC ISO8601，前端固定按北京时间 `Asia/Shanghai` 展示；不以午夜自动切账。创建结算单不会同步扫描所有 钱包 invoice。

业务错误与输入校验错误统一返回 `{ "code": "...", "message": "..." }`。无效 JSON、Schema 输入校验失败返回 400 `INVALID_INPUT`；内部响应编码错误返回 500 `INTERNAL_ERROR`，不暴露原始校验内容。Worker 支付响应和 Wallet 响应带 `X-Request-Id`，可用于关联日志。

| HTTP      | 常见 code / 含义                                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400       | 输入不合法、`INVALID_PAGINATION`、`INVALID_DATE`、`BODY_TOO_LARGE`                                                                                     |
| 401 / 403 | 未登录、`ADMIN_REQUIRED`、`ORIGIN_REJECTED`                                                                                                            |
| 404       | `MERCHANT_NOT_FOUND`、`ORDER_NOT_FOUND`                                                                                                                |
| 409       | `IDEMPOTENCY_CONFLICT`、`ORDER_IN_PROGRESS`、`MERCHANT_DISABLED`、`MERCHANT_EXISTS`、`USER_IS_MERCHANT`、`NO_ELIGIBLE_ORDERS`、`SETTLEMENT_*_CONFLICT` |
| 429       | `RATE_LIMITED`：见下方限流；重试使用原幂等键                                                                                                           |
| 503       | `QUOTE_UNAVAILABLE`、配置缺失或服务故障；不展示为支付失败                                                                                              |

### 限流

| 层级                        | 规则                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| 边缘（`ratelimits` 绑定）   | 下单每 IP + 商户 slug 每分钟 10 次；其他公开读取每 IP 每分钟 60 次 |
| 数据库准入（精确）          | 开票前占位：每商户每秒 5 张、全平台每秒 10 张                      |
| 登录（Better Auth，数据库） | 发码每 IP 每 10 分钟 5 次、验证码登录每 IP 每 10 分钟 10 次        |
| 登录（按邮箱）              | 每个邮箱每小时最多 10 次发码；被攻击时该管理员最多 1 小时无法收码  |

边缘限流按 Cloudflare 机房分别计数，是近似值；`namespace_id` 是账号内自定义的数字，与其他 Worker 冲突时修改。客户端 IP 取 `cf-connecting-ip`，由付款页代理原样转发。

## 钱包查询与恢复

调用方向为 Worker → wallet-service → SDK。钱包服务不回调 Worker，不写业务库，不开放发送资金接口。SDK 使用 Treasury 配置：一个长期实例、后台同步开启、60 秒同步周期、关闭跨设备同步、关闭 Spark 直接支付偏好，保持默认退出恢复数据采集。

三个业务接口均要求 `Authorization: Bearer <WALLET_TOKEN>`：

- `POST /v1/invoices`：`{orderId, amountSat}`，生成有效期 3600 秒的 BOLT11。
- `POST /v1/payments/query`：`{orderId, amountSat, paymentHash, invoice}`，核对 invoice 的订单说明、网络、金额、hash；只接纳 SDK 已完成的 Lightning 收款记录。
- `POST /v1/payments/completed`：`{since}`（Unix 秒），返回该时刻起已完成收款的一页（最多 500 条，按时间升序）：`{payments, latest, more}`。非订单 invoice 的收款跳过；与订单不符的收款记 `payment_anomaly` 后跳过。

响应为 `{orderId, amountSat, paymentHash, invoice, expiresAt, paidAt, receivedMsat}`。未到账时最后两个字段为 null；开票和查询都直接返回 200 和这份事实，没有 202 中间态。Worker 的 Wallet 只如实转达这份事实，核对由入账模块负责；`mismatch` 只表示钱包自己返回了 409。Worker 未配置钱包时，下单返回 `WALLET_NOT_CONFIGURED`，查询保留已存订单并在日志里记录 `reason: "not_configured"`，到账同步单独失败。SDK 的 payment ID 与 payment hash 不混用。SDK 内部记录的 preimage、费用和钱包密钥不出现在接口或日志中。

单笔查询不维护全量索引：钱包从 invoice 解析出创建时间和有效期，只读取「创建前 60 秒到到期后 5 分钟」之间完成的收款，耗时与历史收款总量无关。同一 hash 出现多条记录时只让该订单返回 `PAYMENT_MISMATCH`，不影响其他订单。SDK 网络同步与这里的查询是两层不同的工作；同步故障或查询故障不会把订单标成支付失败。

Worker 先在一个事务里读取商户、按幂等键查已有订单并读取入库报价；算出 sats 后，在商户行锁和全局准入锁下检查启用状态与准入，插入 `status='creating'` 的占位订单（无 invoice，不对外可见），再向钱包申请 invoice，成功后写入 invoice 变为 `pending`。开票失败时删除占位，同一幂等键可重试；请求中途死亡留下的占位超过 30 秒（大于钱包调用的 15 秒超时）即视为遗弃：同键请求可以接管，定时任务也会删除它；原请求若之后醒来，无法再挂上发票。下单流程全部在 `payments/intake.ts`（Order intake）中。占位后才开票，所以并发请求既不能超过准入速率，也不会为同一幂等键开出第二张 invoice。每次创建成功输出一条 `order_created` 日志，含总耗时、报价来源 `quote`（`stored` 或 `live`）和 `openMs`、`quoteMs`（仅实时获取时）、`reserveMs`、`invoiceMs`、`storeMs` 分步耗时，不含备注等付款人信息。

Worker Cron 每分钟运行（`* * * * *`），各任务互不影响：

- **到账同步**：按 `wallet_sync_cursor` 记录的时间点调用 `/v1/payments/completed`（回看 10 分钟以覆盖秒级时间戳的边界），按订单幂等入账，然后推进游标。开销只取决于新到账笔数，与未付订单数量无关；钱包或数据库失败时游标不动，下次重读。付款人关闭页面、无人查询的订单也由它入账，最多延迟约 1 分钟。输出 `payments_synced` 日志。
- **清理**：删除超过 30 秒的 `creating` 占位，以及已结束的按邮箱发码计数窗口。
- **报价**（每 5 分钟一次）：获取 Coinbase 现货价写入 `btc_quote` 单行表，旧报价不会覆盖新报价，成功时输出 `quote_refreshed` 日志。下单使用不超过 10 分钟的入库报价；报价缺失、过旧或时间异常时实时获取（同一实例缓存 60 秒），都失败才返回 `QUOTE_UNAVAILABLE`。

本地 `wrangler dev` 不会自动触发 Cron，需要时用 `pnpm --filter @btc-lightning-pay/backend exec wrangler dev --local --test-scheduled --port 8787` 启动，再请求 `http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*`。已展示的 invoice 永不替换。付款页查询（到期 10 分钟内）和管理端订单详情也会即时核对当前订单；查询失败保留订单，后续查询或同步可重试。过期不是不可逆支付终态，晚发现的完成记录仍能入账。生成结算单前不额外同步，最近约 1 分钟内到账的订单可能进入下一张结算单。

## Worker 部署位置与连接池

一次创建订单约有十几次顺序数据库往返，耗时主要取决于 Worker 到业务库的距离。`apps/backend/wrangler.jsonc` 的 `placement.region` 让请求处理固定在业务库所在区域运行，目前是 `aws:ap-south-1`；更换 Supabase 区域时必须同步修改。Placement 只作用于 fetch 请求，Cron 不受影响。`wrangler dev` 仍在本机运行，本地耗时不会因此变化。

**上线前必须启用 Hyperdrive。** 没有它，每个请求都要新建一条到 Supabase 的 TLS 连接，付款页每 3 秒轮询一次，几十个付款人同时在线就可能打满直连数上限。管理端请求的会话校验与业务查询共用同一条连接。Hyperdrive 复用数据库连接，省去每个请求新建连接的耗时。按 [认证接入](auth-setup.md#cloudflare-部署前) 的要求使用 Supabase Direct connection 和 `btc_backend` 账号，并关闭查询缓存（订单和会话都是先写后读）。在自己的终端运行下面的命令，密码只在本地终端输入，不要写进仓库或聊天记录：

```bash
pnpm --filter @btc-lightning-pay/backend exec wrangler hyperdrive create btc-lightning-pay-db --caching-disabled --connection-string="postgres://btc_backend:<密码>@<Direct connection 主机>:5432/postgres?sslmode=require"
```

把输出的 id 填入 `wrangler.jsonc` 中已注释的 `hyperdrive` 绑定并取消注释，然后运行 `pnpm typegen`。启用绑定后，本地 `wrangler dev` 需要设置 `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（与 `DATABASE_URL` 相同）作为本地连接。

## Dokploy / OrbStack

使用 [Compose](../apps/wallet/deploy/compose.yaml)，构建上下文为仓库根目录，Dockerfile 为 `apps/wallet/Dockerfile`。镜像在 Node 构建阶段用 pnpm 冻结安装生产依赖，运行阶段使用固定 `oven/bun:1.4.2-debian` 镜像和非 root 用户。容器仅读取注入的环境变量，不加载 env 文件。保留 Effect Node HTTP 适配器，通过 Bun 的 Node 兼容层运行。

在 Supabase 的 **Connect** 取连接串，将用户名改为 `btc_wallet`，密码使用该账号的 URL 编码密码，保留 `sslmode=require`。优先用 Direct connection，只有 IPv4 时用 Session pooler（5432），用户名为 `btc_wallet.<项目 ref>`。钱包和 Worker 的连接串指向同一个数据库。首次启动前，用钱包连接串执行 `SELECT current_user, current_schema();`，结果应为 `btc_wallet` 和 `breez_wallet`。参考 [Supabase 连接方式](https://supabase.com/docs/guides/database/connecting-to-postgres)。

助记词以文件方式注入：在宿主机上创建只含助记词的文件（权限 0400，属主为容器内 `bun` 用户 uid 1000），把路径填入 `BREEZ_MNEMONIC_SECRET_FILE`，Compose 将其挂载为 `/run/secrets/breez_mnemonic` 并设置 `BREEZ_MNEMONIC_FILE`，`docker inspect` 中看不到助记词。

钱包服务不开放公网端口，经 Cloudflare Tunnel 暴露，并用 Cloudflare Access 保护：

1. 在 Zero Trust 创建 Tunnel（`cloudflared` 与 wallet-service 同一内部网络），公共主机名如 `wallet.<你的域名>` 指向 `http://wallet-service:9741`。
2. 为该主机名创建 Access 应用，策略只允许一个 Service Token（Action 选 Service Auth）。
3. 把该 Service Token 的 ID 和 secret 用 `wrangler secret put` 写入 Worker 的 `WALLET_ACCESS_CLIENT_ID` 与 `WALLET_ACCESS_CLIENT_SECRET`，`WALLET_URL` 设为 `https://wallet.<你的域名>`。`APP_ENV=production` 时缺少这两项，Worker 返回 `WALLET_NOT_CONFIGURED`。

Bearer token 保留为第二层校验，Worker 配置相同的 `WALLET_TOKEN`。保持单副本，更新时先停止旧实例再启动新实例，不采用两个钱包实例重叠运行的滚动发布。SDK 初始化、同步和身份验证完成后才开始监听 HTTP。

`GET /health` 为存活检查，`GET /ready` 检查 SDK 最近三分钟内成功同步且没有同步错误；二者都不保证外部 Lightning 路由一定可用。如果已有钱包数据，切换连接串前先停止钱包实例，备份原库，并在隔离环境验证全部 SDK 表及迁移记录能恢复到 `breez_wallet`，且沿用相同的助记词和钱包身份。确认恢复后再切换，保留原库作为回退。

单独备份 `breez_wallet` 和钱包恢复材料并演练恢复。Supabase 控制台恢复整个数据库会同时回滚 `public` 和 `breez_wallet`。参考 [Supabase 备份与恢复](https://supabase.com/docs/guides/platform/backups)。

## 验证与人工验收

本地自动检查：`pnpm ready`。钱包 runtime 测试由 Vite+ 启动 Bun 子进程，验证共享 API、真实 Breez WASM、公钥推导、HTTP 鉴权以及服务资源释放；不读取真实钱包环境或访问资金。Breez 的官方入口仍为 `/nodejs`，升级 Bun 或 SDK 后需要重新验证，不能仅凭 Node 下的单元测试通过判断兼容。真实 PostgreSQL 并发测试默认跳过，需要设置 `PAYMENT_TEST_DATABASE_URL`，只允许本机独占的空 `payments_test` 数据库。测试会初始化基线和角色，不可指向业务库。`BREEZ_TEST_DATABASE_URL` 可指向独立本地 `wallet_test`，验证真实 SDK PostgreSQL 的初始化、重连和关闭（公开测试助记词、regtest、不交易）。

正式收款前手动完成：主网小额 Cash App 支付并确认 `receivePayment` 的 `fee` 为 0、付款后立即关闭页面并确认定时同步在约 1 分钟内入账、重启后查询、invoice 到期及金额核对。Regtest 无法替代真实 Lightning 验收。人工结算仍仅登记已完成的外部付款；本服务没有转账 API，实际资金转出流程需另行验收。

官方参考：[服务端 Treasury](https://sdk-doc-spark.breez.technology/guide/treasury.html)、[PostgreSQL 存储](https://sdk-doc-spark.breez.technology/guide/customizing.html#with-postgresql-backend)、[收款](https://sdk-doc-spark.breez.technology/guide/receive_payment.html)。
