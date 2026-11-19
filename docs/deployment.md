# 部署指南

生产环境的部署顺序和逐步清单。变量含义、Hyperdrive、钱包恢复等背景见 [后端接入与部署](backend-setup.md) 和 [数据库与认证](auth-setup.md)。

| 组件    | 部署位置                | 入口                                                               |
| ------- | ----------------------- | ------------------------------------------------------------------ |
| 数据库  | Supabase（`us-east-1`） | 仅 backend 与 wallet 连接                                          |
| wallet  | Dokploy Compose         | `https://x-wallet.cashpayment.co`（Tunnel + Access，不开公网端口） |
| backend | Cloudflare Worker       | 无公网地址，仅前端服务绑定可达                                     |
| 管理端  | Cloudflare Worker       | `https://x-admin.cashpayment.co`                                   |
| 付款页  | Cloudflare Worker       | `https://www.cashpayment.co`                                       |

首次部署顺序：Supabase → wallet → Tunnel/Access → backend → 管理端与付款页 → 验收。日常更新顺序：数据库迁移（保持向后兼容）→ wallet → backend → 前端。

域名写在 `apps/frontend/wrangler.jsonc` 和 `apps/pay/wrangler.jsonc` 的 `routes`（`custom_domain`），`wrangler deploy` 会创建 DNS 记录和证书；`cashpayment.co` 需托管在同一个 Cloudflare 账号。`apps/backend/wrangler.jsonc` 的 `placement.region` 必须与 Supabase 区域一致。

## 准备

本地生成并存进密码管理器：

| 值                                | 生成                      | 用于                      |
| --------------------------------- | ------------------------- | ------------------------- |
| `WALLET_TOKEN`                    | `openssl rand -hex 32`    | wallet 与 backend，同一值 |
| `BETTER_AUTH_SECRET`              | `openssl rand -base64 32` | backend                   |
| `btc_backend` / `btc_wallet` 密码 | 密码管理器                | Supabase 与连接串         |
| 助记词                            | 安全生成并离线备份        | wallet File Mount         |

另需：Resend 已验证 `cashpayment.co` 发信域名、Breez API key。

## 1. Supabase

1. 在 `us-east-1` 建项目，关闭 Project Settings → Data API。
2. 本地 `packages/db/.env` 填所有者连接 `DATABASE_ADMIN_URL`，执行 `pnpm --filter @btc-lightning-pay/db run migrate`。
3. SQL Editor 依次执行 `packages/db/sql/provision-backend-role.sql`、`provision-wallet-role.sql`，用 `ALTER ROLE ... PASSWORD` 为 `btc_backend`、`btc_wallet` 设密码，再改好邮箱和姓名执行 `provision-user.sql` 创建首位管理员。
4. 记下两条连接串（密码 URL 编码，保留 `sslmode=require`）：
   - backend（Hyperdrive）：Direct connection，`postgres://btc_backend:<密码>@db.<ref>.supabase.co:5432/postgres?sslmode=require`
   - wallet：服务器只有 IPv4 时用 Session pooler（5432），用户名 `btc_wallet.<ref>`

## 2. Wallet（Dokploy 网页）

1. 本地把助记词临时写入 `apps/wallet/.env` 的 `BREEZ_MNEMONIC`，执行 `pnpm --filter @btc-lightning-pay/wallet identity`（离线），输出即 `BREEZ_IDENTITY_PUBKEY`；随后删除本地助记词。
2. Dokploy 新建 **Compose**：类型 Docker Compose（Stack 不支持 `build`），Provider 选 GitHub 仓库 `main` 分支，Compose Path `apps/wallet/deploy/compose.yaml`。Compose 已加入 Dokploy 自带的外部网络 `dokploy-network`。
3. Advanced → Mounts 新建 **File Mount**，路径 `breez_mnemonic`，内容只有助记词。文件位于 `/etc/dokploy/compose/<appName>/files/breez_mnemonic`（`<appName>` 见服务页）。删除该 Compose 服务会一并删除此文件，所以必须另有离线备份。
   再新建一个 File Mount，路径 `supabase_ca.crt`，内容为 Supabase 控制台 Database Settings → SSL Configuration 下载的根证书。Supabase 用自有 CA 签发数据库证书，SDK 会验证证书链，缺少它会报 `self signed certificate in certificate chain`；不要改用 `sslmode=no-verify`。
4. Environment 填：

   ```text
   WALLET_TOKEN=<准备中生成的值>
   BREEZ_API_KEY=<Breez key>
   BREEZ_IDENTITY_PUBKEY=<第 1 步输出>
   BREEZ_DATABASE_URL=<wallet 连接串>
   BREEZ_MNEMONIC_SECRET_FILE=/etc/dokploy/compose/<appName>/files/breez_mnemonic
   SUPABASE_CA_FILE=/etc/dokploy/compose/<appName>/files/supabase_ca.crt
   ```

