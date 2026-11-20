import { Button } from "@btc-lightning-pay/ui/components/button";
import { FieldGroup } from "@btc-lightning-pay/ui/components/field";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import { adminApi, type MerchantData } from "../../lib/api/admin";
import { formatBeijing } from "../../lib/format";
import { merchantsSearch, paginationUpdate } from "../../lib/list-search";
import { normalizeEmail, validateEmail, validateName, validateSlug } from "../../lib/validation";
import { EnabledBadge, ErrorState } from "./common";
import { FilterToggle } from "./filter-toggle";
import { FormDialog } from "./form-dialog";
import { allMerchantsQuery } from "./queries";
import { AdminPage } from "./shell";
import { useWriteDialog } from "./write-dialog";

const helper = createAppColumnHelper<MerchantData>();
const noRows: MerchantData[] = [];
const statusOptions = [
  { value: "enabled", label: "启用" },
  { value: "disabled", label: "已停用" },
] as const;

export function MerchantsPage() {
  const merchants = useQuery(allMerchantsQuery());
  const [search, setSearch] = useQueryStates(merchantsSearch);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState<MerchantData | null>(null);
  const pagination = { pageIndex: search.page, pageSize: search.size };

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
          <FilterToggle
            label="状态筛选"
            options={statusOptions}
            value={search.status}
            onChange={(status) => void setSearch({ status, page: null })}
          />
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

export function CreateMerchantDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { name: "", email: "", slug: "" },
    mutationFn: (value) =>
      adminApi.createMerchant({
        payload: { name: value.name.trim(), email: normalizeEmail(value.email), slug: value.slug },
      }),
    toast: (merchant) => ({
      title: "商户已创建",
      description: `${merchant.name} · /${merchant.slug}`,
    }),
    fieldConflicts: { EMAIL_EXISTS: "email", MERCHANT_EXISTS: "slug" },
    onClose: () => onOpenChange(false),
  });
  return (
    <FormDialog
      {...dialogProps}
      open={open}
      title="新建商户"
      description="同时开通一个商户账号。第一阶段商户不能登录，也不会发送通知邮件。"
      submitLabel="创建商户"
    >
      <FieldGroup>
        <form.AppField name="name" validators={{ onBlur: validateName, onSubmit: validateName }}>
          {(field) => (
            <field.TextField
              label="名称"
              maxLength={100}
              placeholder="例如 Onne 商户"
              description="仅管理员可见，之后可以修改。"
            />
          )}
        </form.AppField>
        <form.AppField name="email" validators={{ onBlur: validateEmail, onSubmit: validateEmail }}>
          {(field) => (
            <field.TextField
              label="商户邮箱"
              type="email"
              placeholder="merchant@example.com"
              description="全平台唯一，创建后不能修改。"
            />
          )}
        </form.AppField>
        <form.AppField name="slug" validators={{ onBlur: validateSlug, onSubmit: validateSlug }}>
          {(field) => (
            <field.TextField
              label="收款链接 slug"
              className="font-mono"
              placeholder="例如 onne"
              description="3–32 位，小写字母开头，仅含小写字母、数字、连字符。创建后不可修改。"
            />
          )}
        </form.AppField>
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
  const disabling = merchant?.enabled ?? false;
  const { dialogProps } = useWriteDialog({
    mutationFn: () =>
      adminApi.updateMerchant({
        params: { merchantId: merchant!.id },
        payload: { enabled: !disabling },
      }),
    toast: (updated) => ({
      title: updated.enabled ? "商户已恢复" : "商户已停用",
      description: updated.name,
    }),
    onClose,
  });
  if (!merchant) return null;
  return (
    <FormDialog
      {...dialogProps}
      open
      title={disabling ? `停用「${merchant.name}」？` : `恢复「${merchant.name}」？`}
      description={
        disabling
          ? "将同时禁用商户账号、停止新开票并注销全部会话。已发出的 invoice 仍会到账入账并可结算，历史记录保留。"
          : `同时恢复商户账号和收款，/${merchant.slug} 可以再次开票。第一阶段商户仍不能登录。`
      }
      submitLabel={disabling ? "停用" : "恢复"}
      destructive={disabling}
    />
  );
}
