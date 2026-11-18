# 数据库与邮箱验证码认证

认证链路已接入前后端：Supabase 托管 PostgreSQL，Drizzle 定义 schema，Better Auth Email OTP + Admin 插件管验证码、会话和角色字段，Resend 发邮件。前端提供简体中文邮箱验证码登录页、同源代理和 SSR 会话守卫，首页需要登录；健康检查 API 仍可独立运行。无需启用 Supabase Auth，也无需 Supabase anon/service-role API key。

## 准备与配置顺序

1. 新建本项目专用的 Supabase 数据库，保存数据库连接串。不要使用 sirens 或其他业务已经使用的数据库：本项目会在 `public` 创建通用名称的认证表。
2. 本地开发可以不填 Resend key：`APP_ENV=development` 且登录 origin 为本机 HTTP 地址时，验证码输出到后端控制台。需要真实投递或准备生产环境时，在 Resend 添加并验证发信域名（按控制台配置 DNS），创建仅发送邮件的 API key，确定发件地址，例如 `BTC Lightning Pay <login@example.com>`。Resend 测试域名只能发往自己的邮箱，正式登录要使用已验证域名。
3. 从仓库根目录复制示例；真实文件均已被 Git 忽略：

   ```sh
   cp packages/db/.env.example packages/db/.env
   cp apps/backend/.dev.vars.example apps/backend/.dev.vars
   ```

4. 填写下面的变量，初始化空业务库，再在 Supabase SQL Editor 预开通首位管理员。

| 文件                     | 变量                 | 内容                                                                                                                              |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/.env`       | `DATABASE_ADMIN_URL` | Supabase Direct connection；本地没有 IPv6 时可用 Session pooler。使用数据库所有者连接，保留 TLS 参数。只用于建库，不放入 Worker。 |
| `apps/backend/.dev.vars` | `DATABASE_URL`       | 本地运行连接串，Direct connection 或 Session pooler；包含 `sslmode=require`。                                                     |
| 同上                     | `BETTER_AUTH_SECRET` | 至少 32 字符的随机值，可用 `openssl rand -base64 32` 生成。生产与开发分开，轮换会影响现有登录。                                   |
| 同上                     | `BETTER_AUTH_URL`    | 唯一受信任的浏览器 origin，不含路径。本地设为 `http://127.0.0.1:3000`，浏览器也使用该地址。生产必须 HTTPS。                       |
| 同上                     | `APP_ENV`            | 本地设为 `development`；生产设为 `production`。未填写时按生产处理。                                                               |
| 同上                     | `RESEND_API_KEY`     | Resend 的邮件发送密钥。本地开发可留空，生产必须填写。                                                                             |
| 同上                     | `AUTH_EMAIL_FROM`    | 已验证域名下的发件地址，可以带显示名称。                                                                                          |

连接串密码里的特殊字符需要 URL 编码。不要把连接串、验证码或密钥放进仓库、日志或 `VITE_` 变量。早期认证 demo 使用数据库所有者连接。启用多商户业务时，应按 [后端部署说明](backend-setup.md) 配置 `btc_backend` 非所有者、非 BYPASSRLS 运行账号，初始化使用所有者连接；超级用户会绕过支付表 RLS。

## 初始化与开户

确认连接的是本项目数据库，在仓库根目录执行：

```sh
pnpm --filter @btc-lightning-pay/db run init
```

初始化只在手动执行时发生，Worker 启动不建表。命令从 `packages/db/.env` 读取所有者连接，在一个事务中执行 `packages/db/sql/schema.sql`。仅支持空数据库，已存在表时失败并回滚。greenfield 阶段重置开发业务数据库后重新初始化和开户，不维护迁移历史。不要重置 SDK 钱包数据库。

在 Supabase SQL Editor 打开 [provision-user.sql](../packages/db/sql/provision-user.sql)，替换首位管理员的邮箱和姓名后执行。SQL 固定创建 `admin` 角色；后续通过管理 API 开通管理员和商户，见 [用户管理](user-management.md)。SQL 会小写并去除邮箱首尾空格，重复执行不修改已有用户。`email_verified` 初始为 false，由首次正确输入验证码后更新。不要在 Supabase Authentication 页面建用户：那会写到 Supabase 自己的 `auth.users`，本项目使用的是 `public."user"`。

表全部在 `public`：`user`、`session`、`account`、`verification`。`account` 是 Better Auth 标准模型，目前不启用密码或第三方登录。认证表启用 RLS，不给 `anon` / `authenticated` 配置访问策略；客户端只通过后端认证 API 访问。Better Auth cookie 也不是 Supabase JWT。

用户只支持禁用和恢复，不提供删除或角色转换。禁用撤销会话，商户同时停止创建新订单；已有 invoice 继续核验入账，历史订单继续结算。最后一位启用管理员不能禁用。角色存于数据库，已移除 `PAYMENTS_ADMIN_IDS` 白名单。

修改 schema 后先生成并审查 SQL，再验证和执行：

```sh
pnpm --filter @btc-lightning-pay/db generate
pnpm test --project backend
```

## 后端接口

Better Auth 的协议由官方库实现，路由层只开放以下能力。自有 `/api/me` 契约在 `packages/api`；认证端点请求校验、cookie 和 CSRF 由 Better Auth 处理。

| 方法 | 路径                                        | 请求/结果                                                                   |
| ---- | ------------------------------------------- | --------------------------------------------------------------------------- |
| POST | `/api/auth/email-otp/send-verification-otp` | `{ "email": "user@example.com", "type": "sign-in" }`                        |
| POST | `/api/auth/sign-in/email-otp`               | `{ "email": "user@example.com", "otp": "六位验证码" }`；成功返回会话 cookie |
| GET  | `/api/auth/get-session`                     | Better Auth 会话数据；仅启用管理员可用，未登录或不可用账号返回 401          |
| POST | `/api/auth/sign-out`                        | 携带 cookie，撤销当前会话                                                   |
| GET  | `/api/me`                                   | 携带 cookie，返回 `id/email/name/image/role`；未登录 401，配置/服务异常 503 |

