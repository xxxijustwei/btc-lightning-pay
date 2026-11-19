# BTC Lightning Pay

Monorepo：两个 TanStack Start 前端（平台管理端、付款页）、Cloudflare Workers 业务后端、独立 Bun 收款后端、共享 API 契约与 shadcn/ui 源码包。当前包含邮箱验证码认证、Breez Spark 平台钱包，以及多商户收款、支付同步和人工结算后端。

用户、商户与两个独立管理前端的边界见 [用户管理](docs/user-management.md)。业务范围见 [第一阶段方案](docs/backend-phase-one.md)，后端配置与 Claude 接入说明见 [后端接入与部署](docs/backend-setup.md)。

钱包服务接入与部署见 [后端说明](docs/backend-setup.md)。旧节点 demo 已移除。

AI 协作约定见 [AGENTS.md](AGENTS.md)，Claude Code 通过 [CLAUDE.md](CLAUDE.md) 引用同一份规则；按任务阅读 `.patterns/` 中的工程规范。Skills 由开发者单独安装和维护。

## 快速开始

使用 Node.js 26（本地验证版本见 `.node-version`）和 pnpm 12.21.0。Wallet 运行时固定为 Bun 1.4.2，需另行安装；pnpm 和其他工具仍使用 Node.js。依赖统一使用 pnpm 安装，不生成 bun.lock。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

如果已有的旧 pnpm 自动切换到 12 时出现 `ENOEXEC`，通过 npm 启动固定版本，无需修改全局安装：

```sh
npx --yes pnpm@12.21.0 install --frozen-lockfile
npx --yes pnpm@12.21.0 dev
```

平台管理端：<http://127.0.0.1:3000>，未登录会进入登录页；完成下方认证配置并以管理员登录后进入商户、订单、结算单和账号页面。付款页：<http://127.0.0.1:3001/onne>（`onne` 换成商户 slug），无需登录。后端地址为 <http://127.0.0.1:8787/api/health>，成功返回 `{"status":"ok"}`。

三个应用都在本地 Workers 运行时运行，无需登录 Cloudflare。也可以分别执行 `pnpm dev:frontend`、`pnpm dev:pay` 和 `pnpm dev:backend`。

开发命令使用 POSIX 环境变量语法，适用于 macOS/Linux；Windows 使用 WSL。两端显式共用项目内的 `.wrangler/dev-registry`，因为当前 Wrangler 和 Cloudflare Vite 插件的默认服务注册目录不同。

## 目录与请求链路

```text
apps/
  frontend/       平台管理端：React + TanStack Start + Tailwind CSS，管理员登录
  pay/            付款页：/:slug 选金额、/invoice/:orderId 付款，无需登录
  backend/        Workers + Effect HttpApi
  wallet/        Bun + Effect HttpApi，Breez Spark SDK 平台钱包
packages/
  api/            Effect Schema 与 HTTP API 契约
  db/             Drizzle schema、建库基线和 PostgreSQL 连接
  ui/             shadcn/ui 组件源码、主题与样式工具
```

浏览器请求同源 `/api/*` → 所在前端的服务端路由 → `BACKEND` 服务绑定 → 后端 Effect API。平台管理端代理 `/api/auth/*`、`/api/me`、`/api/admin/*`；付款页只代理 `/api/public/*`，不转发 cookie，也不接触登录和管理接口。前端校验响应契约，并展示连接失败、超时和重试状态。当前检查只代表 HTTP 服务可达，不代表任何支付节点可用。

`packages/api` 和 `packages/ui` 直接导出源码，由使用它们的应用打包。shadcn/ui 组件代码归本项目维护，多个前端从 `@btc-lightning-pay/ui/components/*` 导入同一份源码，通过共享样式入口使用同一主题；应用路由、状态和业务逻辑留在各前端。

## 常用命令

| 命令              | 用途                                       |
| ----------------- | ------------------------------------------ |
| `pnpm dev`        | 同时启动管理端、付款页和后端               |
| `pnpm dev:pay`    | 单独启动付款页（端口 3001）                |
| `pnpm dev:wallet` | 独立启动北美收款后端（需配置 `.env`）      |
| `pnpm build`      | 构建前端、打包后端；后端仅 dry-run，不部署 |
| `pnpm typegen`    | 根据 Wrangler 配置生成运行时与绑定类型     |
| `pnpm typecheck`  | 生成绑定类型及前端路由，然后检查各包类型   |
| `pnpm check`      | Vite+ 格式和 lint 检查                     |
| `pnpm format`     | 自动格式化                                 |
| `pnpm test`       | 后端契约测试、前端交互与依赖集成测试       |
| `pnpm ready`      | 执行类型、规范、测试和构建检查             |

