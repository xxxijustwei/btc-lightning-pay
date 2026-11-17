import { afterEach, expect, test, vi } from "vite-plus/test";
import { createOTPSender } from "./email";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
afterEach(() => send.mockReset());
const sender = createOTPSender({ apiKey: "test-key", from: "login@example.com" });
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
