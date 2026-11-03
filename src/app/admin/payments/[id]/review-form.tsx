"use client";

import { useActionState } from "react";
import { primaryButtonClass, secondaryButtonClass } from "@/components/form-classes";
import { useRefreshAfterAction } from "@/components/refresh-after-action";
import type { AdminActionState } from "@/lib/admin/action-state";
import { reviewOrangeTransferAction } from "./review-actions";

const initial: AdminActionState = {};

export function OrangeReviewForm({ paymentId, reference, wallet }: { paymentId: string; reference: string; wallet: string }) {
  const [state, action, pending] = useActionState(reviewOrangeTransferAction, initial);
  useRefreshAfterAction(state.message);
  return (
    <form action={action} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-5">
      <h2 className="text-lg font-semibold text-brand-navy">Confirm the {wallet} transfer</h2>
      <p className="text-sm leading-6 text-brand-muted">
        The patient reported transaction <strong>{reference}</strong>. Check that this amount arrived on the clinic {wallet} number, then confirm it. The PIN is never stored.
      </p>
      <input type="hidden" name="paymentId" value={paymentId} />
      <div className="flex flex-wrap gap-2">
        <button className={primaryButtonClass} disabled={pending} name="decision" value="confirm" type="submit">
          {pending ? "Saving…" : "Confirm payment received"}
        </button>
        <button className={secondaryButtonClass} disabled={pending} name="decision" value="reject" type="submit">
          We did not receive this
        </button>
      </div>
      {state.message ? <p role={state.tone === "error" ? "alert" : "status"}>{state.message}</p> : null}
    </form>
  );
}
