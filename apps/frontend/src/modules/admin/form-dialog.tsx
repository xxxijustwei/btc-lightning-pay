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
import type { ReactNode } from "react";

/**
 * Dialog wrapping a TanStack Form: submit runs `form.handleSubmit`, the dialog stays open
 * while submitting, and an error that belongs to no field shows above the actions.
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
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  destructive?: boolean;
  submitting: boolean;
  error?: string;
  onSubmit: () => void;
  children: ReactNode;
}) {
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
          {children}
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
