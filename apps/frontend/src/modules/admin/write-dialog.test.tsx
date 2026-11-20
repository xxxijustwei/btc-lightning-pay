import { Toaster } from "@btc-lightning-pay/ui/components/toast";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vite-plus/test";
import { adminApi } from "../../lib/api/admin";
import { FormDialog } from "./form-dialog";
import { CreateMerchantDialog } from "./merchants-page";
import { useWriteDialog } from "./write-dialog";

const ADMIN = {
  id: "u2",
  name: "Ann",
  email: "ann@example.com",
  role: "admin",
  banned: false,
  merchantId: null,
  createdAt: "2026-11-17T10:05:12.348Z",
};
const problem = (code: string, status: number) =>
  Response.json({ code, message: code }, { status });

/** Routes each request to the next queued answer. */
function stubFetch(...answers: Array<() => Response | Promise<Response>>) {
  const fetchMock = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error("Unexpected request");
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mount(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Stands for any admin data on screen; a successful write must mark it stale.
  client.setQueryData(["admin", "merchants", "all"], []);
  render(
    <QueryClientProvider client={client}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}
const isStale = (client: QueryClient) =>
  client.getQueryState(["admin", "merchants", "all"])?.isInvalidated;

function AdminDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess?: () => "handled" | void;
}) {
  const { form, dialogProps } = useWriteDialog({
    defaultValues: { email: "" },
    mutationFn: (value) => adminApi.createAdmin({ payload: { name: "Ann", email: value.email } }),
    toast: (admin) => ({ title: "管理员已创建", description: admin.email }),
    fieldConflicts: { EMAIL_EXISTS: "email" },
    onSuccess,
    onClose,
  });
  return (
    <FormDialog {...dialogProps} open title="新建管理员" submitLabel="创建">
      <form.AppField name="email">
        {(field) => <field.TextField label="登录邮箱" description="全平台唯一。" />}
      </form.AppField>
    </FormDialog>
  );
}

test("a successful write refreshes admin data, reports through a toast and closes", async () => {
  stubFetch(() => Response.json(ADMIN, { status: 201 }));
  const onClose = vi.fn();
  const { client, user } = mount(<AdminDialog onClose={onClose} />);
  await user.type(screen.getByLabelText("登录邮箱"), "ann@example.com");
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect(await screen.findByText("管理员已创建")).toBeTruthy();
  expect(onClose).toHaveBeenCalledOnce();
  expect(isStale(client)).toBe(true);
});

test("a conflict about a field shows under it and clears once the field is edited", async () => {
  stubFetch(() => problem("EMAIL_EXISTS", 409));
  const { user } = mount(<AdminDialog onClose={vi.fn()} />);
  const email = screen.getByLabelText("登录邮箱");
  await user.type(email, "ann@example.com");
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect(await screen.findByText("该邮箱已有账号，不能绑定已有账号。")).toBeTruthy();
  expect(email.getAttribute("aria-invalid")).toBe("true");
  expect(screen.queryByText("全平台唯一。")).toBeNull();
  // The field error is the only alert: nothing repeats it above the actions.
  expect(screen.getAllByRole("alert")).toHaveLength(1);

  await user.type(email, "x");
  expect(screen.queryByText("该邮箱已有账号，不能绑定已有账号。")).toBeNull();
  expect(screen.getByText("全平台唯一。")).toBeTruthy();
});

test("a failure that belongs to no field shows above the actions and keeps the dialog open", async () => {
  stubFetch(() => problem("RATE_LIMITED", 429));
  const onClose = vi.fn();
  const { client, user } = mount(<AdminDialog onClose={onClose} />);
  await user.type(screen.getByLabelText("登录邮箱"), "ann@example.com");
  await user.click(screen.getByRole("button", { name: "创建" }));
  expect((await screen.findByRole("alert")).textContent).toContain("操作太频繁");
  expect(onClose).not.toHaveBeenCalled();
  expect(isStale(client)).toBe(false);
});

test("the dialog cannot be dismissed while the write is in flight", async () => {
  let answer: (response: Response) => void = () => {};
  stubFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
  const onClose = vi.fn();
  const { user } = mount(<AdminDialog onClose={onClose} />);
  await user.type(screen.getByLabelText("登录邮箱"), "ann@example.com");
  await user.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "取消" }).hasAttribute("disabled")).toBe(true),
  );
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();

  answer(Response.json(ADMIN, { status: 201 }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

test("onSuccess can take over and skip the refresh, toast and close", async () => {
  stubFetch(() => Response.json(ADMIN, { status: 201 }));
  const onClose = vi.fn();
  const onSuccess = vi.fn(() => "handled" as const);
  const { client, user } = mount(<AdminDialog onClose={onClose} onSuccess={onSuccess} />);
  await user.type(screen.getByLabelText("登录邮箱"), "ann@example.com");
  await user.click(screen.getByRole("button", { name: "创建" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(onClose).not.toHaveBeenCalled();
  expect(isStale(client)).toBe(false);
  expect(screen.queryByText("管理员已创建")).toBeNull();
});

test("creating a merchant puts each conflict under its own field", async () => {
  stubFetch(
    () => problem("EMAIL_EXISTS", 409),
    () => problem("MERCHANT_EXISTS", 409),
  );
  const { user } = mount(<CreateMerchantDialog open onOpenChange={vi.fn()} />);
  await user.type(screen.getByLabelText("名称"), "Onne");
  await user.type(screen.getByLabelText("商户邮箱"), "m@example.com");
  await user.type(screen.getByLabelText("收款链接 slug"), "onne");
  await user.click(screen.getByRole("button", { name: "创建商户" }));
  expect(await screen.findByText("该邮箱已有账号，不能绑定已有账号。")).toBeTruthy();
  expect(screen.getByLabelText("商户邮箱").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("收款链接 slug").getAttribute("aria-invalid")).toBeNull();

  await user.type(screen.getByLabelText("商户邮箱"), "x");
  await user.click(screen.getByRole("button", { name: "创建商户" }));
  expect(await screen.findByText("该 slug 已被使用，slug 不会回收。")).toBeTruthy();
  expect(screen.getByLabelText("收款链接 slug").getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByLabelText("商户邮箱").getAttribute("aria-invalid")).toBeNull();
});
