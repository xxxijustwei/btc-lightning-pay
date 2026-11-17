import { Resend } from "resend";
import type { AuthConfig } from "./config";

export type SendOTP = (message: { email: string; otp: string }) => Promise<void>;
export const OTP_EXPIRATION_SECONDS = 300;
export function createOTPSender(config: Pick<AuthConfig, "emailDelivery">): SendOTP {
  const delivery = config.emailDelivery;
  return async ({ email, otp }) => {
    if (!/^\d{6}$/.test(otp)) throw new Error("Invalid generated code");
    if (delivery.mode === "console") {
      console.log(`[auth] Local sign-in code for ${email}: ${otp} (expires in 5 minutes)`);
      return;
    }
    const resend = new Resend(delivery.apiKey);
    const { error } = await resend.emails.send({
      from: delivery.from,
      to: email,
      subject: "BTC Lightning Pay 登录验证码",
      text: `你的登录验证码是 ${otp}，5 分钟内有效。如非本人操作，请忽略此邮件。`,
      html: `<h1>登录 BTC Lightning Pay</h1><p>你的登录验证码：</p><p style="font-size:32px;letter-spacing:6px">${otp}</p><p>5 分钟内有效。如非本人操作，请忽略此邮件。</p>`,
    });
    if (error) throw new Error("Verification email delivery failed");
  };
}
