import { afterEach, expect, test, vi } from "vite-plus/test";
import { createOTPSender } from "./email";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
afterEach(() => {
  send.mockReset();
  vi.restoreAllMocks();
});
const sender = createOTPSender({
  emailDelivery: { mode: "resend", apiKey: "test-key", from: "login@example.com" },
});
test("Resend receives the code as text and HTML from the configured sender", async () => {
  send.mockResolvedValue({ error: null });
  await sender({ email: "user@example.com", otp: "012345" });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "login@example.com",
      to: "user@example.com",
      text: expect.stringContaining("012345"),
      html: expect.stringContaining("012345"),
    }),
  );
});
test("delivery failures propagate and generated HTML accepts only numeric codes", async () => {
  send.mockResolvedValue({ error: { message: "sensitive provider details" } });
  await expect(sender({ email: "user@example.com", otp: "123456" })).rejects.toThrow(
    "Verification email delivery failed",
  );
  send.mockClear();
  await expect(sender({ email: "user@example.com", otp: "<script>" })).rejects.toThrow(
    "Invalid generated code",
  );
  expect(send).not.toHaveBeenCalled();
});

test("local console delivery prints the code without calling Resend", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const localSender = createOTPSender({ emailDelivery: { mode: "console" } });
  await localSender({ email: "user@example.com", otp: "012345" });
  expect(log).toHaveBeenCalledWith(
    "[auth] Local sign-in code for user@example.com: 012345 (expires in 5 minutes)",
  );
  expect(send).not.toHaveBeenCalled();
  log.mockClear();
  await expect(localSender({ email: "user@example.com", otp: "invalid" })).rejects.toThrow();
  expect(log).not.toHaveBeenCalled();
});

test("Resend delivery errors never fall back to console output", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  send.mockResolvedValue({ error: { message: "delivery failure" } });
  await expect(sender({ email: "user@example.com", otp: "123456" })).rejects.toThrow();
  expect(log).not.toHaveBeenCalled();
});
