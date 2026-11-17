import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, Mail, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@btc-lightning-pay/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@btc-lightning-pay/ui/components/input-group";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@btc-lightning-pay/ui/components/input-otp";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { authClient } from "../../lib/auth/client";

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "请输入有效的邮箱地址。", pattern: z.regexes.html5Email })),
});
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, "请输入六位数字验证码。") });
const slots = [0, 1, 2, 3, 4, 5];

export function SignInPage() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<"send" | "verify" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(0);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  useEffect(() => {
    if (step === "code" && !pending) codeInput.current?.focus();
  }, [step, pending]);
  function startCooldown() {
    const current = Date.now();
    setNow(current);
    setDeadline(current + 60_000);
  }
  async function sendCode(address: string) {
    if (lock.current || Date.now() < deadline) return;
    lock.current = true;
    setPending("send");
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      });
      if (result.error) {
        if (result.error.status === 429) startCooldown();
        setError(
          result.error.status === 429
            ? "请求过于频繁，请稍后重新发送。"
            : "验证码发送失败，请稍后重试或联系管理员。",
        );
        return;
      }
      setEmail(address);
      codeForm.reset();
      setStep("code");
      startCooldown();
    } catch {
      setError("无法连接登录服务，请稍后重试。");
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  const emailForm = useForm({
    defaultValues: { email: "" },
    validators: { onSubmit: emailSchema },
    onSubmit: async ({ value }) => sendCode(value.email.trim().toLowerCase()),
  });
  const codeForm = useForm({
    defaultValues: { code: "" },
    validators: { onSubmit: codeSchema },
    onSubmit: async ({ value }) => {
      if (lock.current) return;
      lock.current = true;
      setPending("verify");
      setError("");
      try {
        const result = await authClient.signIn.emailOtp({ email, otp: value.code });
        if (result.error) {
          setError(
            result.error.status === 429
              ? "验证过于频繁，请稍后重试。"
              : result.error.status >= 500
                ? "登录服务暂时不可用，请稍后重试。"
                : "验证码无效、已过期或尝试次数过多，请重新获取。",
          );
          codeForm.reset();
          return;
        }
        await queryClient.cancelQueries();
        queryClient.clear();
        router.clearCache();
        await router.navigate({ to: "/", replace: true });
      } catch {
        setError("无法完成登录，请稍后重试。");
      } finally {
        lock.current = false;
        setPending(null);
      }
    },
  });
  const isCode = step === "code";
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <section aria-labelledby="sign-in-title" className="flex w-full max-w-86 flex-col gap-7">
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Zap className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              BTC Lightning Pay
            </p>
            <h1 id="sign-in-title" className="text-2xl font-semibold tracking-tight">
              {isCode ? "查看你的邮箱" : "欢迎回来"}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {isCode ? "输入六位验证码，完成安全登录。" : "使用已开通的邮箱登录。"}
            </p>
          </div>
        </div>
        <div
          key={step}
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-150"
        >
          {isCode ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                void codeForm.handleSubmit();
              }}
            >
              <p role="status" className="text-center text-sm leading-6 text-muted-foreground">
                如果 <span className="break-all font-medium text-foreground">{email}</span>{" "}
                已开通，验证码将发送到该邮箱，5 分钟内有效。
              </p>
              <codeForm.Field name="code">
                {(field) => {
                  const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={invalid} className="items-center">
                      <FieldLabel htmlFor="code" className="sr-only">
                        六位验证码
                      </FieldLabel>
                      <InputOTP
                        ref={codeInput}
                        id="code"
                        name="code"
                        maxLength={6}
                        pattern="^[0-9]*$"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={field.state.value}
                        onChange={field.handleChange}
                        onBlur={field.handleBlur}
                        onComplete={(code) => {
                          field.handleChange(code);
                          void codeForm.handleSubmit();
                        }}
                        disabled={pending !== null}
                        aria-invalid={invalid}
                        aria-describedby={invalid ? "code-error" : undefined}
                        containerClassName="justify-center motion-reduce:[&_*]:animate-none"
                      >
                        <InputOTPGroup>
                          {slots.map((index) => (
                            <InputOTPSlot
                              key={index}
                              index={index}
                              className="size-11 text-lg"
                              aria-invalid={invalid}
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                      {invalid && (
                        <FieldError
                          id="code-error"
                          errors={field.state.meta.errors}
                          className="text-center"
                        />
                      )}
                    </Field>
                  );
                }}
              </codeForm.Field>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                size="lg"
                type="submit"
                disabled={pending !== null}
                aria-busy={pending === "verify"}
              >
                {pending === "verify" && (
                  <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
                )}
                {pending === "verify" ? "正在验证…" : "验证并登录"}
              </Button>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => {
                    setStep("email");
                    setError("");
                    codeForm.reset();
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                  更换邮箱
                </Button>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={pending !== null || remaining > 0}
                  onClick={() => void sendCode(email)}
                >
                  {remaining > 0
                    ? `${remaining} 秒后重发`
                    : pending === "send"
                      ? "正在发送…"
                      : "重新发送"}
                </Button>
              </div>
            </form>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void emailForm.handleSubmit();
              }}
            >
              <FieldGroup className="gap-5">
                <emailForm.Field name="email">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
                        <InputGroup>
                          <InputGroupAddon aria-hidden="true">
                            <Mail />
                          </InputGroupAddon>
                          <InputGroupInput
                            id="email"
                            name="email"
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="you@example.com"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.currentTarget.value)}
                            onBlur={field.handleBlur}
                            disabled={pending !== null}
                            aria-invalid={invalid}
                            aria-describedby={invalid ? "email-error" : undefined}
                          />
                        </InputGroup>
                        {invalid && (
                          <FieldError id="email-error" errors={field.state.meta.errors} />
                        )}
                      </Field>
                    );
                  }}
                </emailForm.Field>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button
                  size="lg"
                  type="submit"
                  disabled={pending !== null || remaining > 0}
                  aria-busy={pending === "send"}
                >
                  {pending === "send" && (
                    <Spinner aria-hidden="true" className="motion-reduce:animate-none" />
                  )}
                  {pending === "send"
                    ? "正在发送…"
                    : remaining > 0
                      ? `${remaining} 秒后可发送`
                      : "发送验证码"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </div>
        <p className="text-center text-xs leading-5 text-muted-foreground">
          仅限已开通账号。需要访问权限，请联系管理员。
        </p>
      </section>
    </main>
  );
}