第一阶段只允许已开通且未禁用的管理员登录。商户账号、禁用账号和未开户邮箱的发送请求都返回相同成功响应，但不发送邮件、不创建账号；后端也在会话创建处拒绝商户和禁用账号，不能绕过前端直接登录。邮件服务明确报错时返回 503；请求被 Resend 接受不代表已投递到收件箱。

验证码为 6 位数字，5 分钟有效，哈希存储，最多 3 次错误尝试，登录成功后失效。应用层请求限流已关闭，发送和验证接口不限制请求频率；邮件供应商和平台自身的配额仍适用。当前 schema 不包含 `rate_limit` 表。

会话 cookie 使用项目独立前缀 `btc-lightning-pay`，避免与其他 localhost 应用的默认 `better-auth` cookie 冲突。更改前缀后旧会话需重新登录，不清除其他项目的 cookie。

会话使用 HttpOnly cookie；HTTPS 下启用 Secure，关闭 cookie 中的会话缓存，身份查询以数据库为准。认证响应 `Cache-Control: no-store`；生产日志只记录故障类别，不记录邮箱、验证码、cookie、数据库连接或供应商原始错误。显式本地开发且未填 Resend key 时，后端控制台会打印登录邮箱和验证码，格式为 `[auth] Local sign-in code for ...`；仍须预开户，验证码有效期和尝试次数限制不变。已配置 Resend 时优先发邮件，投递失败不会改为打印验证码。

本地启动 `pnpm dev:backend` 后，可以用 HTTP 客户端测试。POST 请求需包含与 `BETTER_AUTH_URL` 一致的 `Origin` 和 `Content-Type: application/json`；保留登录响应的所有 `Set-Cookie` 并在后续请求中携带 cookie。不要把验证码或 cookie 放进可分享的命令记录。

## Cloudflare 部署前

本次不创建云资源或部署。部署时设置 `APP_ENV=production`、Resend key 和发件地址，把后端变量配置为 Worker secrets/vars，并将 `BETTER_AUTH_URL` 设为实际浏览器访问的 HTTPS origin。

使用 Hyperdrive 时，连接 Supabase **Direct connection**，不要再套 Supavisor 连接池；认证专用 Hyperdrive 必须关闭查询缓存，否则退出登录后可能读到旧会话。创建资源后在 `apps/backend/wrangler.jsonc` 添加真实绑定，再运行 `pnpm typegen`：

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "实际的 Hyperdrive ID" }]
```

运行时优先使用 `HYPERDRIVE.connectionString`，没有绑定才使用 `DATABASE_URL`。连接按请求创建并由 Effect scope 关闭，不在模块全局共享数据库 socket。`prepare: false` 保持池化连接兼容；`fetch_types: false` 避免启动时额外的类型查询。

前端已通过 `BACKEND` 服务绑定转发 `/api/auth/*` 和 `/api/me`，保留 Origin、客户端 IP 和多条 Set-Cookie。SSR 会话读取只在存在 Better Auth 会话 cookie 时请求后端，并由后端验证；401 表示未登录，服务故障显示错误页并允许重试。登录、退出成功后清除 Query 和路由缓存，身份相关页面及响应禁用缓存。

## 前端登录流程

运行 `pnpm dev`，打开 `http://127.0.0.1:3000`：未登录跳转到 `/sign-in`，已登录访问登录页则返回 `/`。先输入已开通的邮箱，再输入或粘贴六位数字验证码；输满会自动提交，也可以点击按钮。发送完成后可以立即重发或更换邮箱；请求处理中禁用按钮，避免重复提交。

首页保留健康检查，并显示用户信息和退出按钮。退出请求失败时显示错误，保留当前页面和缓存供重试。登录页为居中单卡片：邮箱步骤只有邮箱输入和「发送验证码」；验证码步骤显示「已发送至 当前邮箱，5 分钟内有效」、六格验证码和重新发送。无论邮箱是否已开户，发送结果都相同，不暴露账号是否存在。不提供注册、密码登录或第三方登录。

前端没有 Supabase/Resend 密钥，也无需 `VITE_` API 地址。组件通过 shadcn 官方 CLI 生成到 `packages/ui`，保留现有 preset；页面和登录状态逻辑位于 `apps/frontend/src/modules/auth` 与 `lib/auth`。

## 验证范围

后端测试使用隔离的 PGlite PostgreSQL 执行建库基线和开户 SQL，再通过真实 Better Auth + Drizzle 验证登录、过期、错误次数、验证码复用、退出、用户隔离和 RLS。数据库连接与邮件发送在测试边界替换，不访问真实 Supabase 或 Resend。

前端测试覆盖表单校验、验证码粘贴与重复提交、错误重试、立即重发和更换邮箱、登录/退出缓存处理。SSR 和代理测试在 Node 环境验证会话隔离与多条 cookie 转发；浏览器验证登录页、校验/服务故障反馈和窄屏布局。

本地检查通过后，仍需填写真实环境，执行远端初始化/开户，并检查邮件投递、生产 HTTPS cookie、Hyperdrive 缓存配置和云端网络连接。

参考：[Better Auth Email OTP](https://www.better-auth.com/docs/plugins/email-otp)、[Hyperdrive 连接 Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)、[Hyperdrive 查询缓存](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)、[Resend Node.js](https://resend.com/docs/send-with-nodejs)。
