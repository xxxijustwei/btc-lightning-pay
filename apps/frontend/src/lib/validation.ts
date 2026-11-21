import {
  AccountEmail,
  AccountName,
  CancelSettlement,
  MerchantSlug,
  NotSentPayout,
} from "@btc-lightning-pay/api";
import { Schema } from "effect";

/**
 * Field validators for admin forms. The rules come from the shared API contract (the same
 * schemas the backend enforces); only the Chinese messages live here.
 */
const isName = Schema.is(AccountName);
const isEmail = Schema.is(AccountEmail);
const isSlug = Schema.is(MerchantSlug);
const isNotSent = Schema.is(NotSentPayout);
const isReason = Schema.is(CancelSettlement);

export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export function validateName({ value }: { value: string }) {
  if (!value.trim()) return "请填写名称。";
  return isName(value.trim()) ? undefined : "名称需 1–100 个字符，不能全是空格。";
}

export function validateEmail({ value }: { value: string }) {
  const email = normalizeEmail(value);
  if (!email) return "请填写邮箱。";
  return isEmail(email) ? undefined : "邮箱格式不正确。";
}

export function validateSlug({ value }: { value: string }) {
  if (!value) return "请填写 slug。";
  return isSlug(value) ? undefined : "3–32 位，小写字母开头，仅含小写字母、数字、连字符。";
}

export function validateReason({ value }: { value: string }) {
  return isReason({ reason: value.trim() }) ? undefined : "请填写 1–500 个字符的取消原因。";
}

export function validateNotSentReason({ value }: { value: string }) {
  return isNotSent({ reason: value.trim() }) ? undefined : "请填写 1–500 个字符的原因。";
}

/** Shapes TanStack Form's string errors for shadcn's `FieldError`. */
export function fieldErrors(errors: readonly unknown[]) {
  return errors.filter(Boolean).map((error) => ({ message: String(error) }));
}
