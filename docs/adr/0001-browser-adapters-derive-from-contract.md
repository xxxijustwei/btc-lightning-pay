# 浏览器端 adapter 从 PaymentsApi 派生，但不用 HttpApiClient

`apps/frontend` 和 `apps/pay` 调用 `/api/admin/*`、`/api/public/*` 时，路径、方法和请求/响应 schema 都直接读取 `PaymentsApi` 的端点定义，不再手写。执行请求的是各 app 自带的一个轻量调用函数（基于 `fetch` 和 Effect Schema），而不是 Effect 的 `HttpApiClient`。

## Considered Options

- **`HttpApiClient`**（已否决）：会让 pay 的 gzip 体积增加约 26 KiB；声明过的错误以无 tag 的普通 `{code, message}` 对象 reject，网络失败、解码失败、未声明状态码又各是不同的 `HttpClientError`，页面得同时处理几种错误；默认还会给每个请求加 `traceparent`/`b3` 追踪头。（基于 effect@4.1.4 测得。）
- **继续手写端点函数，只用合约推导类型**（已否决）：路径和解码仍然是两份，合约变化不会自动同步到前端。

## Consequences

- 调用函数依赖 `HttpApiEndpoint` 公开字段（`path`、`method`、`params`、`query`、`headers`、`payload`、`success`、`error`）的形状，effect 大版本升级时要一起检查。
- 契约包规定不含运行时 I/O，所以调用函数不放进 `packages/api`，两个 app 各放一份。
- 付款页的调用函数后来移到服务端：它在服务端函数里经 `BACKEND` 绑定调用后端，失败以 `{code, retryable, outcomeUnknown}` 数据返回浏览器，浏览器再还原成同样的 `PublicApiError`。浏览器代码只导入 `@btc-lightning-pay/api/schemas`，不打包 `PaymentsApi`。
