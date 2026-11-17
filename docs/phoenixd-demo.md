# 本地 Invoice Demo（OrbStack）

范围：主网 BOLT11 invoice 创建、二维码、复制。公开页面 `/demo` 不依赖登录、数据库或邮件配置；原首页与认证功能保留。所有操作者共用一个本地 phoenixd 钱包，不提供用户钱包、订单、支付状态、充值或提现。

## 部署与启动

在 Mac 上启动 OrbStack，在仓库根目录执行：

```sh
docker --context orbstack compose up -d
docker --context orbstack compose logs --tail 30 phoenixd
```

`compose.yaml` 使用官方 `acinq/phoenixd:0.9.3`，以 digest 固定镜像，支持本机 ARM64。官方镜像启动入口会自动确认 phoenixd 的首次启动提示。新钱包由 phoenixd 生成，保存在独立命名卷 `btc-lightning-pay-demo_phoenixd-data`，不使用已有手机钱包的助记词。

容器内部监听 `0.0.0.0:9740`，宿主机只发布 `127.0.0.1:9740`。前后端在宿主机运行，无需把它们容器化，也无需 Cloudflare 部署或隧道。启动需要能连接 ACINQ 和 Electrum；等待日志显示 `listening on http://0.0.0.0:9740`。

仅开票模式明确设置 `--auto-liquidity=off --max-fee-credit=off`，不购买入站流动性，也不累积手续费额度。**请勿向此演示钱包付款**；关闭这些选项不等于测试网，也不保证一个已有通道的钱包不能收款。

## 你需要手动处理的内容

1. 备份自己的助记词。只在自己的终端查看，不发送到聊天、不提交 Git，不与其他 Phoenix 实例共用：

   ```sh
   docker --context orbstack compose exec phoenixd cat /phoenix/.phoenix/seed.dat
   ```

2. 将受限 API 密码填到 `apps/backend/.dev.vars`（已有文件只增加该字段，不覆盖认证配置）：

   ```sh
   docker --context orbstack compose exec phoenixd sh -c 'sed -n "s/^http-password-limited-access=//p" /phoenix/.phoenix/phoenix.conf'
   ```

   ```dotenv
   APP_ENV="development"
   PHOENIX_HTTP_PASSWORD="填入上一步的受限密码"
   ```

   本次部署已自动写入受限密码，不需要重复填写。配置文件已被 Git 忽略。不要使用完整权限密码，也不要放到 `VITE_` 变量中。修改后重启后端。

3. 启动应用并打开页面：

   ```sh
   pnpm dev
   ```

   打开 <http://127.0.0.1:3000/demo>。输入 1–1,000,000 的整数 sats 和 1–128 字的描述，点击「创建 Invoice」。无需登录、准备余额或扫码支付。

## 验收与实现边界

- `POST /api/invoices` → 前端服务绑定代理 → 后端 Effect API → phoenixd `POST /createinvoice`。
- 后端使用 HTTP Basic 受限密码、form-urlencoded 参数、固定 3600 秒有效期，并校验返回金额、paymentHash 和主网 invoice 格式。
- 返回真实 `lnbc…` 字符串和二维码，复制内容与 invoice 一致；这只证明开票成功，不表示到账。
- 不自动重试创建操作。超时可能意味着节点已生成 invoice，但应用未收到响应；再次点击会创建另一张 invoice。
- 开票接口仅在 `APP_ENV=development` 且配置密码时工作。此版本无需用户认证，仅用于本机；对外提供服务前需另行设计鉴权和防滥用。
- 应用不持久化订单；刷新页面会清除当前展示，phoenixd 自己的数据仍保存在卷中。

## 停止与恢复

```sh
docker --context orbstack compose stop
docker --context orbstack compose start
```

前后端用终端 `Ctrl-C` 停止。`docker compose down` 保留数据卷；不要执行 `down -v` 或删除 OrbStack 中的钱包卷，否则会丢失钱包运行数据。后续实际收款需要单独确认流动性费用和验收范围。

检查使用根脚本 `pnpm ready`。真实开票可从页面验证；不需要调用付款接口。

参考：[官方 Dockerfile](https://github.com/ACINQ/phoenixd/blob/v0.9.3/.docker/Dockerfile)、[官方 Compose](https://github.com/ACINQ/phoenixd/blob/v0.9.3/.docker/docker-compose.yml)、[API 源码](https://github.com/ACINQ/phoenixd/blob/v0.9.3/src/commonMain/kotlin/fr/acinq/phoenixd/Api.kt)、[启动与流动性配置](https://github.com/ACINQ/phoenixd/blob/v0.9.3/src/commonMain/kotlin/fr/acinq/phoenixd/Phoenixd.kt)。
