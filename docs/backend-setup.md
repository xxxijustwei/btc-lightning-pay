# 第一阶段后端接入与部署

`apps/backend` 是 Cloudflare Worker 业务后端，`apps/gateway` 是 phoenixd 同机的标准独立后端服务。二者使用共享 Effect HttpApi 契约。Gateway 的 HTTP 层、业务服务、phoenixd 客户端、配置和启动生命周期分别位于 `app.ts`、`gateway.ts`、`phoenix.ts`、`config.ts` 和 `server.ts`。

本次只实现本地代码、迁移与部署模板；没有执行远端迁移、服务器部署、转账或真实 Cash App 付款。旧 demo 保留，不删除钱包或 OrbStack 数据卷。第一阶段范围见 [业务方案](backend-phase-one.md)。

## 配置与本地启动

1. 使用 Node.js 26，在仓库根目录执行 `pnpm install --frozen-lockfile`。
2. 按 [认证配置](auth-setup.md) 准备项目数据库和管理员邮箱账号。审查迁移后，用迁移所有者连接执行 `pnpm --filter @btc-lightning-pay/db migrate`。迁移会增加商户、订单和结算表，不删除认证数据。
3. 由数据库所有者执行 [provision-backend-role.sql](../packages/db/sql/provision-backend-role.sql)，安全设置 `btc_backend` 的登录密码。Worker 的 `DATABASE_URL`／Hyperdrive 使用此账号，不能使用超级用户或具有 BYPASSRLS 的账号。SQL 为认证表授予后台所需访问，为支付表保留事务级 RLS；不授予迁移记录表访问或删除支付历史权限。迁移账号保持独立。Hyperdrive 查询缓存必须关闭，避免支付状态和登录状态陈旧。
4. 在已有 `apps/backend/.dev.vars` 中**合并**新增变量，不覆盖现有配置。复制 `apps/gateway/.env.example` 为 `.env` 并填写下表。服务间 `GATEWAY_TOKEN` 至少 32 字符，可用 `openssl rand -hex 32` 生成。
5. 启动已有 OrbStack phoenixd（见 [demo 文档](phoenixd-demo.md)）；`PHOENIX_HTTP_PASSWORD` 使用其 limited-access 密码。不要复制助记词或完整权限密码到 Worker。
6. 两个终端分别运行 `pnpm dev:backend` 和 `pnpm dev:gateway`。前端需要时再运行 `pnpm dev:frontend`。Gateway 默认只监听 `127.0.0.1:9741`；`GET /health` 是进程存活检查，不证明钱包具备收款流动性。

| 变量                    | 放置位置 | 说明                                                                   |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `PAYMENTS_ADMIN_IDS`    | Worker   | 已预开户用户的数据库 `user.id`，多个以逗号分隔；不填则无人拥有管理权限 |
| `GATEWAY_URL`           | Worker   | 本地 `http://127.0.0.1:9741`，线上为 Gateway HTTPS origin              |
| `GATEWAY_TOKEN`         | 两端     | Worker 调用 Gateway 的 Bearer token                                    |
| `PHOENIX_URL`           | Gateway  | `http://127.0.0.1:9740`，phoenixd 不开放公网                           |
| `PHOENIX_HTTP_PASSWORD` | Gateway  | phoenixd limited-access 密码                                           |

URL 配置只接受 origin，不允许路径、用户名、查询参数。除 localhost／127.0.0.1 的本地 HTTP 外须使用 HTTPS。业务端创建订单需要登录配置之外的 Gateway 配置，实际开票采用实时 Coinbase 公共行情；没有行情时返回 503，不悄悄改为固定汇率。测试中的固定行情仅由依赖替换提供。

## 给 Claude 的接口约定

共享 Schema 从 `@btc-lightning-pay/api` 导入；完整路径和字段位于 [payments.ts](../packages/api/src/payments.ts)。前端添加同源 `/api/public/*` 与 `/api/admin/*` 代理，复用 `proxyBackendRequest` 和 `BACKEND` binding；不要代理 `/api/internal/*`，不要把 Gateway token 暴露给浏览器。管理员写请求必须保留 `Origin`，且与 `BETTER_AUTH_URL` 精确相同；管理接口同时要求真实会话和管理员 ID 白名单。

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

商户和订单列表 API 默认 `limit=50&offset=0`，最大 100，offset 最大 100000。订单支持 `merchantId`、`status`、`from`（含）、`to`（不含）；时间用 ISO8601。返回数组，没有总数或游标。订单详情额外返回报价、备注、到账净额 `receivedMsat`、费用 `feeMsat`、到账时间及 `settlementId`、`settlementStatus`；费用单位是 millisatoshi，1 sat = 1000 msat。

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

