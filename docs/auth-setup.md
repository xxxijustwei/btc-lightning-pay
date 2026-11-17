# 数据库与邮箱验证码认证

认证链路已接入前后端：Supabase 托管 PostgreSQL，Drizzle 管迁移，Better Auth 管验证码和会话，Resend 发邮件。前端提供简体中文邮箱验证码登录页、同源代理和 SSR 会话守卫，首页需要登录；健康检查 API 仍可独立运行。无需启用 Supabase Auth，也无需 Supabase anon/service-role API key。

## 准备与配置顺序

1. 新建本项目专用的 Supabase 数据库，保存数据库连接串。不要使用 sirens 或其他业务已经使用的数据库：本项目会在 `public` 创建通用名称的认证表。
2. 在 Resend 添加并验证发信域名（按控制台配置 DNS），创建仅发送邮件的 API key，确定发件地址，例如 `BTC Lightning Pay <login@example.com>`。Resend 测试域名只能发往自己的邮箱，正式登录要使用已验证域名。
3. 从仓库根目录复制示例；真实文件均已被 Git 忽略：

   ```sh
   cp packages/db/.env.example packages/db/.env
   cp apps/backend/.dev.vars.example apps/backend/.dev.vars
   ```

4. 填写下面的变量，执行迁移，再在 Supabase SQL Editor 预开通用户。

| 文件                     | 变量                     | 内容                                                                                                                              |
| ------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/.env`       | `DATABASE_MIGRATION_URL` | Supabase Direct connection；本地没有 IPv6 时可用 Session pooler。使用数据库所有者连接，保留 TLS 参数。只用于迁移，不放入 Worker。 |
| `apps/backend/.dev.vars` | `DATABASE_URL`           | 本地运行连接串，Direct connection 或 Session pooler；包含 `sslmode=require`。                                                     |
| 同上                     | `BETTER_AUTH_SECRET`     | 至少 32 字符的随机值，可用 `openssl rand -base64 32` 生成。生产与开发分开，轮换会影响现有登录。                                   |
| 同上                     | `BETTER_AUTH_URL`        | 唯一受信任的浏览器 origin，不含路径。本地设为 `http://127.0.0.1:3000`，浏览器也使用该地址。生产必须 HTTPS。                       |
| 同上                     | `RESEND_API_KEY`         | Resend 的邮件发送密钥。                                                                                                           |
| 同上                     | `AUTH_EMAIL_FROM`        | 已验证域名下的发件地址，可以带显示名称。                                                                                          |

连接串密码里的特殊字符需要 URL 编码。不要把连接串、验证码或密钥放进仓库、日志或 `VITE_` 变量。当前运行连接使用 Supabase 数据库所有者，RLS 保护的是 Data API 的非所有者角色；这个服务端连接具有较高权限，不能交给客户端。

## 迁移与开户

确认连接的是本项目数据库，在仓库根目录执行：

```sh
pnpm --filter @btc-lightning-pay/db migrate
```

迁移只在手动执行时发生，Worker 启动不自动迁移。Drizzle 从 `packages/db/.env` 读取连接，迁移历史位于 `public.__btc_lightning_pay_migrations`。SQL 在事务内应用，带锁等待及语句超时；已应用的迁移保持不变，后续变更新增迁移。首次建库回退会丢失认证数据；有数据后通过修复迁移处理，不直接删表。

在 Supabase SQL Editor 打开 [provision-user.sql](../packages/db/sql/provision-user.sql)，替换邮箱和姓名后执行。SQL 会小写并去除邮箱首尾空格，重复执行不修改已有用户。`email_verified` 初始为 false，由首次正确输入验证码后更新。不要在 Supabase Authentication 页面建用户：那会写到 Supabase 自己的 `auth.users`，本项目使用的是 `public."user"`。

表全部在 `public`：`user`、`session`、`account`、`verification`、`rate_limit`，以及迁移记录表。`account` 是 Better Auth 标准模型，目前不启用密码或第三方登录。认证表及迁移记录启用 RLS，不给 `anon` / `authenticated` 配置访问策略；客户端只通过后端认证 API 访问。Better Auth cookie 也不是 Supabase JWT。

删除 `public."user"` 中的某个用户会级联删除该用户的会话和关联账号，从而撤销登录权限；再次访问 `/api/me` 返回 401。这是删除操作，不是临时停用功能。

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
| GET  | `/api/auth/get-session`                     | Better Auth 原生会话接口                                                    |
| POST | `/api/auth/sign-out`                        | 携带 cookie，撤销当前会话                                                   |
| GET  | `/api/me`                                   | 携带 cookie，返回 `id/email/name/image`；未登录 401，配置/服务异常 503      |

