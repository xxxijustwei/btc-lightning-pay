# Breez Spark 后端接入与部署

`apps/backend` 是 Cloudflare Worker 业务后端，`apps/wallet` 是北美 Node.js 26 钱包服务（wallet-service）。钱包服务直接运行 `@breeztech/breez-sdk-spark` 0.28.4，平台控制一个主网 Spark 钱包；商户、订单和结算由 Worker 管理。用户前端不加载 SDK、不接触钱包密钥。

## 本地初始化

1. `pnpm install --frozen-lockfile`。SDK 的可选 SQLite 构建被禁用，实际使用 PostgreSQL。
2. 准备两个独立 PostgreSQL 数据库和账号：业务数据库，以及 SDK 专用数据库。不要让 SDK 使用业务数据库；业务账号配置见 [认证配置](auth-setup.md)。
3. 在 `packages/db/.env` 配置所有者连接 `DATABASE_ADMIN_URL`，执行 `pnpm --filter @btc-lightning-pay/db run init`，然后由所有者执行 `packages/db/sql/provision-backend-role.sql` 并安全设置账号密码。Worker 使用受限 `btc_backend` 账号。
4. 当前为 greenfield：只维护 `packages/db/sql/schema.sql` 全新建库基线，不维护历史升级。`init` 只用于空数据库，已存在表时会失败并回滚，不自动删除数据。模型变更后执行 `pnpm --filter @btc-lightning-pay/db generate` 重新生成基线。需要重置时删除并重建明确指定的开发业务数据库，然后重新 init 和预开户；不要重置 SDK 钱包库。
5. 安全生成并备份一套新的 BIP39 助记词，将 `apps/wallet/.env.example` 复制为 `.env` 后填写。助记词不应来自文档示例、聊天或代码仓库。执行 `pnpm --filter @btc-lightning-pay/wallet identity` 离线导出公钥，将输出填入 `BREEZ_IDENTITY_PUBKEY`；服务启动会校验该身份，配置错误时拒绝启动。
6. 在 Worker `.dev.vars` 中合并下表配置；不要覆盖已有认证配置。分别执行 `pnpm dev:wallet` 和 `pnpm dev:backend`。默认钱包入口为 `127.0.0.1:9741`。

| 变量                          | 位置     | 用途                                            |
| ----------------------------- | -------- | ----------------------------------------------- |
| `PAYMENTS_ADMIN_IDS`          | Worker   | 已预开户管理员的 user.id 白名单                 |
| `WALLET_URL`                  | Worker   | 本地 HTTP loopback 或生产 HTTPS 钱包服务 origin |
| `WALLET_TOKEN`                | 两端     | 至少 32 字符的随机服务间 Bearer token           |
| `BREEZ_API_KEY`               | 钱包服务 | Breez 接入凭证                                  |
| `BREEZ_MNEMONIC`              | 钱包服务 | 平台钱包助记词，具有签名能力                    |
| `BREEZ_IDENTITY_PUBKEY`       | 钱包服务 | 预期的钱包身份公钥                              |
| `BREEZ_DATABASE_URL`          | 钱包服务 | SDK 专用 PostgreSQL；远端连接配置验证证书的 TLS |
| `WALLET_HOST` / `WALLET_PORT` | 钱包服务 | 默认 127.0.0.1 / 9741                           |

平台不向商户扣收款手续费，订单 API 和数据库均没有费用字段。商户应收为固定 `amountSat`；`receivedMsat` 直接来自 SDK 收款金额乘 1000。当前只确认完成且到账金额等于 invoice 金额的支付，异常金额保留待核对，不能猜测成功。钱包操作仍可能有底层费用，但不进入订单结算计算。

## 给 Claude 的接口约定

共享 Schema 从 `@btc-lightning-pay/api` 导入；完整路径和字段位于 [payments.ts](../packages/api/src/payments.ts)。前端添加同源 `/api/public/*` 与 `/api/admin/*` 代理，复用 `proxyBackendRequest` 和 `BACKEND` binding；不要代理 `/api/internal/*`，不要把 Wallet token 暴露给浏览器。管理员写请求必须保留 `Origin`，且与 `BETTER_AUTH_URL` 精确相同；管理接口同时要求真实会话和管理员 ID 白名单。

创建商户：`POST /api/admin/merchants`，JSON `{"id":"onne"}`。商户 ID 为 3–32 位小写字母、数字或连字符，必须字母开头，创建后不能修改或删除。`PATCH /api/admin/merchants/onne` 的 `{"enabled":false}` 只阻止新订单。

