# 第一阶段后端接入与部署

`apps/backend` 是 Cloudflare Worker 业务后端，`apps/gateway` 是 phoenixd 同机的标准独立后端服务。二者使用共享 Effect HttpApi 契约。Gateway 的 HTTP 层、业务服务、SQLite 持久化、phoenixd/Worker 客户端、配置和启动生命周期分别位于 `app.ts`、`gateway.ts`、`store.ts`、`phoenix.ts`、`config.ts` 和 `server.ts`。

本次只实现本地代码、迁移与部署模板；没有执行远端迁移、服务器部署、转账或真实 Cash App 付款。旧 demo 保留，不删除钱包或 OrbStack 数据卷。第一阶段范围见 [业务方案](backend-phase-one.md)。

## 配置与本地启动

1. 使用 Node.js 26，在仓库根目录执行 `pnpm install --frozen-lockfile`。
2. 按 [认证配置](auth-setup.md) 准备项目数据库和管理员邮箱账号。审查迁移后，用迁移所有者连接执行 `pnpm --filter @btc-lightning-pay/db migrate`。迁移会增加商户、订单和结算表，不删除认证数据。
3. 由数据库所有者执行 [provision-backend-role.sql](../packages/db/sql/provision-backend-role.sql)，安全设置 `btc_backend` 的登录密码。Worker 的 `DATABASE_URL`／Hyperdrive 使用此账号，不能使用超级用户或具有 BYPASSRLS 的账号。SQL 为认证表授予后台所需访问，为支付表保留事务级 RLS；不授予迁移记录表访问或删除支付历史权限。迁移账号保持独立。Hyperdrive 查询缓存必须关闭，避免支付状态和登录状态陈旧。
4. 在已有 `apps/backend/.dev.vars` 中**合并**新增变量，不覆盖现有配置。复制 `apps/gateway/.env.example` 为 `.env` 并填写下表。两个服务间 token 使用不同的随机值，各至少 32 字符，可分别用 `openssl rand -hex 32` 生成。
5. 启动已有 OrbStack phoenixd（见 [demo 文档](phoenixd-demo.md)）；`PHOENIX_HTTP_PASSWORD` 使用其 limited-access 密码。不要复制助记词或完整权限密码到 Worker。
6. 两个终端分别运行 `pnpm dev:backend` 和 `pnpm dev:gateway`。前端需要时再运行 `pnpm dev:frontend`。Gateway 默认只监听 `127.0.0.1:9741`；`GET /health` 是进程存活检查，不证明钱包具备收款流动性。

| 变量                     | 放置位置 | 说明                                                                                         |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------- |
| `PAYMENTS_ADMIN_IDS`     | Worker   | 已预开户用户的数据库 `user.id`，多个以逗号分隔；不填则无人拥有管理权限                       |
| `GATEWAY_URL`            | Worker   | 本地 `http://127.0.0.1:9741`，线上为 Gateway HTTPS origin                                    |
| `GATEWAY_TOKEN`          | 两端     | Worker 调用 Gateway 的 Bearer token                                                          |
| `WORKER_SYNC_TOKEN`      | 两端     | Gateway 回写 Worker 的独立 Bearer token                                                      |
| `WORKER_URL`             | Gateway  | 本地 `http://127.0.0.1:8787`；线上为可达的 Worker HTTPS origin，不能填仅做页面代理的前端域名 |
| `PHOENIX_URL`            | Gateway  | `http://127.0.0.1:9740`，phoenixd 不开放公网                                                 |
| `PHOENIX_HTTP_PASSWORD`  | Gateway  | phoenixd limited-access 密码                                                                 |
| `PHOENIX_WEBHOOK_SECRET` | Gateway  | 可选，需与 phoenixd 相同；为空时 webhook 拒绝请求，后台查询仍运行                            |
| `GATEWAY_DATABASE`       | Gateway  | SQLite 路径，默认 `data/gateway.sqlite`；必须放持久化存储                                    |

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

列表 API 默认 `limit=50&offset=0`，最大 100，offset 最大 100000。订单支持 `merchantId`、`status`、`from`（含）、`to`（不含）；时间用 ISO8601。返回数组，没有总数或游标。订单详情额外返回报价、备注、到账净额 `receivedMsat`、费用 `feeMsat`、到账时间及 `settlementId`；费用单位是 millisatoshi，1 sat = 1000 msat。

`GET /api/admin/merchants/onne/summary` 返回 `merchantId`、`paidSat`、`settledSat`、`unsettledSat`。`paidSat` 是已付款订单的商户应收合计，平台承担的节点成本不从其中扣除；不是钱包可用余额。

人工结算：`POST /api/admin/settlements`，带独立 `Idempotency-Key`，示例：

```json
{
  "merchantId": "onne",
  "orderIds": ["12345678-1234-4234-8234-123456789abc"],
  "amountSat": 15000,
  "proof": "外部转账凭证或记录号"
}
```

每次 1–100 笔同商户的已支付、未结算订单，金额必须等于整笔订单 sats 之和，凭证 1–1000 字符。重复键与相同内容返回原记录；已被其他结算占用则 409。此 API **只登记已在线下完成的转账，不执行转账**。不要在一次外部转账失败后仍登记成功。退款不在本阶段范围内。

业务错误返回 `{ "code": "...", "message": "..." }`；Schema 输入校验的 400 使用 Effect 的校验错误结构，前端按 HTTP 状态显示输入错误，不解析内部校验文本。

