import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@btc-lightning-pay/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@btc-lightning-pay/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  AdminApiError,
  adminApi,
  describeAdminError,
  type MerchantData,
} from "../../lib/api/admin";
import { formatBeijing } from "../../lib/format";
import {
  ConfirmDialog,
  EmptyRow,
  EnabledBadge,
  ErrorState,
  ListPagination,
  LoadingRows,
} from "./common";
import { allMerchantsQuery } from "./queries";
import { AdminPage } from "./shell";

type Filter = "all" | "enabled" | "disabled";

export function MerchantsPage() {
  const merchants = useQuery(allMerchantsQuery());
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<MerchantData | null>(null);

  const rows = (merchants.data ?? []).filter(
    (merchant) => filter === "all" || merchant.enabled === (filter === "enabled"),
  );
  const visible = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <AdminPage
      crumbs={[{ label: "商户" }]}
      title="商户"
      description="名称仅内部可见；slug 即公开收款链接，创建后不可修改，也不会回收。"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          新建商户
        </Button>
      }
    >
      <section aria-label="全部商户" className="flex flex-col gap-3">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="状态筛选"
          value={[filter]}
          onValueChange={(values) => {
            const next = values[0] as Filter | undefined;
            if (next) {
              setFilter(next);
              setPage(1);
            }
          }}
        >
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="enabled">启用</ToggleGroupItem>
          <ToggleGroupItem value="disabled">已停用</ToggleGroupItem>
        </ToggleGroup>
        {merchants.isError ? (
          <ErrorState error={merchants.error} onRetry={() => void merchants.refetch()} />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="pl-4">商户</TableHead>
                  <TableHead>收款链接</TableHead>
                  <TableHead>登录邮箱</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="pr-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {merchants.isPending ? (
                  <LoadingRows columns={6} />
                ) : visible.length === 0 ? (
                  <EmptyRow columns={6}>
                    {merchants.data?.length
                      ? "当前筛选条件下没有商户。"
                      : "还没有商户，点击“新建商户”开始。"}
                  </EmptyRow>
                ) : (
                  visible.map((merchant) => (
                    <TableRow key={merchant.id}>
                      <TableCell className="pl-4 font-medium">
                        <Link
                          to="/merchants/$merchantId"
                          params={{ merchantId: merchant.id }}
                          className="underline-offset-4 hover:underline"
                        >
                          {merchant.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        /{merchant.slug}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{merchant.email}</TableCell>
                      <TableCell>
                        <EnabledBadge enabled={merchant.enabled} />
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatBeijing(merchant.createdAt, false)}
                      </TableCell>
                      <TableCell className="pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <Link
                              to="/merchants/$merchantId"
                              params={{ merchantId: merchant.id }}
                            />
                          }
                          nativeButton={false}
                        >
                          详情
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setToggling(merchant)}>
                          {merchant.enabled ? "停用" : "恢复"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          total={rows.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </section>
      <CreateMerchantDialog open={creating} onOpenChange={setCreating} />
      <ToggleMerchantDialog merchant={toggling} onClose={() => setToggling(null)} />
    </AdminPage>
  );
}

const SLUG = /^[a-z][a-z0-9-]{2,31}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CreateMerchantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", slug: "" });
  const [touched, setTouched] = useState(false);
  const create = useMutation({
    mutationFn: adminApi.createMerchant,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      close();
    },
  });

  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();
  const errors = {
    name: !name ? "请填写名称。" : name.length > 100 ? "名称最多 100 个字符。" : "",
    email: !email ? "请填写登录邮箱。" : !EMAIL.test(email) ? "邮箱格式不正确。" : "",
    slug: !form.slug
      ? "请填写 slug。"
      : !SLUG.test(form.slug)
        ? "3–32 位，小写字母开头，仅含小写字母、数字、连字符。"
        : "",
  };
  const serverError = create.error instanceof AdminApiError ? create.error.code : "";
  if (serverError === "EMAIL_EXISTS") errors.email = describeAdminError(create.error);
  if (serverError === "MERCHANT_EXISTS") errors.slug = describeAdminError(create.error);
  const otherError = create.isError && !["EMAIL_EXISTS", "MERCHANT_EXISTS"].includes(serverError);

  function close() {
    onOpenChange(false);
    setForm({ name: "", email: "", slug: "" });
    setTouched(false);
    create.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (errors.name || errors.email || errors.slug || create.isPending) return;
    create.mutate({ name, email, slug: form.slug });
  }
  const show = (field: keyof typeof errors) =>
    (touched ||
      (field === "email" && serverError === "EMAIL_EXISTS") ||
      (field === "slug" && serverError === "MERCHANT_EXISTS")) &&
    errors[field];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : !create.isPending && close())}
    >
      <DialogContent>
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <DialogHeader>
            <DialogTitle>新建商户</DialogTitle>
            <DialogDescription>
              同时开通一个商户账号。第一阶段商户不能登录，也不会发送通知邮件。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={show("name") ? true : undefined}>
              <FieldLabel htmlFor="merchant-name">名称</FieldLabel>
              <Input
                id="merchant-name"
                value={form.name}
                maxLength={100}
                placeholder="例如 Onne 商户"
                aria-invalid={show("name") ? true : undefined}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              {show("name") ? (
                <FieldError>{errors.name}</FieldError>
              ) : (
                <FieldDescription>仅管理员可见，之后可以修改。</FieldDescription>
              )}
            </Field>
            <Field data-invalid={show("email") ? true : undefined}>
              <FieldLabel htmlFor="merchant-email">登录邮箱</FieldLabel>
              <Input
                id="merchant-email"
                type="email"
                value={form.email}
                placeholder="merchant@example.com"
                aria-invalid={show("email") ? true : undefined}
                onChange={(event) => {
                  setForm({ ...form, email: event.target.value });
                  if (serverError === "EMAIL_EXISTS") create.reset();
                }}
              />
              {show("email") ? (
                <FieldError>{errors.email}</FieldError>
              ) : (
                <FieldDescription>全平台唯一，创建后不能修改。</FieldDescription>
              )}
            </Field>
            <Field data-invalid={show("slug") ? true : undefined}>
              <FieldLabel htmlFor="merchant-slug">收款链接 slug</FieldLabel>
              <Input
                id="merchant-slug"
                value={form.slug}
                placeholder="例如 onne"
                className="font-mono"
                aria-invalid={show("slug") ? true : undefined}
                onChange={(event) => {
                  setForm({ ...form, slug: event.target.value });
                  if (serverError === "MERCHANT_EXISTS") create.reset();
                }}
              />
              {show("slug") ? (
                <FieldError>{errors.slug}</FieldError>
              ) : (
                <FieldDescription>
                  3–32 位，小写字母开头，仅含小写字母、数字、连字符。创建后不可修改。
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
          {otherError ? (
            <p role="alert" className="text-sm text-destructive">
              {describeAdminError(create.error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.isPending} onClick={close}>
              取消
            </Button>
            <Button type="submit" disabled={create.isPending} aria-busy={create.isPending}>
              {create.isPending ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              创建商户
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToggleMerchantDialog({
  merchant,
  onClose,
}: {
  merchant: MerchantData | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      adminApi.updateMerchant(input.id, { enabled: input.enabled }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toggle.reset();
      onClose();
    },
  });
  if (!merchant) return null;
  const disabling = merchant.enabled;
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          toggle.reset();
          onClose();
        }
      }}
      title={disabling ? `停用「${merchant.name}」？` : `恢复「${merchant.name}」？`}
      description={
        disabling
          ? "将同时禁用商户账号、停止新开票并注销全部会话。已发出的 invoice 仍会到账入账并可结算，历史记录保留。"
          : `同时恢复商户账号和收款，/${merchant.slug} 可以再次开票。第一阶段商户仍不能登录。`
      }
      confirmLabel={disabling ? "停用" : "恢复"}
      destructive={disabling}
      pending={toggle.isPending}
      error={toggle.isError ? describeAdminError(toggle.error) : undefined}
      onConfirm={() => toggle.mutate({ id: merchant.id, enabled: !disabling })}
    />
  );
}