公开读取 `GET /api/public/merchants/onne` 返回：

```json
{
  "merchantId": "onne",
  "enabled": true,
  "currency": "USD",
  "minAmountUsdCents": 1000,
  "maxAmountUsdCents": 30000
}
```

创建订单：`POST /api/public/merchants/onne/orders`，`Idempotency-Key` 使用一次用户提交产生的 UUID，重试复用该值；请求体为 `{"amountUsdCents":1500,"reference":"可选订单号"}`。金额以整数美分传输，范围 1000–30000。备注最多 128 字符。行情为 100000 USD/BTC 时的示例响应：

```json
{
  "id": "12345678-1234-4234-8234-123456789abc",
  "merchantId": "onne",
  "amountUsdCents": 1500,
  "amountSat": 15000,
  "status": "creating",
  "invoice": null,
  "expiresAt": null,
  "serverTime": "2026-11-17T12:00:00.000Z"
}
```

HTTP 200 表示业务订单已经持久化，状态可能是 `creating`，不代表已经拿到 invoice。若开票成功，返回 `pending` 和完整 BOLT11、到期时间；否则查询同一订单。前端路由建议 `/pay/invoice/:id`，每 3 秒调用 `GET /api/public/orders/:id`，页面不可见时放缓；失败退避，不把网络失败画成未支付或已过期。用 `serverTime` 校正倒计时，只有后端 `paid` 才显示成功。`expired` 后仅由用户主动新建订单，使用新幂等键。`failed` 为预留终态，目前不自动把超时判定为失败。

`invoice` 和 `expiresAt` 在 `creating` 时为空。公开响应不包含备注、payment hash、费用或结算信息；链接持有者可以查看本笔付款信息，不可列出商户历史。支付状态说明见 [方案](backend-phase-one.md)。Cash App 入口按参考页使用 `https://cash.app/launch/lightning/{invoice}`；这一跳转仍待真机验证。

商户和订单列表 API 默认 `limit=50&offset=0`，最大 100，offset 最大 100000。订单支持 `merchantId`、`status`、`from`（含）、`to`（不含）；时间用 ISO8601。返回数组，没有总数或游标。订单详情额外返回报价、备注、实际到账金额 `receivedMsat`、到账时间及 `settlementId`、`settlementStatus`；到账金额单位是 millisatoshi，1 sat = 1000 msat。

`GET /api/admin/merchants/onne/summary` 返回 `merchantId` 和以下口径（金额单位 sats）：

| 字段                     | 含义                                                                              |
| ------------------------ | --------------------------------------------------------------------------------- |
| `paidSat`                | 全部已确认支付订单的商户应付                                                      |
| `settledSat`             | 已确认结算完成的金额                                                              |
| `unsettledSat`           | 未结清金额，包括待付款批次                                                        |
| `pendingSettlementSat`   | 已生成结算单、尚未确认付款的占用金额                                              |
| `availableSettlementSat` | 未被批次占用，可以生成新结算单的金额                                              |
| `unconfirmedOrderCount`  | creating/pending 订单数量，包含到期后尚未确认付款的订单；不代表这些订单实际已付款 |

恒等式：`unsettledSat = paidSat - settledSat`，`availableSettlementSat = unsettledSat - pendingSettlementSat`。这些数值不是钱包可用余额，平台节点成本不从商户应付扣除。

### 结算单接口

流程：生成固定结算单 → 平台人工转账 → 填写凭证确认完成。服务端不执行转账。同商户允许多张互不重叠的待付款单，同一天可以多次结算。

