import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { FieldGroup } from "@btc-lightning-pay/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { DataTable, DataTablePagination } from "../../components/data-table/data-table";
import { createAppColumnHelper, useAppTable } from "../../components/data-table/table-hook";
import { adminApi, type ManagedUserData } from "../../lib/api/admin";
import { formatBeijing } from "../../lib/format";
import { accountsSearch, paginationState, paginationUpdate } from "../../lib/list-search";
import { normalizeEmail, validateEmail, validateName } from "../../lib/validation";
import { ErrorState } from "./common";
import { FormDialog } from "./form-dialog";
import { MerchantCell } from "./merchant-select";
import { AdminPage } from "./shell";
import { useWriteDialog } from "./write-dialog";

const helper = createAppColumnHelper<ManagedUserData>();
const noRows: ManagedUserData[] = [];

export function AccountsPage({ currentUserId }: { currentUserId: string }) {
  const [search, setSearch] = useQueryStates(accountsSearch);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<ManagedUserData | null>(null);
  const pagination = paginationState(search);
  const query = {
    // One extra row tells whether a next page exists; the API returns no total.
    limit: search.size + 1,
    offset: search.page * search.size,
    role: search.role ?? undefined,
  };
  const users = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: ({ signal }) => adminApi.users({ query }, { signal }),
    placeholderData: keepPreviousData,
  });
  const fetched = users.data ?? noRows;
  const hasNext = fetched.length > search.size;
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("name", {
          header: "名称",
          meta: { cellClassName: "font-medium" },
          cell: ({ getValue, row }) => (
            <>
              {getValue()}
              {row.original.id === currentUserId ? (
                <span className="font-normal text-muted-foreground">（你）</span>
              ) : null}
            </>
          ),
        }),
        helper.accessor("email", {
          header: "邮箱",
          meta: { cellClassName: "text-muted-foreground" },
        }),
        helper.accessor("role", {
          header: "角色",
          cell: ({ getValue }) =>
            getValue() === "admin" ? <Badge>管理员</Badge> : <Badge variant="outline">商户</Badge>,
        }),
        helper.accessor("banned", {
          header: "状态",
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant="secondary">已禁用</Badge>
            ) : (
              <Badge variant="success">正常</Badge>
            ),
        }),
        helper.accessor("merchantId", {
          header: "关联商户",
          cell: ({ getValue }) => {
            const merchantId = getValue();
            return merchantId ? (
              <MerchantCell merchantId={merchantId} />
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          },
        }),
        helper.accessor("createdAt", {
          header: "创建时间",
          meta: { cellClassName: "text-muted-foreground tabular-nums" },
          cell: ({ getValue }) => formatBeijing(getValue(), false),
        }),
        helper.display({
          id: "actions",
          header: () => <span className="sr-only">操作</span>,
          meta: { headerClassName: "text-right", cellClassName: "text-right" },
          // A merchant's account follows its merchant; it is enabled or disabled there.
          cell: ({ row }) =>
            row.original.role === "merchant" ? null : (
              <Button variant="outline" size="sm" onClick={() => setTarget(row.original)}>
                {row.original.banned ? "恢复" : "禁用"}
              </Button>
            ),
        }),
      ]),
    [currentUserId],
  );
  const table = useAppTable({
    columns,
    data: hasNext ? fetched.slice(0, search.size) : fetched,
    getRowId: (user) => user.id,
    manualPagination: true,
    pageCount: search.page + (hasNext ? 2 : 1),
    state: { pagination },
    onPaginationChange: (updater) => void setSearch(paginationUpdate(pagination, updater)),
    meta: { totalKnown: false, emptyMessage: "没有账号。" },
  });

  return (
    <AdminPage
      crumbs={[{ label: "账号" }]}
      title="账号"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          新建管理员
        </Button>
      }
    >
      <table.AppTable>
        <section aria-label="账号列表" className="flex flex-col gap-3">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="角色"
            value={[search.role ?? "all"]}
            onValueChange={(values) => {
              const next = values[0] as "all" | "admin" | "merchant" | undefined;
              if (next) void setSearch({ role: next === "all" ? null : next, page: null });
            }}
          >
            <ToggleGroupItem value="all">全部</ToggleGroupItem>
            <ToggleGroupItem value="admin">管理员</ToggleGroupItem>
            <ToggleGroupItem value="merchant">商户</ToggleGroupItem>
          </ToggleGroup>
          {users.isError ? (
            <ErrorState error={users.error} onRetry={() => void users.refetch()} />
          ) : (
            <DataTable loading={users.isPending} />
          )}
          <DataTablePagination />
        </section>
      </table.AppTable>
      <CreateAdminDialog open={creating} onOpenChange={setCreating} />
      <BanDialog user={target} currentUserId={currentUserId} onClose={() => setTarget(null)} />
    </AdminPage>
  );
}

function CreateAdminDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { name: "", email: "" },
    mutationFn: (value) =>
      adminApi.createAdmin({
        payload: { name: value.name.trim(), email: normalizeEmail(value.email) },
      }),
    toast: (admin) => ({ title: "管理员已创建", description: admin.email }),
    fieldConflicts: { EMAIL_EXISTS: "email" },
    onClose: () => onOpenChange(false),
  });
  return (
    <FormDialog
      {...dialogProps}
      open={open}
      title="新建管理员"
      description="新管理员与你权限相同。不会发送邀请邮件，对方用该邮箱请求验证码即可登录。"
      submitLabel="创建管理员"
    >
      <FieldGroup>
        <form.AppField name="name" validators={{ onBlur: validateName, onSubmit: validateName }}>
          {(field) => <field.TextField label="名称" maxLength={100} />}
        </form.AppField>
        <form.AppField name="email" validators={{ onBlur: validateEmail, onSubmit: validateEmail }}>
          {(field) => (
            <field.TextField
              label="登录邮箱"
              type="email"
              description="全平台唯一，创建后不能修改；角色也不能再转换。"
            />
          )}
        </form.AppField>
      </FieldGroup>
    </FormDialog>
  );
}

function BanDialog({
  user,
  currentUserId,
  onClose,
}: {
  user: ManagedUserData | null;
  currentUserId: string;
  onClose: () => void;
}) {
  const banning = user ? !user.banned : false;
  const self = user?.id === currentUserId;
  const { dialogProps } = useWriteDialog({
    mutationFn: () =>
      adminApi.updateUser({ params: { userId: user!.id }, payload: { banned: banning } }),
    toast: (updated) => ({
      title: updated.banned ? "账号已禁用" : "账号已恢复",
      description: updated.email,
    }),
    onSuccess: (updated) => {
      // Disabling yourself revokes this session; leave for the sign-in page instead of failing requests.
      if (updated.banned && self) {
        window.location.assign("/sign-in");
        return "handled";
      }
    },
    onClose,
  });
  if (!user) return null;
  let title = "";
  let description = "";
  if (!banning) {
    title =
      user.role === "admin" ? `恢复管理员「${user.name}」？` : `恢复商户账号「${user.name}」？`;
    description =
      user.role === "admin"
        ? "恢复后对方可以再次用邮箱验证码登录，旧会话不会恢复。"
        : "同时恢复该商户的收款。第一阶段商户仍不能登录。";
  } else if (user.role === "admin") {
    title = `禁用管理员「${user.name}」${self ? "（你自己）" : ""}？`;
    description = `将立即注销该账号的全部会话，之后不能再登录。${self ? "禁用自己后你会被登出。" : ""}`;
  } else {
    title = `禁用商户账号「${user.name}」？`;
    description =
      "等同于停用该商户：禁用账号、停止新开票并注销会话。已发出的 invoice 仍会到账入账并可结算。";
  }
  return (
    <FormDialog
      {...dialogProps}
      open
      title={title}
      description={description}
      submitLabel={banning ? "禁用" : "恢复"}
      destructive={banning}
    />
  );
}
