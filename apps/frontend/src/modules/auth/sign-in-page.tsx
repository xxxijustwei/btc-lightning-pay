import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowLeft, ArrowRight, CircleAlert, Mail, Zap } from "lucide-react";
import { Alert, AlertDescription } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import { Card, CardContent } from "@btc-lightning-pay/ui/components/card";
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
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (step === "code" && !pending) codeInput.current?.focus();
  }, [step, pending]);
  async function sendCode(address: string) {
    if (lock.current) return;
    lock.current = true;
    setPending("send");
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      });
      if (result.error) {
        setError("验证码发送失败，请稍后重试。");
        return;
      }
      setEmail(address);
      codeForm.reset();
      setStep("code");
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
            result.error.status >= 500
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
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-12">
      <section aria-labelledby="sign-in-title" className="flex w-full max-w-100 flex-col gap-6">
        <div className="flex items-center justify-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-4" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold">Lightning Pay</span>
        </div>
        <Card>
          <CardContent
            key={step}
            className="flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-150"
          >
            {isCode ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-ml-2.5 self-start"
                  disabled={pending !== null}
                  onClick={() => {
                    setStep("email");
                    setError("");
                    codeForm.reset();
                  }}
                >
                  <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                  更换邮箱
                </Button>
                <div className="flex flex-col gap-2">
                  <h1 id="sign-in-title" className="text-xl font-semibold tracking-tight">
                    输入验证码
                  </h1>
                  <p role="status" className="text-sm leading-relaxed text-muted-foreground">
                    已发送至 <span className="font-medium break-all text-foreground">{email}</span>
                    ，5 分钟内有效。
                  </p>
                </div>
                <form
                  noValidate
                  className="flex flex-col gap-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void codeForm.handleSubmit();
                  }}
                >
                  <codeForm.Field name="code">
                    {(field) => {
                      const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                      return (
                        <Field data-invalid={invalid}>
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
                            containerClassName="w-full motion-reduce:[&_*]:animate-none"
                          >
                            <InputOTPGroup className="w-full">
                              {slots.map((index) => (
                                <InputOTPSlot
                                  key={index}
                                  index={index}
                                  className="h-12 flex-1 text-lg"
                                  aria-invalid={invalid}
                                />
                              ))}
                            </InputOTPGroup>
                          </InputOTP>
                          {invalid && (
                            <FieldError id="code-error" errors={field.state.meta.errors} />
                          )}
                        </Field>
                      );
                    }}
                  </codeForm.Field>
                  {error && (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden="true" />
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
                      <Spinner
                        data-icon="inline-start"
                        aria-hidden="true"
                        className="motion-reduce:animate-none"
                      />
                    )}
                    {pending === "verify" ? "正在验证…" : "验证并登录"}
                  </Button>
                  <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                    没收到邮件？
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-8 px-1 text-foreground underline underline-offset-4"
                      disabled={pending !== null}
                      onClick={() => void sendCode(email)}
                    >
                      {pending === "send" ? "正在发送…" : "重新发送"}
                    </Button>
                  </p>
                </form>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <h1 id="sign-in-title" className="text-xl font-semibold tracking-tight">
                    登录管理后台
                  </h1>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    输入管理员邮箱，我们会发送一个 6 位数字验证码。
                  </p>
                </div>
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
                            <InputGroup className="h-10">
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
                        <CircleAlert aria-hidden="true" />
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      size="lg"
                      type="submit"
                      disabled={pending !== null}
                      aria-busy={pending === "send"}
                    >
                      {pending === "send" && (
                        <Spinner
                          data-icon="inline-start"
                          aria-hidden="true"
                          className="motion-reduce:animate-none"
                        />
                      )}
                      {pending === "send" ? "正在发送…" : "发送验证码"}
                      {pending === "send" ? null : (
                        <ArrowRight data-icon="inline-end" aria-hidden="true" />
                      )}
                    </Button>
                  </FieldGroup>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