```http
POST /api/admin/settlements
Idempotency-Key: 8b562e87-a348-4e04-9705-3c09b4ea7195
Content-Type: application/json

{"merchantId":"onne"}
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

| HTTP      | 常见 code / 含义                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | 输入不合法、`INVALID_PAGINATION`、`DUPLICATE_ORDER`、`BODY_TOO_LARGE`                                                                                                        |
| 401 / 403 | 未登录、`ADMIN_REQUIRED`、`ORIGIN_REJECTED`                                                                                                                                  |
| 404       | `MERCHANT_NOT_FOUND`、`ORDER_NOT_FOUND`                                                                                                                                      |
| 409       | `IDEMPOTENCY_CONFLICT`、`MERCHANT_DISABLED`、`MERCHANT_EXISTS`、`NO_ELIGIBLE_ORDERS`、`SETTLEMENT_STATE_CONFLICT`、`SETTLEMENT_PROOF_CONFLICT`、`SETTLEMENT_REASON_CONFLICT` |
| 429       | `RATE_LIMITED`：每商户每秒最多 5 个新订单；重试使用原幂等键                                                                                                                  |
| 503       | `QUOTE_UNAVAILABLE`、配置缺失或服务故障；不展示为支付失败                                                                                                                    |

## 钱包查询与恢复

调用方向为 Worker → wallet-service → SDK。钱包服务不回调 Worker，不写业务库，不开放发送资金接口。SDK 使用 Treasury 配置：一个长期实例、后台同步开启、60 秒同步周期、关闭跨设备同步、关闭 Spark 直接支付偏好，保持默认退出恢复数据采集。

两个业务接口均要求 `Authorization: Bearer <WALLET_TOKEN>`：

- `POST /v1/invoices`：`{orderId, amountSat}`，生成有效期 3600 秒的 BOLT11。
- `POST /v1/payments/query`：`{orderId, amountSat, paymentHash, invoice}`，核对 invoice 的订单说明、网络、金额、hash；只接纳 SDK 已完成的 Lightning 收款记录。

响应为 `{orderId, amountSat, paymentHash, invoice, expiresAt, paidAt, receivedMsat}`。未到账时最后两个字段为 null。SDK 的 payment ID 与 payment hash 不混用。SDK 内部记录的 preimage、费用和钱包密钥不出现在接口或日志中。

钱包服务通过 SDK 分页读取已完成的 BTC 收款，构建内存 hash 索引；并发查询合并，10 秒内复用索引。重启后从 SDK PostgreSQL 重建，不依赖内存保证正确性。当前全量索引的耗时和内存随历史收款增长；接近 100,000 笔历史收款前需压测并改成持久化增量索引。SDK 网络同步与该本地索引刷新是两层不同的工作；同步故障或查询故障不会自动把订单标成支付失败。

Worker 先保存订单报价，再创建和保存 invoice。已展示的 invoice 永不替换。未保存、未展示的开票结果丢失时允许重试，接受遗留未使用 invoice。页面查询刷新当前订单；每分钟 Cron 认领最多 500 笔到期任务，以最多 10 个并发补查。普通订单间隔至少一分钟，过期订单间隔十五分钟；失败保留订单，后续重试。过期不是不可逆支付终态，晚发现的完成记录仍能入账。

## Dokploy / OrbStack

使用 [Compose](../apps/wallet/deploy/compose.yaml)，构建上下文为仓库根目录，Dockerfile 为 `apps/wallet/Dockerfile`。只有 wallet-service 容器；SDK 数据库可使用 Dokploy 管理的 PostgreSQL 中的独立库。通过内部网络连接数据库，数据库不需要公网入口。

生产在 Dokploy Domains 中将 HTTPS 域名路由到 wallet-service 的 9741 端口。Worker 配置相同 token 和对应 origin。保持单副本，更新时先停止旧实例再启动新实例，不采用两个钱包实例重叠运行的滚动发布。SDK 初始化、同步和身份验证完成后才开始监听 HTTP。

`GET /health` 为存活检查，`GET /ready` 检查 SDK 最近三分钟内成功同步且没有同步错误；二者都不保证外部 Lightning 路由一定可用。SDK 数据库与钱包恢复材料均需独立备份并演练恢复。删除容器不会清空 PostgreSQL，但误改助记词、数据库或删除钱包库可能破坏钱包恢复能力。业务数据库可重置不意味着钱包数据库可随意重置。

## 验证与人工验收

本地自动检查：`pnpm ready`。真实 PostgreSQL 并发测试需要设置 `PAYMENT_TEST_DATABASE_URL`，只允许本机独占的空 `payments_test` 数据库。测试会初始化基线和角色，不可指向业务库。`BREEZ_TEST_DATABASE_URL` 可指向独立本地 `wallet_test`，验证真实 SDK PostgreSQL 的初始化、重连和关闭（公开测试助记词、regtest、不交易）。

正式收款前手动完成：主网小额 Cash App 支付、页面关闭后的补记、重启恢复、invoice 到期及金额核对。Regtest 无法替代真实 Lightning 验收。人工结算仍仅登记已完成的外部付款；本服务没有转账 API，实际资金转出流程需另行验收。

官方参考：[服务端 Treasury](https://sdk-doc-spark.breez.technology/guide/treasury.html)、[PostgreSQL 存储](https://sdk-doc-spark.breez.technology/guide/customizing.html#with-postgresql-backend)、[收款](https://sdk-doc-spark.breez.technology/guide/receive_payment.html)。
