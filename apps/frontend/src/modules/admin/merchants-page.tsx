import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import { toast } from "@btc-lightning-pay/ui/components/toast";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import {
  AdminApiError,
  adminApi,
  describeAdminError,
  type MerchantData,
} from "../../lib/api/admin";
import { formatBeijing } from "../../lib/format";
import { merchantsSearch, paginationState, paginationUpdate } from "../../lib/list-search";
import {
  fieldErrors,
  normalizeEmail,
  validateEmail,
  validateName,
  validateSlug,
} from "../../lib/validation";
import { ConfirmDialog, EnabledBadge, ErrorState } from "./common";
import { FormDialog } from "./form-dialog";
import { allMerchantsQuery } from "./queries";
import { AdminPage } from "./shell";

const helper = createAppColumnHelper<MerchantData>();
const noRows: MerchantData[] = [];

export function MerchantsPage() {
  const merchants = useQuery(allMerchantsQuery());
  const [search, setSearch] = useQueryStates(merchantsSearch);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<MerchantData | null>(null);
  const pagination = paginationState(search);

  // The platform has at most 100 merchants: fetch once, filter and paginate in the table.
  const rows = useMemo(
    () =>
      (merchants.data ?? noRows).filter(
        (merchant) => !search.status || merchant.enabled === (search.status === "enabled"),
      ),
    [merchants.data, search.status],
  );
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "商户",
          meta: { cellClassName: "font-medium" },
          cell: ({ getValue, row }) => (
            <Link
              to="/merchants/$merchantId"
              params={{ merchantId: row.original.id }}
              className="underline-offset-4 hover:underline"
            >
              {getValue()}
            </Link>
          ),
        }),
        helper.accessor("slug", {
          header: "收款链接",
          meta: { cellClassName: "font-mono text-muted-foreground" },
          cell: ({ getValue }) => `/${getValue()}`,
        }),
        helper.accessor("email", {
          header: "商户邮箱",
          meta: { cellClassName: "text-muted-foreground" },
        }),
        helper.accessor("enabled", {
          header: "状态",
          cell: ({ getValue }) => <EnabledBadge enabled={getValue()} />,
        }),
        helper.accessor("createdAt", {
          header: "创建时间",
          meta: { cellClassName: "text-muted-foreground tabular-nums" },
          cell: ({ getValue }) => formatBeijing(getValue(), false),
        }),
        helper.display({
          id: "actions",
          header: "操作",
          meta: { headerClassName: "text-right", cellClassName: "text-right" },
          cell: ({ row }) => (
            <>
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={
                  <Link to="/merchants/$merchantId" params={{ merchantId: row.original.id }} />
                }
              >
                详情
              </Button>
              <Button variant="outline" size="sm" onClick={() => setToggling(row.original)}>
                {row.original.enabled ? "停用" : "恢复"}
              </Button>
            </>
          ),
        }),
      ]),
    [],
  );
  const table = useAppTable({
    columns,
    data: rows,
    getRowId: (merchant) => merchant.id,
    state: { pagination },
    onPaginationChange: (updater) => void setSearch(paginationUpdate(pagination, updater)),
    meta: {
      emptyMessage: merchants.data?.length
        ? "当前筛选条件下没有商户。"
        : "还没有商户，点击“新建商户”开始。",
    },
  });

  return (
    <AdminPage
      crumbs={[{ label: "商户" }]}
      title="商户"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          新建商户
        </Button>
      }
    >
      <table.AppTable>
        <section aria-label="全部商户" className="flex flex-col gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="状态筛选"
            value={[search.status ?? "all"]}
            onValueChange={(values) => {
              const next = values[0] as "all" | "enabled" | "disabled" | undefined;
              if (next) void setSearch({ status: next === "all" ? null : next, page: null });
            }}
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="enabled">启用</ToggleGroupItem>
            <ToggleGroupItem value="disabled">已停用</ToggleGroupItem>
          </ToggleGroup>
          {merchants.isError ? (
            <ErrorState error={merchants.error} onRetry={() => void merchants.refetch()} />
          ) : (
            <DataTable loading={merchants.isPending} />
          )}
          <DataTablePagination />
        </section>
      </table.AppTable>
      <CreateMerchantDialog open={creating} onOpenChange={setCreating} />
      <ToggleMerchantDialog merchant={toggling} onClose={() => setToggling(null)} />
    </AdminPage>
  );
}

function CreateMerchantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const create = useMutation({ mutationFn: adminApi.createMerchant });
  const form = useForm({
    defaultValues: { name: "", email: "", slug: "" },
    onSubmit: async ({ value }) => {
      const merchant = await create
        .mutateAsync({
          name: value.name.trim(),
          email: normalizeEmail(value.email),
          slug: value.slug,
        })
        .catch(() => null);
      if (!merchant) return;
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.add({
        title: "商户已创建",
        description: `${merchant.name} · /${merchant.slug}`,
        type: "success",
      });
      close();
    },
  });
  // Conflicts reported by the backend belong to a field; anything else shows above the actions.
  const conflict = create.error instanceof AdminApiError ? create.error.code : "";
  const serverError = (code: string) =>
    conflict === code ? describeAdminError(create.error) : undefined;
  function close() {
    form.reset();
    create.reset();
    onOpenChange(false);
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="新建商户"
      description="同时开通一个商户账号。第一阶段商户不能登录，也不会发送通知邮件。"
      submitLabel="创建商户"
      submitting={create.isPending}
      error={
        create.isError && !["EMAIL_EXISTS", "MERCHANT_EXISTS"].includes(conflict)
          ? describeAdminError(create.error)
          : undefined
      }
      onSubmit={() => void form.handleSubmit()}
    >
      <FieldGroup>
        <form.Field name="name" validators={{ onBlur: validateName, onSubmit: validateName }}>
          {(field) => {
            const errors = fieldErrors(field.state.meta.errors);
            return (
              <Field data-invalid={errors.length ? true : undefined}>
                <FieldLabel htmlFor="merchant-name">名称</FieldLabel>
                <Input
                  id="merchant-name"
                  maxLength={100}
                  placeholder="例如 Onne 商户"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={errors.length ? true : undefined}
                />
                {errors.length ? (
                  <FieldError errors={errors} />
                ) : (
                  <FieldDescription>仅管理员可见，之后可以修改。</FieldDescription>
                )}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="email" validators={{ onBlur: validateEmail, onSubmit: validateEmail }}>
          {(field) => {
            const errors = [
              ...fieldErrors(field.state.meta.errors),
              ...fieldErrors([serverError("EMAIL_EXISTS")]),
            ];
            return (
              <Field data-invalid={errors.length ? true : undefined}>
                <FieldLabel htmlFor="merchant-email">商户邮箱</FieldLabel>
                <Input
                  id="merchant-email"
                  type="email"
                  placeholder="merchant@example.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    if (conflict === "EMAIL_EXISTS") create.reset();
                  }}
                  aria-invalid={errors.length ? true : undefined}
                />
                {errors.length ? (
                  <FieldError errors={errors} />
                ) : (
                  <FieldDescription>全平台唯一，创建后不能修改。</FieldDescription>
                )}
              </Field>
            );
          }}
        </form.Field>
        <form.Field name="slug" validators={{ onBlur: validateSlug, onSubmit: validateSlug }}>
          {(field) => {
            const errors = [
              ...fieldErrors(field.state.meta.errors),
              ...fieldErrors([serverError("MERCHANT_EXISTS")]),
            ];
            return (
              <Field data-invalid={errors.length ? true : undefined}>
                <FieldLabel htmlFor="merchant-slug">收款链接 slug</FieldLabel>
                <Input
                  id="merchant-slug"
                  className="font-mono"
                  placeholder="例如 onne"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    if (conflict === "MERCHANT_EXISTS") create.reset();
                  }}
                  aria-invalid={errors.length ? true : undefined}
                />
                {errors.length ? (
                  <FieldError errors={errors} />
                ) : (
                  <FieldDescription>
                    3–32 位，小写字母开头，仅含小写字母、数字、连字符。创建后不可修改。
                  </FieldDescription>
                )}
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>
    </FormDialog>
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
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.add({
        title: updated.enabled ? "商户已恢复" : "商户已停用",
        description: updated.name,
        type: "success",
      });
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
