# BTC Lightning Pay

初始 monorepo：一个 TanStack Start 前端、一个 Cloudflare Workers 后端、共享 API 契约和共享 Lobe UI 包。当前只实现健康检查，不包含支付业务。

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

打开 <http://127.0.0.1:3000>，点击「检查连接」。后端地址为 <http://127.0.0.1:8787/api/health>，成功返回 `{"status":"ok"}`。

两个应用都在本地 Workers 运行时运行，无需登录 Cloudflare。也可以分别执行 `pnpm dev:frontend` 和 `pnpm dev:backend`。

开发命令使用 POSIX 环境变量语法，适用于 macOS/Linux；Windows 使用 WSL。两端显式共用项目内的 `.wrangler/dev-registry`，因为当前 Wrangler 和 Cloudflare Vite 插件的默认服务注册目录不同。

## 目录与请求链路

```text
apps/
  frontend/       React + TanStack Start + Tailwind CSS
  backend/        Workers + Effect HttpApi
packages/
  api/            Effect Schema 与 HTTP API 契约
  ui/             Lobe UI 组件出口、Provider、主题和样式
```

浏览器请求同源 `/api/health` → 前端的服务端路由 → `BACKEND` 服务绑定 → 后端 Effect API。前端校验响应契约，并展示连接失败、超时和重试状态。当前检查只代表 HTTP 服务可达，不代表任何支付节点可用。

`packages/api` 和 `packages/ui` 直接导出 TypeScript 源码，由使用它们的应用打包，不需要额外发布或编译产物。未来第二个前端通过 `workspace:*` 使用同一个 UI 包；接入步骤见 [packages/ui/README.md](packages/ui/README.md)。目前不创建第二个前端。

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

当前无需环境变量即可启动。两端各有 `.dev.vars.example`，后续需要本地密钥时复制为同目录的 `.dev.vars`。真实 `.env` / `.dev.vars` 已被忽略，不要把密钥放进浏览器可见的 `VITE_` 变量。

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

Query 管理服务端数据，Jotai 管理客户端共享状态，nuqs 管理 URL 状态。表单、日期、二维码的最小使用示例位于 `apps/frontend/src/test/libraries.test.tsx`，不增加演示业务页面。UI 使用 `@lobehub/ui 6.16.1`，配套 `@lobehub/icons 6.16.0` 和 `@lobehub/fluent-emoji 5.0.1`，统一由 `packages/ui` 管理；未另外安装 Ant Design、CVA 或 cnfast。Lobe 内部使用的 Base UI 属于传递依赖。

当前页面通过共享包使用 Lobe Button 和 Block，`UIProvider` 负责组件动效运行时，主题属性在 SSR 时写入 HTML。共享 CSS 声明 Tailwind 与 Lobe 的层级顺序，不需要额外配置 StyleX 编译器。现有 TanStack Form、日期和二维码库继续保留，暂不改换它们的业务使用方式。

新增包使用 Motion 14.14.0、Jotai 3.0.2 等稳定版本，没有沿用 sirens 的旧主版本。Query 的 SSR 集成由官方适配器负责，避免重复创建 Provider 或手动做第二次缓存脱水。

## 当前边界

未包含数据库、Docker、登录认证、支付协议、钱包、合约、队列、CI/CD 和部署。首页是联调入口，不是支付产品界面。新增业务时再加入对应服务、配置和测试。

本地验证通过：格式/lint、各包类型检查、10 项测试、前后端构建。共享 UI 接入后验证了浏览器渲染和按钮联调，测试覆盖 Lobe 按钮的加载禁用与失败重试。尚未验证真实云端部署。

已知工具链问题：当前 Cloudflare Vite plugin 1.69.1 启动开发环境时会打印两次 `no match for module: node:process` 模块回退报错，随后正常启动。已确认不阻止本骨架的 SSR 和健康检查，但未定位该工具链问题的根因；后续升级插件时需重新检查。

Lobe UI 的 `@emoji-mart/react` 传递依赖尚未声明 React 19 兼容范围，因此 `pnpm peers check` 会报告一条警告；没有通过配置隐藏它。当前接入的 Button、Block、Provider 通过类型、交互和构建检查；表情选择器尚未接入或验证。

当前构建包含完整 Lobe 样式，主 JS chunk 约 530 kB（gzip 约 173 kB），会触发 Vite 默认 500 kB 提示。首页已按路由拆分；尚未做专项包体优化，没有调高警告阈值。