| HTTP      | 常见 code / 含义                                                                      |
| --------- | ------------------------------------------------------------------------------------- |
| 400       | 输入不合法、`INVALID_PAGINATION`、`DUPLICATE_ORDER`、`BODY_TOO_LARGE`                 |
| 401 / 403 | 未登录、`ADMIN_REQUIRED`、`ORIGIN_REJECTED`                                           |
| 404       | `MERCHANT_NOT_FOUND`、`ORDER_NOT_FOUND`                                               |
| 409       | `IDEMPOTENCY_CONFLICT`、`MERCHANT_DISABLED`、`MERCHANT_EXISTS`、`SETTLEMENT_CONFLICT` |
| 429       | `RATE_LIMITED`：每商户每秒最多 5 个新订单；重试使用原幂等键                           |
| 503       | `QUOTE_UNAVAILABLE`、配置缺失或服务故障；不展示为支付失败                             |

## 持久化与恢复

Worker 先写业务订单，Gateway 先持久化订单执行占位，再调用不具备幂等性的 phoenixd `/createinvoice`。相同订单号只尝试一次创建；之后以 `externalId` 查询原结果。Worker 每分钟 Cron 补查最多 50 笔 `creating` 订单，按上次尝试时间轮转。Gateway 每轮取最多 100 个到期任务，完成后等 10 秒继续；支付未过期时持续查，过期后每小时查以补晚到账。查询失败延后重试，重复同步不会重复计账。健康检查不会扫描所有历史订单。

Gateway 查询真实 phoenixd 数据后以 `WORKER_SYNC_TOKEN` 回写 `/api/internal/payments/sync`。webhook 是加速提示：验证原始 body 的 `X-Phoenix-Signature` HMAC-SHA256 十六进制签名，再查询真实数据，不用事件里的金额直接入账。没有 webhook 也会轮询恢复。到期高峰或大量积压时，查询延迟可能超过 10 秒，需要观察积压与完成时间。

创建调用超时、连接失败或进程在占位后崩溃时，可能留下长期 `creating`。管理员用订单 ID 对照 Gateway 执行日志和 phoenixd 的 `externalId` 查询人工核实；不要删除占位、换订单号自动重试或把它直接标记未支付。若查到原 invoice，后续轮询自动恢复；若始终没有 invoice，当前版本保留待确认，不提供强制重开接口。

Gateway 仅单实例运行，SQLite 不跨服务器共享。正常停机先停止接新请求／后台任务并等待当前任务结束，再关闭数据库。需要备份两个不同的数据集：phoenixd 钱包目录，以及 Gateway SQLite（含 WAL，使用一致性备份或停服务后复制）。业务 PostgreSQL 也应按托管方方案备份。仅恢复钱包、丢失执行日志可能破坏开票幂等保障，不能直接恢复服务接流量。

## 北美部署模板与人工步骤

提供 [systemd unit](../apps/gateway/deploy/gateway.service) 和 [Caddy 入口模板](../apps/gateway/deploy/Caddyfile)。选择北美 Linux 主机后，安装 Node 26、固定版本 pnpm 与依赖，放置仓库到 `/opt/btc-lightning-pay`，创建无特权 `btc-pay` 用户。将 Gateway 变量安全写入 `/etc/btc-lightning-pay/gateway.env`，替换实际域名、Node 可执行文件路径，按模板配置服务。SQLite 放在 systemd 管理的 `/var/lib/btc-lightning-pay`。不在环境文件中使用开发 `.dev.vars` 的所有者数据库密码。

Caddy 只向 Gateway 转发 `/v1/invoices`；认证由业务服务验证。webhook 和健康检查留在本机，phoenixd 的 9740 与 Gateway 的 9741 均不开放公网。Worker 配置 HTTPS `GATEWAY_URL`，Gateway 配置可访问的 Worker URL 和两端匹配的独立密钥。默认模板不要求额外购买或配置 Cloudflare Access。

模板依据：[Caddy 路由匹配](https://caddyserver.com/docs/caddyfile/directives/handle)、[systemd 运行环境与持久化目录](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)。这些 Linux 部署模板仍需在选定服务器上验证；本地进程测试使用 macOS Node 运行时。

phoenixd 的主网版本仍使用现有固定镜像。真实收款前须由用户确认通道／流动性费用预算、备份助记词，以及钱包实际可收款。手续费额度应保持关闭（`--max-fee-credit=off`），否则付款可能只形成费用额度而没有符合当前记账模型的净收款；demo 的 `--auto-liquidity=off` 不能直接当作生产接款配置。如何充值或启用流动性，待部署与费用预算另行确认。

Cloudflare 上先迁移数据库、配置运行角色及 secrets，再部署 Worker 与 Cron；Gateway 启动前先配置 phoenixd 和持久化目录。上线前按预计峰值做负载验证并配置 Cloudflare 入口防滥用规则：当前内建的是每商户限流，不是全站／每 IP 防刷或容量承诺。最后由用户用真实 Cash App 完成一笔经确认金额的付款，核对净到账、费用、订单归属和页面成功状态。

本阶段没有删除旧 demo；生产保持 `APP_ENV=production`，旧开票接口会拒绝使用开发直连凭证的模式。没有实现退款、自动提现、商户后台、多钱包或自动扩容。