5. 不在 Domains 页添加域名：经 Traefik 暴露会让直连服务器 IP 绕过 Access。点 Deploy；SDK 初始化与同步完成后才监听，首次较慢。始终单副本，更新时不让新旧实例重叠。

路径或文件不对时启动直接失败（找不到 secret 文件或 `Unreadable BREEZ_MNEMONIC_FILE`）。

## 3. Cloudflare Tunnel 与 Access

1. Zero Trust → Networks → Connectors → Create a tunnel → Cloudflared，复制 Tunnel Token。
2. Dokploy 新建 **Application**：Provider Docker，镜像 `cloudflare/cloudflared`；Environment `TUNNEL_TOKEN=<token>`；Advanced → Arguments 依次加 `tunnel`、`run`；Deploy，确认 Tunnel 显示 Healthy。
3. Tunnel 添加 Public Hostname：`x-wallet.cashpayment.co`，类型 HTTP，URL `<wallet appName>-wallet-service-1:9741`。
4. Zero Trust → Access → Service Auth 新建 Service Token，记下 Client ID 与 Secret；再为 `x-wallet.cashpayment.co` 建 Access 应用，策略 Action 选 **Service Auth**，只放行该 token。
5. 验证：带 Access 头成功，不带头被拦截。

   ```bash
   curl -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" https://x-wallet.cashpayment.co/ready
   ```

## 4. Backend Worker

首次先执行 `pnpm --filter @btc-lightning-pay/backend exec wrangler login`。

1. 创建 Hyperdrive（关闭缓存），把输出的 id 填入 `apps/backend/wrangler.jsonc` 并取消 `hyperdrive` 注释，执行 `pnpm typegen`：

   ```bash
   pnpm --filter @btc-lightning-pay/backend exec wrangler hyperdrive create btc-lightning-pay-db --caching-disabled --connection-string="postgres://btc_backend:<密码>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
   ```

2. 部署一次以创建 Worker：`pnpm --filter @btc-lightning-pay/backend run deploy`。
3. 写入 secrets（逐个提示输入）：

   ```bash
   cd apps/backend && for k in WALLET_URL WALLET_TOKEN WALLET_ACCESS_CLIENT_ID WALLET_ACCESS_CLIENT_SECRET BETTER_AUTH_URL BETTER_AUTH_SECRET RESEND_API_KEY AUTH_EMAIL_FROM; do pnpm exec wrangler secret put $k; done
   ```

   | Secret                                                    | 值                                            |
   | --------------------------------------------------------- | --------------------------------------------- |
   | `WALLET_URL`                                              | `https://x-wallet.cashpayment.co`             |
   | `WALLET_TOKEN`                                            | 与 wallet 相同                                |
   | `WALLET_ACCESS_CLIENT_ID` / `WALLET_ACCESS_CLIENT_SECRET` | 第 3 步的 Service Token                       |
   | `BETTER_AUTH_URL`                                         | `https://x-admin.cashpayment.co`              |
   | `BETTER_AUTH_SECRET`                                      | 新生成，不沿用开发值                          |
   | `RESEND_API_KEY`                                          | 仅发送权限                                    |
   | `AUTH_EMAIL_FROM`                                         | 如 `BTC Lightning Pay <login@cashpayment.co>` |

`APP_ENV=production` 已在 `vars` 中。secret 保存即生效；cron 每分钟运行，用 `pnpm exec wrangler tail` 查看日志。

## 5. 管理端与付款页

使用 `pnpm --filter <包> run deploy`，不要省略 `run`：`pnpm deploy` 是 pnpm 内置命令。管理端构建时从已提交的 `apps/frontend/.env.production` 读取 `VITE_PAY_ORIGIN=https://www.cashpayment.co`；它是公开值，`.dev.vars` 和 Worker 运行时变量都不会进入构建。

```bash
pnpm --filter @btc-lightning-pay/frontend run deploy
```

```bash
pnpm --filter @btc-lightning-pay/pay run deploy
```

## 6. 上线验收

1. 打开 `https://x-admin.cashpayment.co` 用邮箱验证码登录（验证 Resend、HTTPS cookie、Hyperdrive）。
2. 新建商户，打开 `https://www.cashpayment.co/<slug>` 下单，出现 invoice 即 backend → wallet 链路正常。
3. 主网小额付款：确认 `fee` 为 0；付完立即关页，约 1 分钟内由定时同步入账；Dokploy 重启 wallet 后仍可查询；测一次 invoice 过期。
4. 生成结算单，分别试确认和取消。
5. 正式收款前演练 `breez_wallet` 与助记词的备份恢复。

## 回滚

Worker 在对应 `apps/<名称>` 目录执行 `pnpm exec wrangler rollback`；wallet 在 Dokploy 重新部署上一个提交。数据库迁移不自动回滚，因此迁移必须向后兼容。