只允许预开户用户登录。未开户邮箱的发送请求也返回相同成功响应，但不发送邮件、不创建账号。邮件服务明确报错时返回 503；请求被 Resend 接受不代表已投递到收件箱。

验证码为 6 位数字，5 分钟有效，哈希存储，最多 3 次错误尝试，登录成功后失效。数据库持久化 IP 限流：发送每 60 秒 1 次，验证每 60 秒最多 5 次；Cloudflare 生产环境使用其提供的 `CF-Connecting-IP`。应用限流是登录防护的一层，不能替代平台级恶意流量防护。

会话使用 HttpOnly cookie；HTTPS 下启用 Secure，关闭 cookie 中的会话缓存，身份查询以数据库为准。认证响应 `Cache-Control: no-store`；日志只记录故障类别，不记录邮箱、验证码、cookie、数据库连接或供应商原始错误。

本地启动 `pnpm dev:backend` 后，可以用 HTTP 客户端测试。POST 请求需包含与 `BETTER_AUTH_URL` 一致的 `Origin` 和 `Content-Type: application/json`；保留登录响应的所有 `Set-Cookie` 并在后续请求中携带 cookie。不要把验证码或 cookie 放进可分享的命令记录。

## Cloudflare 部署前

本次不创建云资源或部署。部署时把后端变量配置为 Worker secrets/vars，并将 `BETTER_AUTH_URL` 设为实际浏览器访问的 HTTPS origin。

使用 Hyperdrive 时，连接 Supabase **Direct connection**，不要再套 Supavisor 连接池；认证专用 Hyperdrive 必须关闭查询缓存，否则退出登录后可能读到旧会话。创建资源后在 `apps/backend/wrangler.jsonc` 添加真实绑定，再运行 `pnpm typegen`：

```jsonc
"hyperdrive": [{ "binding": "HYPERDRIVE", "id": "实际的 Hyperdrive ID" }]
```

运行时优先使用 `HYPERDRIVE.connectionString`，没有绑定才使用 `DATABASE_URL`。连接按请求创建并由 Effect scope 关闭，不在模块全局共享数据库 socket。`prepare: false` 保持池化连接兼容；`fetch_types: false` 避免启动时额外的类型查询。

前端已通过 `BACKEND` 服务绑定转发 `/api/auth/*` 和 `/api/me`，保留 Origin、客户端 IP 和多条 Set-Cookie。SSR 会话读取只在存在 Better Auth 会话 cookie 时请求后端，并由后端验证；401 表示未登录，服务故障显示错误页并允许重试。登录、退出成功后清除 Query 和路由缓存，身份相关页面及响应禁用缓存。

## 前端登录流程

运行 `pnpm dev`，打开 `http://127.0.0.1:3000`：未登录跳转到 `/sign-in`，已登录访问登录页则返回 `/`。先输入已开通的邮箱，再输入或粘贴六位数字验证码；输满会自动提交，也可以点击按钮。验证码发送后等待 60 秒才能重发，更换邮箱不会绕过冷却，刷新后仍由后端限流兜底。

首页保留健康检查，并显示用户信息和退出按钮。退出请求失败时显示错误，保留当前页面和缓存供重试。登录页只说明已开户邮箱会收到邮件，不暴露账号是否存在。不提供注册、密码登录或第三方登录。

前端没有 Supabase/Resend 密钥，也无需 `VITE_` API 地址。组件通过 shadcn 官方 CLI 生成到 `packages/ui`，保留现有 preset；页面和登录状态逻辑位于 `apps/frontend/src/modules/auth` 与 `lib/auth`。

## 验证范围

后端测试使用隔离的 PGlite PostgreSQL 执行仓库迁移和开户 SQL，再通过真实 Better Auth + Drizzle 验证登录、过期、错误次数、验证码复用、退出、用户隔离和 RLS。数据库连接与邮件发送在测试边界替换，不访问真实 Supabase 或 Resend。

前端测试覆盖表单校验、验证码粘贴与重复提交、错误重试、重发冷却、登录/退出缓存处理。SSR 和代理测试在 Node 环境验证会话隔离与多条 cookie 转发；浏览器验证登录页、校验/服务故障反馈和窄屏布局。

本地检查通过后，仍需填写真实环境，执行远端迁移/开户，并检查邮件投递、生产 HTTPS cookie、Hyperdrive 缓存配置和云端网络连接。

参考：[Better Auth Email OTP](https://www.better-auth.com/docs/plugins/email-otp)、[Drizzle 迁移](https://orm.drizzle.team/docs/migrations)、[Hyperdrive 连接 Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)、[Hyperdrive 查询缓存](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)、[Resend Node.js](https://resend.com/docs/send-with-nodejs)。
