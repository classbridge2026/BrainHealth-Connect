"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { primaryButtonClass, textAreaClass, textInputClass } from "@/components/form-classes";
import { submitSupportRequestAction, type SupportFormState } from "@/app/support/actions";
import { useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { SUPPORT_CATEGORIES } from "@/lib/support/request";

const initial: SupportFormState = {};

export function SupportRequestForm({ onSubmitted }: { onSubmitted?: (message: string) => void }) {
  const [state, action, pending] = useActionState(submitSupportRequestAction, initial);
  useOutcomeAlert(state.message, pending, state.tone === "ok" ? "ok" : "error");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const notified = useRef(false);
  useEffect(() => {
    if (state.tone === "ok" && state.message && onSubmitted && !notified.current) {
      notified.current = true;
      onSubmitted(state.message);
    }
  }, [onSubmitted, state.message, state.tone]);
  if (state.tone === "ok") {
    if (onSubmitted) return null;
    return (
      <p role="status" className="rounded-xl bg-[#e7f3f1] px-4 py-3 text-sm leading-6 text-[#0b5f59]">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="grid gap-4">
      <label className="text-sm font-medium text-brand-navy">
        Email address
        <input name="email" type="email" required maxLength={120} autoComplete="email" placeholder="you@email.com" value={email} onChange={(event) => setEmail(event.target.value)} className={`${textInputClass} mt-1`} />
      </label>
      <label className="text-sm font-medium text-brand-navy">
        Issue category
        <select name="category" required value={category} onChange={(event) => setCategory(event.target.value)} className={`${textInputClass} mt-1`}>
          <option value="" disabled>
            Choose an issue
          </option>
          {SUPPORT_CATEGORIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium text-brand-navy">
        Description
        <textarea name="description" required minLength={10} maxLength={2000} rows={5} placeholder="Explain what happened and what you already tried." value={description} onChange={(event) => setDescription(event.target.value)} className={`${textAreaClass} mt-1`} />
      </label>
      <label className="text-sm font-medium text-brand-navy">
        Screenshot
        <span className="mt-1 block text-sm font-normal text-brand-muted">Optional. JPEG, PNG, or WebP, up to 2 MB.</span>
        <input name="attachment" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="mt-2 block w-full text-sm text-brand-ink file:mr-3 file:rounded-lg file:border-0 file:bg-brand-ice file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-navy" />
      </label>
      <div>
        <button className={`${primaryButtonClass} w-full sm:w-auto`} disabled={pending} type="submit">
          {pending ? "Sending…" : "Submit request"}
        </button>
      </div>
      {state.message ? (
        <p role="alert" className="rounded-xl bg-[#fde8ea] px-4 py-3 text-sm leading-6 text-brand-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
