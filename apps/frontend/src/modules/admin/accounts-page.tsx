import { Badge } from "@btc-lightning-pay/ui/components/badge";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@btc-lightning-pay/ui/components/table";
import { ToggleGroup, ToggleGroupItem } from "@btc-lightning-pay/ui/components/toggle-group";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import {
  AdminApiError,
  adminApi,
  describeAdminError,
  type ManagedUserData,
} from "../../lib/api/admin";
import { formatBeijing } from "../../lib/format";
import { ConfirmDialog, EmptyRow, ErrorState, ListPagination, LoadingRows } from "./common";
import { useMerchantNames } from "./merchant-select";
import { AdminPage } from "./shell";

type Role = "all" | "admin" | "merchant";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AccountsPage({ currentUserId }: { currentUserId: string }) {
  const [role, setRole] = useState<Role>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<ManagedUserData | null>(null);
  const merchants = useMerchantNames();
  const query = {
    limit: pageSize + 1,
    offset: (page - 1) * pageSize,
    role: role === "all" ? undefined : role,
  };
  const users = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: ({ signal }) => adminApi.users(query, signal),
    placeholderData: keepPreviousData,
  });
  const rows = users.data?.slice(0, pageSize) ?? [];

  return (
    <AdminPage
      crumbs={[{ label: "账号" }]}
      title="账号"
      description="只有启用的管理员能用邮箱验证码登录，所有管理员权限相同。商户账号随商户创建，第一阶段不能登录。"
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus data-icon="inline-start" aria-hidden="true" />
          新建管理员
        </Button>
      }
    >
      <section aria-label="账号列表" className="flex flex-col gap-3">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="角色"
          value={[role]}
          onValueChange={(values) => {
            const next = values[0] as Role | undefined;
            if (next) {
              setRole(next);
              setPage(1);
            }
          }}
        >
          <ToggleGroupItem value="all">全部</ToggleGroupItem>
          <ToggleGroupItem value="admin">管理员</ToggleGroupItem>
          <ToggleGroupItem value="merchant">商户</ToggleGroupItem>
        </ToggleGroup>
        {users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="pl-4">名称</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>关联商户</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="pr-4 text-right">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.isPending ? (
                  <LoadingRows columns={7} />
                ) : rows.length === 0 ? (
                  <EmptyRow columns={7}>没有账号。</EmptyRow>
                ) : (
                  rows.map((user) => {
                    const merchant = user.merchantId ? merchants.get(user.merchantId) : undefined;
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="pl-4 font-medium">
                          {user.name}
                          {user.id === currentUserId ? (
                            <span className="font-normal text-muted-foreground">（你）</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{user.email}</TableCell>
                        <TableCell>
                          {user.role === "admin" ? (
                            <Badge>管理员</Badge>
                          ) : (
                            <Badge variant="outline">商户</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.banned ? (
                            <Badge variant="secondary">已禁用</Badge>
                          ) : (
                            <Badge variant="success">正常</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {user.merchantId ? (
                            <Link
                              to="/merchants/$merchantId"
                              params={{ merchantId: user.merchantId }}
                              className="underline-offset-4 hover:underline"
                            >
                              {merchant ? `${merchant.name} · /${merchant.slug}` : "查看商户"}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">
                          {formatBeijing(user.createdAt, false)}
                        </TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button variant="outline" size="sm" onClick={() => setTarget(user)}>
                            {user.banned ? "恢复" : "禁用"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          hasNext={(users.data?.length ?? 0) > pageSize}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </section>
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
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "" });
  const [touched, setTouched] = useState(false);
  const create = useMutation({
    mutationFn: adminApi.createAdmin,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      close();
    },
  });
  function close() {
    setForm({ name: "", email: "" });
    setTouched(false);
    create.reset();
    onOpenChange(false);
  }
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();
  const nameError = !name ? "请填写名称。" : name.length > 100 ? "名称最多 100 个字符。" : "";
  const emailTaken = create.error instanceof AdminApiError && create.error.code === "EMAIL_EXISTS";
  const emailError = emailTaken
    ? describeAdminError(create.error)
    : !email
      ? "请填写登录邮箱。"
      : !EMAIL.test(email)
        ? "邮箱格式不正确。"
        : "";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="新建管理员"
      description="新管理员与你权限相同。不会发送邀请邮件，对方用该邮箱请求验证码即可登录。"
      confirmLabel="创建管理员"
      pending={create.isPending}
      error={create.isError && !emailTaken ? describeAdminError(create.error) : undefined}
      onConfirm={() => {
        setTouched(true);
        if (!nameError && !emailError) create.mutate({ name, email });
      }}
    >
      <FieldGroup>
        <Field data-invalid={touched && nameError ? true : undefined}>
          <FieldLabel htmlFor="admin-name">名称</FieldLabel>
          <Input
            id="admin-name"
            value={form.name}
            maxLength={100}
            aria-invalid={touched && nameError ? true : undefined}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          {touched && nameError ? <FieldError>{nameError}</FieldError> : null}
        </Field>
        <Field data-invalid={(touched || emailTaken) && emailError ? true : undefined}>
          <FieldLabel htmlFor="admin-email">登录邮箱</FieldLabel>
          <Input
            id="admin-email"
            type="email"
            value={form.email}
            aria-invalid={(touched || emailTaken) && emailError ? true : undefined}
            onChange={(event) => {
              setForm({ ...form, email: event.target.value });
              if (emailTaken) create.reset();
            }}
          />
          {(touched || emailTaken) && emailError ? (
            <FieldError>{emailError}</FieldError>
          ) : (
            <FieldDescription>全平台唯一，创建后不能修改；角色也不能再转换。</FieldDescription>
          )}
        </Field>
      </FieldGroup>
    </ConfirmDialog>
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
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (input: { id: string; banned: boolean }) =>
      adminApi.updateUser(input.id, { banned: input.banned }),
    onSuccess: async (_, input) => {
      // Disabling yourself revokes this session; leave for the sign-in page instead of failing requests.
      if (input.banned && input.id === currentUserId) {
        window.location.assign("/sign-in");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      update.reset();
      onClose();
    },
  });
  if (!user) return null;
  const banning = !user.banned;
  const self = user.id === currentUserId;
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
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          update.reset();
          onClose();
        }
      }}
      title={title}
      description={description}
      confirmLabel={banning ? "禁用" : "恢复"}
      destructive={banning}
      pending={update.isPending}
      error={
        update.error instanceof AdminApiError && update.error.code === "LAST_ADMIN"
          ? "不能禁用最后一位启用的管理员。请先新建或恢复另一位管理员。"
          : update.isError
            ? describeAdminError(update.error)
            : undefined
      }
      onConfirm={() => update.mutate({ id: user.id, banned: banning })}
    />
  );
}
