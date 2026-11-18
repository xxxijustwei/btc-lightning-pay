# 用户与商户管理

平台管理端、未来商户管理端是两个独立前端项目，共用一个 Worker 后端。付款前端通过商户专属链接创建订单，不要求付款人登录。第一阶段只实现后端管理能力；商户管理前端、商户登录和商户业务 API 暂不开放。

## 账号模型

仅有 `admin`、`merchant` 两个全局角色。所有管理员权限相同，可开通其他管理员；角色创建后不可转换。使用 Better Auth Admin 插件，不使用 Organization 插件。原生 Admin 插件 HTTP 路由不开放，避免绕过业务约束修改角色、删除账号或 impersonate。

- `user` 保存登录邮箱、角色、禁用状态。邮箱全平台唯一，存储时小写；目前不能改邮箱。
- `merchant` 保存内部 UUID `id`、内部名称 `name`、公开链接 `slug`，通过唯一 `userId` 关联一个商户账号。
- 每个商户只有一个账号。创建商户时在同一事务中创建账号，邮箱已存在就拒绝，不绑定已有账号。slug 重复时整个事务回滚，不残留账号。
- 名称是管理员内部使用的信息，不出现在公开收款接口。允许修改名称，限制为 1–100 字符且不能全为空白。
- slug 为 3–32 位小写字母、数字、连字符，必须字母开头。slug、内部 ID、账号关联均不可修改。不提供删除接口，slug 永久保留，不回收。
- 账号创建后 `emailVerified=false`；不开通密码，不发送开户通知或邀请邮件。

数据库约束限制合法角色、唯一邮箱、唯一 slug 和一对一账号关系；触发器防止角色、邮箱和商户身份字段被改写。管理员创建、禁用、恢复、商户名称变更写入 `admin_audit`，与业务操作同一事务提交，保留操作者、目标、时间和变更内容。运行账号只有审计表 SELECT/INSERT 权限。

## 登录与禁用

第一阶段只有启用的管理员能通过邮箱 OTP 登录。商户和禁用账号请求验证码仍收到通用成功响应，但不会发邮件；即使取得有效验证码，会话创建也会被拒绝。`/api/me` 返回 `id/email/name/image/role`，管理 API 检查数据库身份，不再使用 `PAYMENTS_ADMIN_IDS`。

禁用商户是一项操作：账号 `banned=true`、商户 `enabled=false`、撤销全部会话，在一个事务内完成。两个管理入口调用相同逻辑。恢复时同时恢复账号和收款状态，但商户仍受第一阶段禁止登录的规则约束，不会恢复旧会话。数据库在插入会话时锁定并检查账号，防止并发登录留下禁用后可复用的会话。

禁用后公开商户接口仍返回 `enabled=false`，付款前端据此显示“暂不可用”；创建新订单返回 `409 MERCHANT_DISABLED`。已经创建的订单可按原幂等键重取；已发出的 invoice 不能撤销，继续查询、入账和结算。禁用不删除历史记录。

最后一位启用管理员不能被禁用，返回 `409 LAST_ADMIN`。后台账号写操作通过数据库事务锁串行执行，防止两个管理员同时禁用自己导致无人能登录。管理员有同级权限，也可禁用其他管理员。

## 管理接口（供 Claude 接入）

所有 `/api/admin/*` 需要启用管理员的会话 cookie；写请求的 `Origin` 必须等于 `BETTER_AUTH_URL`。未登录返回 401，无管理权限返回 403。所有响应不缓存。列表默认 `limit=50&offset=0`，limit 最大 100，offset 最大 100000；返回数组。

| 方法与路径                               | 请求                                              | 返回                               |
| ---------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `POST /api/admin/users`                  | `{name,email}`，只创建管理员                      | 用户对象                           |
| `GET /api/admin/users`                   | `role? limit? offset?`，role 为 admin 或 merchant | 用户数组                           |
| `GET /api/admin/users/:userId`           | —                                                 | 用户对象                           |
| `PATCH /api/admin/users/:userId`         | `{banned:true}` 禁用，false 恢复                  | 用户对象；商户账号同时改变收款状态 |
| `POST /api/admin/merchants`              | `{name,email,slug}`                               | 商户对象和已创建的 userId          |
| `GET /api/admin/merchants`               | `limit? offset?`                                  | 商户数组                           |
| `GET /api/admin/merchants/:merchantId`   | —                                                 | 商户对象                           |
| `PATCH /api/admin/merchants/:merchantId` | `{name? ,enabled?}`，至少一项                     | 商户对象；enabled 同步账号禁用状态 |

用户对象：`{id,name,email,role,banned,merchantId,createdAt}`。管理员的 merchantId 为 null。

商户对象：`{id,userId,name,email,slug,enabled,createdAt}`。创建成功返回 HTTP 200。邮箱重复返回 `409 EMAIL_EXISTS`，slug 重复返回 `409 MERCHANT_EXISTS`，不存在的用户/商户返回 404。用户与商户写入契约拒绝额外字段，不能通过提交 role/email/slug 等不允许修改的字段实现变更。

创建商户示例：

```json
{ "name": "Onne 商户", "email": "merchant@example.com", "slug": "onne" }
```

付款前端的 `/onne` 调用 `GET /api/public/merchants/onne`，创建订单调用 `POST /api/public/merchants/onne/orders`。返回的 merchantId 是内部 UUID。管理员查看订单、商户汇总及创建结算单使用这个 UUID，不能把 `onne` 传入 merchantId。

公开商户响应仅含 `merchantId,slug,enabled,currency,minAmountUsdCents,maxAmountUsdCents`，不含姓名、邮箱、userId。公开订单接口和结算流程其余规则见 [后端接入](backend-setup.md)。

当前只配置平台管理端的可信 origin。未来启用独立商户前端时，再加入它的 origin 和对应商户鉴权接口；不能仅开放前端页面就允许商户访问 `/api/admin/*`。

## 开发库初始化与验证

本次是 greenfield 基线变更，不维护旧数据库迁移。已有业务开发库需另行重置为空库后，执行以下顺序；初始化脚本遇到已有表会拒绝执行，不自动删库。**不要重置 Breez SDK 钱包库。**

1. 设置 `packages/db/.env` 中的业务库所有者连接 `DATABASE_ADMIN_URL`。
2. 执行 `pnpm --filter @btc-lightning-pay/db run init`，应用 `sql/schema.sql`。
3. 以数据库所有者执行 `packages/db/sql/provision-backend-role.sql`，配置 btc_backend 密码，并将该账号用于 Worker `DATABASE_URL` / Hyperdrive。
4. 修改 `packages/db/sql/provision-user.sql` 中示例姓名、邮箱，以所有者执行，开通第一位管理员。重复执行不会转换已有账号角色。
5. 删除环境中的旧 `PAYMENTS_ADMIN_IDS` 配置，管理员登录后通过 API 创建其他账号。

Schema 源文件更新后执行 `pnpm --filter @btc-lightning-pay/db generate`；生成器将 Drizzle 表结构与 `sql/invariants.sql` 中的触发器合成单一 `schema.sql`。

`pnpm test --project backend` 覆盖真实 Better Auth + PGlite 的权限、账号开户、重复冲突、禁用会话、公开字段隔离及已有收款/结算回归。设置 `PAYMENT_TEST_DATABASE_URL` 指向空的本地 `payments_test` 库，可额外验证真实 PostgreSQL 多连接并发、最后管理员保护、RLS 和大批量结算。测试拒绝非本地地址及其他库名。测试不会发真实邮件、创建真实 invoice 或执行打款。