前端 `typecheck` 会先构建以生成 TanStack 路由类型，因此比单独运行 TypeScript 稍慢。生成的路由和 Workers 类型不纳入版本控制；首次安装后执行 `pnpm typecheck` 即可补齐。

## 环境配置

健康检查无需环境变量即可启动。后端认证使用 Supabase PostgreSQL、Better Auth 和 Resend，认证表放在 `public`；第一阶段仅限已开通且启用的管理员登录，商户账号已建模但不开放登录。配置、初始化和开户步骤见 [数据库与认证接入](docs/auth-setup.md)。前端已包含两步登录页、同源代理、SSR 首页守卫和退出入口。两端各有 `.dev.vars.example`，需要本地密钥时复制为同目录的 `.dev.vars`。真实 `.env` / `.dev.vars` 已被忽略，不要把密钥放进浏览器可见的 `VITE_` 变量。

两个前端的 `wrangler.jsonc` 都用 `BACKEND` 绑定后端 Worker 的 `name`；重命名时需同步修改。管理端可选设置公开变量 `VITE_PAY_ORIGIN`（付款页的 origin，例如 `https://pay.example.com`），用于显示和打开商户收款链接；未设置时只显示路径。兼容日期固定为 `2026-11-17`。未来部署需要另行配置账户与域名，本骨架没有执行远程部署。

付款页的浏览器标题统一为 `Lightning Payment`。页面中的品牌标志和 favicon 共用 `apps/pay/public/payment-logo.png`。

付款链接使用 `/invoice/:orderId`。从商户金额页创建订单时会附带 `?m=<slug>`。

## 技术栈与版本选择

参考 sirens 的 workspace 组织、前端 SSR 技术栈、Workers 运行时和 Effect API 架构，不复制其业务模块、云资源 ID、兼容性补丁或全局依赖覆盖。

2026-11-17 查询 npm 官方注册表的稳定 `latest` 标签，核心版本如下；精确依赖统一放在 `pnpm-workspace.yaml`，传递依赖由 `pnpm-lock.yaml` 固定。

| 依赖                   | sirens 参考版本 | 本项目       |
| ---------------------- | --------------- | ------------ |
| pnpm                   | 11.0.9          | 12.21.0      |
| React / React DOM      | 19.2.8          | 19.3.1       |
| TanStack Start         | 1.168.49        | 1.169.5      |
| TanStack Router        | 1.170.32        | 1.170.46     |
| Tailwind CSS           | 4.3.3           | 4.3.5        |
| Effect                 | 4.0.0-rc.112    | 4.1.4 稳定版 |
| Vite（前端）           | 8.2.2           | 8.3.8        |
| Vite+（检查和测试）    | 0.3.0           | 1.6.0        |
| TypeScript             | 6.0.2           | 7.0.2        |
| Wrangler               | 4.125.0         | 4.163.0      |
| Cloudflare Vite plugin | 1.53.1          | 1.69.1       |

前端使用独立 Vite，根工具链使用 Vite+；不引入参考项目中为其他应用服务的 Vite 全局 alias/override。Effect 使用稳定版的 `effect/http` 与 `effect/http-api` 导出路径。

Vite+ 的内置 Vite fork 版本号是 `1.6.0`，因此只对其 `vitest` 和 `@vitest/mocker` 的 Vite peer 声明精确兼容版本，不放行任意版本。

