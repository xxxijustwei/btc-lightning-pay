import { Checkbox } from "@btc-lightning-pay/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@btc-lightning-pay/ui/components/field";
import { Input } from "@btc-lightning-pay/ui/components/input";
import { Textarea } from "@btc-lightning-pay/ui/components/textarea";
import { toast } from "@btc-lightning-pay/ui/components/toast";
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useContext, useId, type ComponentProps, type ReactNode } from "react";
import { AdminApiError, describeAdminError, type AdminApiErrorCode } from "../../lib/api/admin";
import { fieldErrors } from "../../lib/validation";
import { FieldConflictsContext, type FormDialogProps } from "./form-dialog";

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

/** Validation errors plus any server conflict reported for this field. */
function useFieldErrors<TValue>() {
  const field = useFieldContext<TValue>();
  const conflicts = useContext(FieldConflictsContext);
  const conflict = conflicts?.message(field.name);
  const errors = fieldErrors([...field.state.meta.errors, conflict]);
  return {
    field,
    errors,
    invalid: errors.length ? true : undefined,
    /** An edit makes the server's answer stale, so its conflict stops showing. */
    edited: () => {
      if (conflict) conflicts?.clear(field.name);
    },
  };
}

function TextField({
  label,
  description,
  ...input
}: {
  label: string;
  description?: ReactNode;
} & Pick<ComponentProps<typeof Input>, "type" | "placeholder" | "maxLength" | "className">) {
  const { field, errors, invalid, edited } = useFieldErrors<string>();
  const id = useId();
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        {...input}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
          edited();
        }}
        aria-invalid={invalid}
      />
      {errors.length ? (
        <FieldError errors={errors} />
      ) : description ? (
        <FieldDescription>{description}</FieldDescription>
      ) : null}
    </Field>
  );
}

function TextareaField({
  label,
  description,
  ...textarea
}: {
  label: string;
  /** Static text, or text derived from the current value such as a character count. */
  description?: ReactNode | ((value: string) => ReactNode);
} & Pick<ComponentProps<typeof Textarea>, "rows" | "placeholder" | "maxLength">) {
  const { field, errors, invalid, edited } = useFieldErrors<string>();
  const id = useId();
  const hint = typeof description === "function" ? description(field.state.value) : description;
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        {...textarea}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
          edited();
        }}
        aria-invalid={invalid}
      />
      {errors.length ? (
        <FieldError errors={errors} />
      ) : hint ? (
        <FieldDescription>{hint}</FieldDescription>
      ) : null}
    </Field>
  );
}

function CheckboxField({ label }: { label: ReactNode }) {
  const { field, errors, invalid, edited } = useFieldErrors<boolean>();
  const id = useId();
  return (
    <Field orientation="horizontal" data-invalid={invalid}>
      <Checkbox
        id={id}
        checked={field.state.value}
        onCheckedChange={(checked) => {
          field.handleChange(checked === true);
          edited();
        }}
        aria-invalid={invalid}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {errors.length ? <FieldError errors={errors} /> : null}
      </div>
    </Field>
  );
}

/** TanStack Form with the admin's bound field components: `form.AppField` → `field.TextField`. */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextareaField, CheckboxField },
  formComponents: {},
});

type Values = Record<string, unknown>;

/**
 * An admin write behind a dialog. Submitting runs the mutation; success refreshes all admin data,
 * reports through a toast and closes; a failure stays in the dialog, under the field named in
 * `fieldConflicts` or above the actions. Render the result with
 * `<FormDialog {...dialogProps} title=… submitLabel=…>` and fields through `form.AppField`.
 */
export function useWriteDialog<TValues extends Values = Values, TResult = unknown>(options: {
  /** The form's fields; a confirmation without fields omits them. */
  defaultValues?: TValues;
  mutationFn: (values: TValues) => Promise<TResult>;
  toast: (result: TResult, values: TValues) => { title: string; description?: string };
  /** Server codes that describe one field's value, keyed to that field's name. */
  fieldConflicts?: Partial<Record<AdminApiErrorCode, keyof TValues & string>>;
  /**
   * Runs before the default success handling; returning `"handled"` skips the refresh, toast and
   * close (for example when the write ends this session).
   */
  onSuccess?: (
    result: TResult,
    values: TValues,
    controls: { close: () => void },
  ) => "handled" | void | Promise<"handled" | void>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation<TResult, unknown, TValues>({ mutationFn: options.mutationFn });
  const form = useAppForm({
    defaultValues: options.defaultValues ?? ({} as TValues),
    onSubmit: async ({ value }) => {
      let result: TResult;
      try {
        result = await mutation.mutateAsync(value);
      } catch {
        return; // The failure shows from mutation state.
      }
      if ((await options.onSuccess?.(result, value, { close })) === "handled") return;
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
      toast.add({ ...options.toast(result, value), type: "success" });
      close();
    },
  });

  function close() {
    form.reset();
    mutation.reset();
    options.onClose();
  }

  const code = mutation.error instanceof AdminApiError ? mutation.error.code : undefined;
  const conflictField = code ? options.fieldConflicts?.[code] : undefined;
  const dialogProps = {
    onOpenChange: (next: boolean) => {
      if (!next) close();
    },
    submitting: mutation.isPending,
    error: mutation.isError && !conflictField ? describeAdminError(mutation.error) : undefined,
    onSubmit: () => void form.handleSubmit(),
    fieldConflicts: {
      message: (field: string) =>
        field === conflictField ? describeAdminError(mutation.error) : undefined,
      clear: (field: string) => {
        if (field === conflictField) mutation.reset();
      },
    },
  } satisfies Partial<FormDialogProps>;

  return { form, dialogProps };
}