截止时刻由数据库在生成时取快照，按毫秒记录；包含快照可见且 paidAt 不晚于截止时刻的订单，包括往日积累。之后的新到账、迟到确认不改变本批，顺延下一批。API 返回 UTC ISO8601，前端固定按北京时间 `Asia/Shanghai` 展示；不以午夜自动切账。创建结算单不会同步扫描所有 phoenixd invoice。

业务错误与输入校验错误统一返回 `{ "code": "...", "message": "..." }`。无效 JSON、Schema 输入校验失败返回 400 `INVALID_INPUT`；内部响应编码错误返回 500 `INTERNAL_ERROR`，不暴露原始校验内容。Worker 支付响应和 Gateway 响应带 `X-Request-Id`，可用于关联日志。

| HTTP      | 常见 code / 含义                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | 输入不合法、`INVALID_PAGINATION`、`DUPLICATE_ORDER`、`BODY_TOO_LARGE`                                                                                                        |
| 401 / 403 | 未登录、`ADMIN_REQUIRED`、`ORIGIN_REJECTED`                                                                                                                                  |
| 404       | `MERCHANT_NOT_FOUND`、`ORDER_NOT_FOUND`                                                                                                                                      |
| 409       | `IDEMPOTENCY_CONFLICT`、`MERCHANT_DISABLED`、`MERCHANT_EXISTS`、`NO_ELIGIBLE_ORDERS`、`SETTLEMENT_STATE_CONFLICT`、`SETTLEMENT_PROOF_CONFLICT`、`SETTLEMENT_REASON_CONFLICT` |
| 429       | `RATE_LIMITED`：每商户每秒最多 5 个新订单；重试使用原幂等键                                                                                                                  |
| 503       | `QUOTE_UNAVAILABLE`、配置缺失或服务故障；不展示为支付失败                                                                                                                    |

## 付款查询与恢复

调用方向始终是 Worker → Gateway → phoenixd。Gateway 无数据库、无后台轮询、无 Worker 回调凭证。两个接口均要求 `Authorization: Bearer <GATEWAY_TOKEN>`：`POST /v1/invoices` 接受 `{orderId, amountSat}`；`POST /v1/payments/query` 接受 `{orderId, amountSat, paymentHash}`，查询指定 invoice 并验证订单和金额。旧 webhook 和 Worker `/api/internal/payments/sync` 已移除。

Worker 先保存订单和报价，再在该订单的行锁内创建并保存 invoice；仅此步骤持锁等待上游，超时后释放。已保存的 invoice 永不替换。创建响应丢失、数据库保存失败且 invoice 尚未展示时允许重试创建，接受 phoenixd 留下未使用 invoice。它们不纳入业务订单的付款确认；查询使用已保存的 payment hash，不能假设 externalId 唯一。后端提交成功后才向前端返回 invoice。

公开订单查询会刷新尚未支付订单；已支付订单直接读取数据库。Worker 每分钟 Cron 按上次尝试时间轮转补查最多 50 笔 creating/pending 订单，包括已过期但尚未确认付款的 invoice；页面关闭后仍会更新到账。失败保留原状态，下次查询或 Cron 重试，不把网络失败当作支付失败。积压会增加确认延迟，当前不是高吞吐调度系统。

## Dokploy 部署与人工步骤

服务器侧使用 [Compose](../apps/gateway/deploy/compose.yaml) 与 [Gateway Dockerfile](../apps/gateway/Dockerfile)。Worker 继续部署在 Cloudflare。systemd 和 Caddy 模板已移除。

1. 在 Dokploy 创建 Git 来源的 Docker Compose 项目，选择 `apps/gateway/deploy/compose.yaml`；构建上下文为仓库根目录。
2. 为项目设置随机 `GATEWAY_TOKEN` 和 phoenixd 的 limited-access `PHOENIX_HTTP_PASSWORD`。新钱包应先单独启动 phoenixd，备份助记词，再从其私有配置取得 limited-access 密码；不要把完整权限密码配置给 Gateway。
3. 两个服务走 Compose 内部网络，Gateway 使用 `http://phoenixd:9740`。在 Dokploy Domains 中把 Gateway HTTPS 域名路由至 gateway 服务的 9741 端口。phoenixd 不添加域名、不映射主机端口。Gateway 除公开 health 外，业务接口均鉴权。
4. Worker 配置 HTTPS `GATEWAY_URL` 与相同 `GATEWAY_TOKEN`，配置业务数据库角色、管理员及 Cron 后部署。Gateway 不再需要 Worker 地址或同步 token。
5. `phoenixd-data` 必须持久化并备份。Compose 项目名改变会改变默认卷名，迁移已有钱包时必须显式复用或恢复目标卷，不能误启动成新钱包。不要删除现有 OrbStack demo 卷。Gateway 本身无需数据卷。

