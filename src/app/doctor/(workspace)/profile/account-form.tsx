"use client";

import { useActionState, useEffect, useState } from "react";
import { primaryButtonClass, textInputClass } from "@/components/form-classes";
import { updateOwnSignInAction, type OwnAccountState } from "./account-actions";

const initial: OwnAccountState = {};

export function OwnAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updateOwnSignInAction, initial);
  const [address, setAddress] = useState(email);
  useEffect(() => {
    setAddress(email);
  }, [email]);

  return (
    <section id="account" className="rounded-2xl border border-[#d7e3ee] bg-white p-5">
      <h2 className="text-lg font-semibold text-[#0C2B45]">Email and password</h2>
      <p className="mt-1 text-sm text-[#5b6b7c]">Save the email and password you want to use at sign-in. A new password needs a letter and a number. The next login uses these details.</p>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium text-[#0C2B45] sm:col-span-2">
          Email
          <input name="email" type="email" required autoComplete="email" maxLength={254} value={address} onChange={(event) => setAddress(event.target.value)} className={textInputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#0C2B45]">
          Current password
          <input name="currentPassword" type="password" required autoComplete="current-password" maxLength={128} className={textInputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#0C2B45]">
          New password
          <input name="nextPassword" type="password" autoComplete="new-password" maxLength={128} className={textInputClass} />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#0C2B45] sm:col-span-2">
          Confirm new password
          <input name="confirmPassword" type="password" autoComplete="new-password" maxLength={128} className={textInputClass} />
        </label>
        {state.message ? (
          <p role={state.tone === "error" ? "alert" : "status"} className={`text-sm sm:col-span-2 ${state.tone === "error" ? "text-[#9f1239]" : "text-[#0F766E]"}`}>
            {state.message}
          </p>
        ) : null}
        <div>
          <button type="submit" className={primaryButtonClass} disabled={pending}>
            {pending ? "Saving…" : "Save sign-in"}
          </button>
        </div>
      </form>
    </section>
  );
}
