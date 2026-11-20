import { Alert, AlertDescription } from "@btc-lightning-pay/ui/components/alert";
import { Button } from "@btc-lightning-pay/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@btc-lightning-pay/ui/components/dialog";
import { Spinner } from "@btc-lightning-pay/ui/components/spinner";
import { CircleAlert } from "lucide-react";
import { createContext, type ReactNode } from "react";

/** Server conflicts that belong to a form field, read by the bound field components. */
export interface FieldConflicts {
  message: (field: string) => string | undefined;
  /** Called when the field is edited; the conflict no longer describes its value. */
  clear: (field: string) => void;
}
export const FieldConflictsContext = createContext<FieldConflicts | null>(null);

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  destructive?: boolean;
  submitting: boolean;
  /** An error that belongs to no field; it shows above the actions. */
  error?: string;
  onSubmit: () => void;
  fieldConflicts?: FieldConflicts;
  /** Form fields; a confirmation has none. */
  children?: ReactNode;
}

/**
 * Dialog for an admin write: submit runs `onSubmit`, the dialog stays open while submitting, and
 * an error that belongs to no field shows above the actions. `useWriteDialog` supplies the
 * behaviour props; the page supplies the copy.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive,
  submitting,
  error,
  onSubmit,
  fieldConflicts,
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children ? (
            <FieldConflictsContext value={fieldConflicts ?? null}>{children}</FieldConflictsContext>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? <Spinner aria-hidden="true" data-icon="inline-start" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