模板保留关闭自动流动性与手续费额度的保守配置。真实收款前必须单独确认通道／流动性费用预算、钱包备份及可收款能力，再启用适合生产的流动性配置，并由用户完成一笔确认金额的 Cash App 真机付款。部署模板不是已具备主网收款能力的承诺。

升级时先停旧 Gateway，确认数据库中已展示 invoice 的 payment hash 完整，再切换 Worker 和 Gateway 新接口。现有 Gateway SQLite 文件应保留备份用于核对，但新服务不会打开或删除它；创建结果未展示的历史订单允许重新开票。旧 demo 保留，生产设置 `APP_ENV=production`。

## 后端边界与验证

Worker 的 `app.ts` 只适配 HTTP，`service.ts` 编排报价、订单和开票，`rules.ts` 维护纯业务校验，`store.ts` 负责支付事务，`settlements.ts` 负责结算事务、锁和 SQL，`projection.ts` 生成公开／管理响应。外部报价在事务外获取，进入事务后重新验证幂等键、商户启用状态和限流。业务错误使用类型化错误码，由 HTTP 边界映射状态码。

请求取消时，数据库任务等待当前事务提交／回滚结束后才释放连接；已观察到取消的事务在提交前回滚。取消不撤销已经提交的订单。失败日志保留请求 ID、操作和脱敏上游错误分类，不记录 token、完整 invoice 或上游响应正文。

常规验证使用 `rtk proxy pnpm ready`。真实 PostgreSQL 并发测试默认跳过，显式设置 `PAYMENT_TEST_DATABASE_URL` 后运行：

```sh
rtk proxy env PAYMENT_TEST_DATABASE_URL="$PAYMENT_TEST_DATABASE_URL" pnpm test --project backend apps/backend/src/payments/payments.postgres.test.ts
```

此变量只能指向本机独占的临时 `payments_test` 数据库，使用测试容器的迁移所有者账号；不要填写项目数据库连接。测试执行迁移及角色配置，以三个独立的非所有者 `btc_backend` 连接验证锁竞争、重复下单、结算冲突、事务取消、RLS 作用域复位及报价期间的商户停用。用例只清理自身测试数据，测试完成后由创建者销毁临时容器。

## 结算批次升级（0006）

新增迁移 `0006_slippery_iron_man.sql` 扩展 settlement，新增不可变 settlement_item 明细并 FORCE RLS。旧结算全部迁为 settled，确认人／时间沿用历史登记人／时间，cutoffAt 为 null（显示“历史记录，无截止快照”）。迁移先核对原金额与订单之和，空单或不一致将使事务整体回滚，不自动修账。

部署前备份业务数据库，暂停管理端结算写入并等待旧请求结束；执行迁移后重新运行角色配置 SQL，为新明细表授予 SELECT/INSERT 权限，再同步发布新 Worker 和管理前端。此迁移在一个事务内建索引和回填，会持有表锁；lock_timeout 为 5 秒，statement_timeout 为 60 秒。选择维护窗口。已有大表时应先在副本测量，再拆分为在线索引与分批回填方案，不能将此初期迁移当成零停机迁移。

切换后旧 orderIds/amountSat/proof 创建请求被拒绝；结算列表从数组变成分页对象。新 pending 批次存在后不能直接回退旧 Worker，因为旧版会把占用当作已结算；优先前向修复，不用旧备份覆盖新支付或结算数据。无需迁移 Gateway，也没有钱包交易。

结算操作采用商户级事务锁，锁等待上限 5 秒、单条 SQL 执行上限 15 秒。遇到超时返回可重试的服务错误，事务回滚，不会部分生成。创建成功日志记录批次 ID、笔数和耗时，不记录凭证。完整业务规则见 [结算批次方案](settlement-batches-review.md)。

验证记录（2026-11-18）：本机隔离 PostgreSQL 16、多连接、非所有者角色下，5,000 笔生成约 313 ms，10,000 笔约 438 ms；同时验证取消保留明细、重新生成、确认和竞争回滚。数字仅代表本机此次运行，不是线上延迟承诺。历史迁移通过正确金额升级与错误金额拒绝两种用例。
