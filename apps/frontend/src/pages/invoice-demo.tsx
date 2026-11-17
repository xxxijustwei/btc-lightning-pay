import { CreateInvoiceInput, Invoice } from "@btc-lightning-pay/api";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@btc-lightning-pay/ui/components/card";
import { Input } from "@btc-lightning-pay/ui/components/input";
import { Label } from "@btc-lightning-pay/ui/components/label";
import { Textarea } from "@btc-lightning-pay/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { Schema } from "effect";
import QRCode from "qrcode";
import { useState } from "react";

export function InvoiceDemo() {
  const [copyStatus, setCopyStatus] = useState("");
  const invoice = useMutation({
    retry: false,
    mutationFn: async (form: FormData) => {
      const decoded = Schema.decodeUnknownOption(CreateInvoiceInput)({
        amountSat: Number(form.get("amountSat")),
        description: String(form.get("description") ?? "").trim(),
      });
      if (decoded._tag === "None")
        throw new Error("请输入 1–1,000,000 的整数 sats 和 1–128 字的描述。");
      let response;
      try {
        response = await fetch("/api/invoices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(decoded.value),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("未收到开票结果，请检查本地服务。请求不会自动重试。");
      }
      if (!response.ok) throw new Error("开票失败，请检查本地 phoenixd 连接与配置后重试。");
      let result;
      try {
        result = Schema.decodeUnknownSync(Invoice)(await response.json());
      } catch {
        throw new Error("服务返回了无效的 invoice，请检查后端。");
      }
      const svg = await QRCode.toString(result.serialized.toUpperCase(), {
        type: "svg",
        margin: 4,
      });
      return { ...result, qr: `data:image/svg+xml,${encodeURIComponent(svg)}` };
    },
  });

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-6 py-16">
      <p className="mb-3 text-sm font-medium text-primary">本地 Demo · Bitcoin 主网</p>
      <h1 className="text-3xl font-semibold tracking-tight">创建闪电网络 Invoice</h1>
      <p className="mt-4 leading-7 text-muted-foreground">
        输入金额与描述，生成 BOLT11 收款请求。此演示仅验收开票，请勿付款。
      </p>
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>收款信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (invoice.isPending) return;
              setCopyStatus("");
              invoice.mutate(new FormData(event.currentTarget));
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="amountSat">金额（sats）</Label>
              <Input
                id="amountSat"
                name="amountSat"
                type="number"
                min={1}
                max={1_000_000}
                step={1}
                defaultValue={1000}
                required
                disabled={invoice.isPending}
              />
              <p className="text-xs text-muted-foreground">
                1 BTC = 100,000,000 sats · 演示上限 1,000,000 sats
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">描述</Label>
              <Input
                id="description"
                name="description"
                maxLength={128}
                defaultValue="本地开票演示"
                required
                disabled={invoice.isPending}
              />
            </div>
            <Button type="submit" disabled={invoice.isPending} aria-busy={invoice.isPending}>
              {invoice.isPending ? "创建中…" : "创建 Invoice"}
            </Button>
            {invoice.isError && (
              <p role="alert" className="text-sm text-destructive">
                {invoice.error.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
      {invoice.data && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Invoice 已创建</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p role="status" className="text-sm text-muted-foreground">
              {invoice.data.amountSat.toLocaleString()} sats · 自创建起 1 小时有效 · 未检查支付状态
            </p>
            <img
              src={invoice.data.qr}
              alt="闪电网络 Invoice 二维码"
              width={288}
              height={288}
              className="mx-auto h-auto max-w-full"
            />
            <div className="space-y-2">
              <Label htmlFor="bolt11">BOLT11 Invoice</Label>
              <Textarea
                id="bolt11"
                value={invoice.data.serialized}
                readOnly
                rows={5}
                className="break-all font-mono text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invoice.data.serialized);
                  setCopyStatus("已复制");
                } catch {
                  setCopyStatus("复制失败，请从上方文本框手动复制。");
                }
              }}
            >
              复制 Invoice
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {copyStatus}
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
