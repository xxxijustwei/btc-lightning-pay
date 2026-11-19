# BTC Lightning Pay

平台用一个 Spark 钱包统一收款，按商户记账，并人工结算给商户。

## 订单与收款

**订单（Order）**：
付款人对某个商户发起的一次固定金额收款：创建时锁定 USD 金额、报价和 sats，并对应一张一小时有效的 Lightning 发票。
_Avoid_: payment、交易

**下单（Order intake）**：
付款人为一个商户请求订单、直到拿到可付款发票为止的过程，包括幂等、准入、报价和占位；同一个幂等键重复下单时返回已有的订单。
_Avoid_: checkout、开单

**幂等键（Idempotency key）**：
付款人一侧为一次下单提供的键；同一商户下同一个键只对应一个订单。
_Avoid_: request id

**占位（Reservation）**：
已占用幂等键和准入名额、但还没有拿到发票的订单；不展示给付款人，开票失败或被遗弃时删除。
_Avoid_: 草稿、pending order

**准入（Admission）**：
限制开票速率的规则，按每个商户和全平台分别计数，超出时明确拒绝，不静默丢单。
_Avoid_: 限流（限流指边缘按 IP 的近似限制）

**报价（Quote）**：
Coinbase BTC/USD 现货参考价及其获取时间，用于把订单的 USD 金额换算成 sats。

## 钱包

**钱包（Wallet）**：
Worker 眼中的平台钱包：能为订单开出发票、查询某张发票是否已收款、列出已完成的收款。指钱包服务对 Worker 承诺的能力，而不是钱包服务内部对 Breez SDK 的封装。
_Avoid_: wallet client、gateway、node

**收款事实（Receipt）**：
钱包报告的一笔已完成收款，以及它对应的订单、发票和到账金额；只有它能让订单变为已支付。
_Avoid_: payment（易与订单混淆）、callback

**入账（Crediting）**：
把收款事实与订单核对后记为已支付；到账不少于发票金额即入账，多付部分单独记录、不结算给商户。
_Avoid_: confirm、settle（结算另有含义）

**同步游标（Sync cursor）**：
定时入账已读到的收款时间点；只前进不后退。
_Avoid_: checkpoint、offset

**异常（Anomaly）**：
与订单相矛盾的收款事实或发票，例如金额、hash 或发票不符。它不是故障，订单保持原状，单独记录待人工跟进。
_Avoid_: mismatch error、故障

## 结算

**结算批次（Settlement batch）**：
管理员为一个商户固定下来的一组已支付、未结算订单；人工付款并登记凭证后确认，付款前可以取消。
_Avoid_: payout、提现