配置依据：[TanStack Start Cloudflare 指南](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)、[TanStack 路由](https://tanstack.com/start/latest/docs/framework/react/guide/routing)、[Effect HTTP API](https://github.com/effect-ts/effect/blob/main/packages/effect/HTTPAPI.md)、[Vite+ monorepo](https://github.com/voidzero-dev/vite-plus/blob/main/docs/guide/monorepo.md)。

## 前端基础依赖

以下依赖已按 2026-11-17 的 npm 稳定版本核对并安装，具体版本见 workspace catalog：

| 能力            | 依赖                                                        | 当前接入                                                                                                 |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 请求与 SSR 缓存 | `@tanstack/react-query`、`@tanstack/react-router-ssr-query` | `getRouter()` 内创建独立 QueryClient；健康检查使用 Query                                                 |
| 表单校验        | `@tanstack/react-form`、`zod`                               | 已通过表单提交与校验集成测试；API 契约仍使用 Effect Schema                                               |
| URL 状态        | `nuqs`                                                      | 根路由已配置 TanStack Router adapter；管理端列表的筛选与分页保存在 URL                                   |
| 表格            | `@tanstack/react-table`                                     | 管理端列表通过 `apps/frontend/src/components/data-table` 统一渲染 shadcn Table 与分页                    |
| 提示            | shadcn toast（Base UI Toast）                               | 管理端写操作成功后提示，`<Toaster />` 挂在管理端 shell                                                   |
| 客户端共享状态  | `jotai`                                                     | 根路由已配置 Provider，避免 SSR 使用全局默认 store                                                       |
| 动效            | `motion`、`tw-animate-css`                                  | MotionConfig 跟随系统减少动态效果设置；CSS 动效已导入，使用时配合 `motion-safe:` / `motion-reduce:`      |
| 日期与时间      | `date-fns`、`@date-fns/tz`、`@daypicker/react`              | 管理端按北京时间显示与筛选；日期范围使用 shadcn Calendar + Popover，时间控件使用原生 `input type="time"` |
| 二维码          | `qrcode`、`@types/qrcode`                                   | 已验证 SVG 生成，无需浏览器 canvas；尚未接入支付数据                                                     |
| 图标            | `lucide-react`                                              | 健康检查按钮使用图标                                                                                     |
| 测试            | Testing Library（React、DOM、user-event）、`happy-dom`      | Vite+ 分开运行 Node 后端测试与 DOM 前端测试                                                              |

Query 管理服务端数据，Jotai 管理客户端共享状态，nuqs 管理 URL 状态。表单、日期、二维码的最小使用示例位于 `apps/frontend/src/test/libraries.test.tsx`，不增加演示业务页面。UI 使用 shadcn/ui，官方 CLI 按 preset `bIkeymG` 初始化（`base-vega`、neutral、Lucide、Inter）。preset 不包含底层 primitive 选择，本项目使用 Base UI（`--base base`）。已生成 Button、Card 及登录所需的 Field、Input Group、Input OTP、Alert、Spinner 等官方组件；日期、表单、二维码等既有依赖继续保留。

`packages/ui/src/styles/globals.css` 保存 CLI 生成的主题变量，Inter 字体由本地 npm 包提供；前端样式入口导入共享 CSS，并声明 Tailwind 对应用和共享组件的扫描路径。根路由使用 `MotionConfig reducedMotion="user"`，无需额外 UI Provider。

两个 `components.json` 配置一致的 style、iconLibrary、baseColor；前端的 ui/utils alias 指向共享包。添加组件时从前端运行，CLI 会把共享组件写入 `packages/ui`：

```sh
pnpm --filter @btc-lightning-pay/ui exec shadcn add dialog --cwd ../../apps/frontend
```

CLI 安装在 `packages/ui`，也可直接在那里运行：

```sh
pnpm --filter @btc-lightning-pay/ui exec shadcn add dialog
```

添加后检查生成文件和依赖，将新增依赖的精确版本归入 workspace catalog，再运行 `pnpm ready`。后续第二个前端添加 `@btc-lightning-pay/ui: workspace:*`，复用同样的 components aliases 和样式入口即可。配置依据：[shadcn monorepo 指南](https://ui.shadcn.com/docs/monorepo)。

新增包使用 Motion 14.14.0、Jotai 3.0.2 等稳定版本，没有沿用 sirens 的旧主版本。Query 的 SSR 集成由官方适配器负责，避免重复创建 Provider 或手动做第二次缓存脱水。

## 当前边界

已包含 Breez Spark 钱包服务、多商户订单、固定报价、到账核验、管理员权限和结算单生成／确认／取消 API。付款页（`apps/pay`）与平台管理端页面（`apps/frontend`）已接入这些 API，尚未与真实后端和钱包联调。不包含商户独立钱包、退款或自动提现。业务和钱包共用一个 Supabase PostgreSQL，分别使用 `public` 和 `breez_wallet`。单独备份钱包密钥和 `breez_wallet`，部署步骤见 [后端接入与部署](docs/backend-setup.md)。

本地验证命令为 `pnpm ready`，包括格式/lint、各包类型检查、测试、前后端构建。测试覆盖共享按钮的加载禁用与失败重试；浏览器已验证 shadcn 主题渲染和前后端联调，冻结安装与 peer 检查通过。尚未验证真实云端部署。

Cloudflare 从兼容日期 `2026-11-17` 起默认启用新的模块注册机制。当前 Cloudflare Vite plugin 1.69.1 的本地开发组合会因此打印两次 `no match for module: node:process` 模块回退报错。前端通过官方 `legacy_module_registry` 兼容开关保留旧机制，开发和构建使用同一配置；升级工具链后重新验证，再移除此开关。后端未出现该问题，保留默认行为。参见 [Cloudflare 兼容说明](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#new-module-registry)。

前端根路由配置了统一 404 页面，不存在的页面地址返回 HTTP 404，并提供返回首页的链接。
