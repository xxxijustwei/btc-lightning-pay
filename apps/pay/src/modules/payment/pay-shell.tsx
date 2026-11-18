import { ShieldCheck, Zap } from "lucide-react";
import type { ReactNode } from "react";

/** Mobile-first frame shared by every payer screen: secure badge on top, wallet note at the bottom. */
export function PayShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh justify-center bg-pay-surface">
      <main className="flex w-full max-w-[430px] flex-col gap-4 bg-white px-[18px] pt-4 pb-5 font-sans text-pay-ink">
        <div className="flex justify-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-pay-pill px-[15px] py-1.5 text-sm font-extrabold text-pay-text">
            <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={2.4} />
            Secure Payment
          </p>
        </div>
        {children}
        <div className="mt-auto flex flex-col gap-3">
          {footer}
          <p className="flex items-center justify-center gap-1.5 text-[13px] font-bold text-pay-muted">
            <Zap aria-hidden="true" className="size-3.5" />
            Works with Cash App
          </p>
        </div>
      </main>
    </div>
  );
}

/** The green, pill-shaped primary action used across payer screens. */
export const primaryActionClass =
  "inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-pay-action text-[15px] font-black text-white shadow-[0_12px_24px_rgba(56,189,73,0.24)] transition-colors hover:bg-pay-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pay-action disabled:cursor-not-allowed disabled:bg-pay-line disabled:text-[#4b5563] disabled:shadow-none";
