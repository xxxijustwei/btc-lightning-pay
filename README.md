# BTC Lightning Pay

初始 monorepo：一个 TanStack Start 前端、一个 Cloudflare Workers 后端、共享 API 契约与 shadcn/ui 源码包。当前实现健康检查、前后端邮箱验证码认证，以及本地 phoenixd 开票 demo。

本地开票演示：使用 OrbStack 运行 phoenixd，打开 `/demo` 即可创建主网 BOLT11 invoice、查看二维码并复制，无需登录。部署、钱包备份与验收步骤见 [phoenixd demo](docs/phoenixd-demo.md)。此阶段不执行付款或验证到账。

AI 协作约定见 [AGENTS.md](AGENTS.md)，Claude Code 通过 [CLAUDE.md](CLAUDE.md) 引用同一份规则；按任务阅读 `.patterns/` 中的工程规范。Skills 由开发者单独安装和维护。

## 快速开始

使用 Node.js 26（本地验证版本见 `.node-version`）和 pnpm 12.21.0。也支持满足根 `package.json` engines 的 Node.js 22/24。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

如果已有的旧 pnpm 自动切换到 12 时出现 `ENOEXEC`，通过 npm 启动固定版本，无需修改全局安装：

```sh
npx --yes pnpm@12.21.0 install --frozen-lockfile
npx --yes pnpm@12.21.0 dev
```

打开 <http://127.0.0.1:3000>，未登录会进入登录页；完成下方认证配置后登录，首页可点击「检查连接」。后端地址为 <http://127.0.0.1:8787/api/health>，成功返回 `{"status":"ok"}`。

两个应用都在本地 Workers 运行时运行，无需登录 Cloudflare。也可以分别执行 `pnpm dev:frontend` 和 `pnpm dev:backend`。

开发命令使用 POSIX 环境变量语法，适用于 macOS/Linux；Windows 使用 WSL。两端显式共用项目内的 `.wrangler/dev-registry`，因为当前 Wrangler 和 Cloudflare Vite 插件的默认服务注册目录不同。

## 目录与请求链路

```text
apps/
  frontend/       React + TanStack Start + Tailwind CSS
  backend/        Workers + Effect HttpApi
packages/
  api/            Effect Schema 与 HTTP API 契约
  db/             Drizzle schema、迁移和 PostgreSQL 连接
  ui/             shadcn/ui 组件源码、主题与样式工具
```

浏览器请求同源 `/api/health` → 前端的服务端路由 → `BACKEND` 服务绑定 → 后端 Effect API。前端校验响应契约，并展示连接失败、超时和重试状态。当前检查只代表 HTTP 服务可达，不代表任何支付节点可用。

`packages/api` 和 `packages/ui` 直接导出源码，由使用它们的应用打包。shadcn/ui 组件代码归本项目维护，多个前端从 `@btc-lightning-pay/ui/components/*` 导入同一份源码，通过共享样式入口使用同一主题；应用路由、状态和业务逻辑留在各前端。

## 常用命令

| 命令             | 用途                                       |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | 同时启动前后端                             |
| `pnpm build`     | 构建前端、打包后端；后端仅 dry-run，不部署 |
| `pnpm typegen`   | 根据 Wrangler 配置生成运行时与绑定类型     |
| `pnpm typecheck` | 生成绑定类型及前端路由，然后检查各包类型   |
| `pnpm check`     | Vite+ 格式和 lint 检查                     |
| `pnpm format`    | 自动格式化                                 |
| `pnpm test`      | 后端契约测试、前端交互与依赖集成测试       |
| `pnpm ready`     | 执行类型、规范、测试和构建检查             |

前端 `typecheck` 会先构建以生成 TanStack 路由类型，因此比单独运行 TypeScript 稍慢。生成的路由和 Workers 类型不纳入版本控制；首次安装后执行 `pnpm typecheck` 即可补齐。

## 环境配置

健康检查无需环境变量即可启动。后端认证使用 Supabase PostgreSQL、Better Auth 和 Resend，全部表放在 `public`；仅限预开户用户。配置、迁移和开户步骤见 [数据库与认证接入](docs/auth-setup.md)。前端已包含两步登录页、同源代理、SSR 首页守卫和退出入口。两端各有 `.dev.vars.example`，需要本地密钥时复制为同目录的 `.dev.vars`。真实 `.env` / `.dev.vars` 已被忽略，不要把密钥放进浏览器可见的 `VITE_` 变量。

前端 `wrangler.jsonc` 的 `BACKEND` 绑定名称对应后端 Worker 的 `name`；重命名时需同步修改。兼容日期固定为 `2026-11-17`。未来部署需要另行配置账户与域名，本骨架没有执行远程部署。

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

| 能力            | 依赖                                                        | 当前接入                                                                                                  |
| --------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 请求与 SSR 缓存 | `@tanstack/react-query`、`@tanstack/react-router-ssr-query` | `getRouter()` 内创建独立 QueryClient；健康检查使用 Query                                                  |
| 表单校验        | `@tanstack/react-form`、`zod`                               | 已通过表单提交与校验集成测试；API 契约仍使用 Effect Schema                                                |
| URL 状态        | `nuqs`                                                      | 根路由已配置 TanStack Router adapter                                                                      |
| 客户端共享状态  | `jotai`                                                     | 根路由已配置 Provider，避免 SSR 使用全局默认 store                                                        |
| 动效            | `motion`、`tw-animate-css`                                  | MotionConfig 跟随系统减少动态效果设置；CSS 动效已导入，使用时配合 `motion-safe:` / `motion-reduce:`       |
| 日期与时间      | `date-fns`、`@daypicker/react`                              | 日期库已验证；使用日历时在对应入口导入 `@daypicker/react/style.css`，时间控件使用原生 `input type="time"` |
| 二维码          | `qrcode`、`@types/qrcode`                                   | 已验证 SVG 生成，无需浏览器 canvas；尚未接入支付数据                                                      |
| 图标            | `lucide-react`                                              | 健康检查按钮使用图标                                                                                      |
| 测试            | Testing Library（React、DOM、user-event）、`happy-dom`      | Vite+ 分开运行 Node 后端测试与 DOM 前端测试                                                               |

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

已包含 OrbStack/Docker Compose 下的 phoenixd 本地部署和公开开票 demo；未包含订单、支付状态、用户钱包、提现、合约、队列、CI/CD 和云端部署。首页是联调入口，`/demo` 是无需认证的开票演示。新增业务时再加入对应服务、配置和测试。

本地验证命令为 `pnpm ready`，包括格式/lint、各包类型检查、测试、前后端构建。测试覆盖共享按钮的加载禁用与失败重试；浏览器已验证 shadcn 主题渲染和前后端联调，冻结安装与 peer 检查通过。尚未验证真实云端部署。

Cloudflare 从兼容日期 `2026-11-17` 起默认启用新的模块注册机制。当前 Cloudflare Vite plugin 1.69.1 的本地开发组合会因此打印两次 `no match for module: node:process` 模块回退报错。前端通过官方 `legacy_module_registry` 兼容开关保留旧机制，开发和构建使用同一配置；升级工具链后重新验证，再移除此开关。后端未出现该问题，保留默认行为。参见 [Cloudflare 兼容说明](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#new-module-registry)。

前端根路由配置了统一 404 页面，不存在的页面地址返回 HTTP 404，并提供返回首页的链接。
