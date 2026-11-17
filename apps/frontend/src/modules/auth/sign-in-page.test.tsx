import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { SignInPage } from "./sign-in-page";
import { AccountHeader } from "./account-header";

const { send, verify, signOut, navigate, clearCache } = vi.hoisted(() => ({
  send: vi.fn(),
  verify: vi.fn(),
  signOut: vi.fn(),
  navigate: vi.fn(),
  clearCache: vi.fn(),
}));
vi.mock("../../lib/auth/client", () => ({
  authClient: { emailOtp: { sendVerificationOtp: send }, signIn: { emailOtp: verify }, signOut },
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate, clearCache }) }));
beforeEach(() => {
  vi.clearAllMocks();
  send.mockReset();
  verify.mockReset();
  signOut.mockReset();
  navigate.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});
function mount(children = <SignInPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  return client;
}
async function requestCode(user: ReturnType<typeof userEvent.setup>, email = "User@Example.com") {
  await user.type(screen.getByLabelText("邮箱地址"), email);
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
}
test("invalid emails never send; delivery errors remain recoverable and do not expose raw errors", async () => {
  mount();
  const user = userEvent.setup();
  await requestCode(user, "invalid");
  expect(await screen.findByText("请输入有效的邮箱地址。")).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("邮箱地址"));
  send.mockResolvedValueOnce({ error: { status: 503, message: "private backend details" } });
  await requestCode(user);
  expect(await screen.findByText("验证码发送失败，请稍后重试或联系管理员。")).toBeTruthy();
  expect(screen.queryByText("private backend details")).toBeNull();
  expect(screen.getByRole("button", { name: "发送验证码" }).hasAttribute("disabled")).toBe(false);
});
test("sending disables duplicate requests and normalizes email", async () => {
  let finish!: (value: unknown) => void;
  send.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const user = userEvent.setup();
  await requestCode(user);
  const pending = await screen.findByRole("button", { name: "正在发送…" });
  expect(pending.hasAttribute("disabled")).toBe(true);
  await user.click(pending);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith({ email: "user@example.com", type: "sign-in" });
  await act(async () => finish({ error: null }));
  expect(await screen.findByLabelText("六位验证码")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("如果 user@example.com 已开通");
});
test("pasting six digits submits once, clears private cache and returns home", async () => {
  send.mockResolvedValue({ error: null });
  verify.mockResolvedValue({ error: null });
  const client = mount();
  client.setQueryData(["private", "previous-user"], "private data");
  const user = userEvent.setup();
  await requestCode(user);
  await screen.findByLabelText("六位验证码");
  await user.paste("123456");
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
  expect(verify).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledWith({ email: "user@example.com", otp: "123456" });
  expect(client.getQueryData(["private", "previous-user"])).toBeUndefined();
  expect(clearCache).toHaveBeenCalled();
});
test("invalid OTP stays on the code step and can be retried", async () => {
  send.mockResolvedValue({ error: null });
  verify.mockResolvedValueOnce({ error: { status: 400 } }).mockResolvedValueOnce({ error: null });
  mount();
  const user = userEvent.setup();
  await requestCode(user);
  await screen.findByLabelText("六位验证码");
  await user.paste("123456");
  expect(await screen.findByText("验证码无效、已过期或尝试次数过多，请重新获取。")).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  await user.paste("654321");
  await waitFor(() => expect(navigate).toHaveBeenCalled());
});
test("resend cooldown survives changing email and becomes available after elapsed time", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  send.mockResolvedValue({ error: null });
  mount();
  const user = userEvent.setup();
  await requestCode(user);
  await screen.findByLabelText("六位验证码");
  expect(screen.getByRole("button", { name: "60 秒后重发" }).hasAttribute("disabled")).toBe(true);
  await user.click(screen.getByRole("button", { name: "更换邮箱" }));
  expect(screen.getByRole("button", { name: "60 秒后可发送" }).hasAttribute("disabled")).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });
  await user.click(screen.getByRole("button", { name: "发送验证码" }));
  expect(send).toHaveBeenCalledTimes(2);
});
test("rate limiting displays a cooldown while leaving email editable", async () => {
  send.mockResolvedValue({ error: { status: 429 } });
  mount();
  const user = userEvent.setup();
  await requestCode(user);
  expect(await screen.findByText("请求过于频繁，请稍后重新发送。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "60 秒后可发送" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByLabelText("邮箱地址").hasAttribute("disabled")).toBe(false);
});
test("logout only clears cache and redirects after server success", async () => {
  signOut.mockResolvedValueOnce({ error: { status: 503 } }).mockResolvedValueOnce({ error: null });
  const client = mount(
    <AccountHeader user={{ id: "u1", name: "Test User", email: "user@example.com" }} />,
  );
  client.setQueryData(["private"], "data");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "退出登录" }));
  expect(await screen.findByText("退出失败，请稍后重试。")).toBeTruthy();
  expect(client.getQueryData(["private"])).toBe("data");
  expect(navigate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/sign-in", replace: true }));
  expect(client.getQueryData(["private"])).toBeUndefined();
});
