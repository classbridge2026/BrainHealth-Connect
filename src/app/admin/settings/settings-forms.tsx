"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";
import { AdminIcon, type AdminIconName } from "@/components/admin/admin-icons";
import { Notice } from "@/components/admin/portal-ui";
import { primaryButtonClass, textInputClass } from "@/components/form-classes";
import type { AdminActionState } from "@/lib/admin/action-state";
import { updateAfrimoneyNumberAction, updateCurrencySettingAction, updateHoldSettingAction, updateOrangeNumberAction, updatePublicContactAction, updateSystemNameAction } from "./actions";

const initial: AdminActionState = {};

function FormNote({ state }: { state: AdminActionState }) {
  if (!state.message) return null;
  const ok = state.tone !== "error";
  return (
    <p role={ok ? "status" : "alert"} className={ok ? "rounded-lg bg-[#e7f3f1] px-3 py-2 text-sm leading-6 text-[#0b5f59]" : "rounded-lg bg-[#fde8ea] px-3 py-2 text-sm leading-6 text-brand-danger"}>
      {state.message}
    </p>
  );
}

function SettingForm({
  action,
  title,
  icon,
  intro,
  pending,
  submitLabel,
  state,
  children,
}: {
  action: (payload: FormData) => void;
  title: string;
  icon: AdminIconName;
  intro: string;
  pending: boolean;
  submitLabel: string;
  state: AdminActionState;
  children: ReactNode;
}) {
  return (
    <form action={action} className="admin-panel">
      <header className="admin-panel-head">
        <h2>
          <AdminIcon name={icon} />
          {title}
        </h2>
      </header>
      <div className="admin-panel-body grid gap-3">
        <p className="text-sm leading-6 text-brand-muted">{intro}</p>
        {children}
        <div>
          <button className={`${primaryButtonClass} w-full sm:w-auto`} disabled={pending} type="submit">
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
        <FormNote state={state} />
      </div>
    </form>
  );
}

export function SystemNameForm({ systemName }: { systemName: string }) {
  const [state, action, pending] = useActionState(updateSystemNameAction, initial);
  return (
    <SettingForm action={action} title="System name" icon="settings" pending={pending} submitLabel="Save system name" state={state} intro="This name is shown on the public site, in the patient, doctor, and administration portals, in the browser title, and in emails sent after you save.">
      <label className="text-sm font-medium text-brand-navy">
        System name
        <input name="systemName" required minLength={2} maxLength={80} defaultValue={systemName} className={`${textInputClass} mt-1`} />
      </label>
    </SettingForm>
  );
}

export function CurrencySettingForm({ currency }: { currency: string }) {
  const [state, action, pending] = useActionState(updateCurrencySettingAction, initial);
  return (
    <SettingForm action={action} title="Default currency" icon="fee" pending={pending} submitLabel="Save currency" state={state} intro="Used for new catalog prices. Existing service fees and booked appointment snapshots stay as they were.">
      <label className="text-sm font-medium text-brand-navy">
        Currency code
        <input name="currency" required maxLength={3} defaultValue={currency} className={`${textInputClass} mt-1 uppercase tracking-wide`} />
      </label>
    </SettingForm>
  );
}

export function OrangeNumberForm({ number }: { number: string }) {
  const [state, action, pending] = useActionState(updateOrangeNumberAction, initial);
  return (
    <SettingForm action={action} title="Orange Money" icon="payment" pending={pending} submitLabel="Save Orange Money number" state={state} intro="This is the number that receives visit payments. Patients dial #144*2*1*this number*amount*PIN# on their own phones. The PIN is never entered here.">
      <label className="text-sm font-medium text-brand-navy">
        Receiving number
        <input name="orangeNumber" required inputMode="tel" autoComplete="tel" defaultValue={number} placeholder="076 000 000" className={`${textInputClass} mt-1`} />
      </label>
    </SettingForm>
  );
}

export function AfrimoneyNumberForm({ number }: { number: string }) {
  const [state, action, pending] = useActionState(updateAfrimoneyNumberAction, initial);
  return (
    <SettingForm action={action} title="Afrimoney" icon="payment" pending={pending} submitLabel="Save Afrimoney number" state={state} intro="This is the Africell number that receives visit payments. Patients dial *161*1*1*this number*amount*PIN# on their own phones. The PIN is never entered here.">
      <label className="text-sm font-medium text-brand-navy">
        Receiving number
        <input name="afrimoneyNumber" required inputMode="tel" autoComplete="tel" defaultValue={number} placeholder="077 000 000" className={`${textInputClass} mt-1`} />
      </label>
    </SettingForm>
  );
}

export function PublicContactForm({ email, phone, address }: { email: string; phone: string; address: string }) {
  const [state, action, pending] = useActionState(updatePublicContactAction, initial);
  return (
    <SettingForm action={action} title="Public contact" icon="location" pending={pending} submitLabel="Save public contact" state={state} intro="These details appear on the public homepage and in the footer. Leave a field blank to hide it. The homepage notice stays only while email, phone, and address are all empty.">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-brand-navy">
          Email
          <input name="publicEmail" type="email" maxLength={120} defaultValue={email} placeholder="care@clinic.test" autoComplete="email" className={`${textInputClass} mt-1`} />
        </label>
        <label className="text-sm font-medium text-brand-navy">
          Phone
          <input name="publicPhone" type="tel" inputMode="tel" maxLength={24} defaultValue={phone} placeholder="+232 76 000 000" autoComplete="tel" className={`${textInputClass} mt-1`} />
        </label>
        <label className="text-sm font-medium text-brand-navy sm:col-span-2">
          Address
          <input name="publicAddress" maxLength={200} defaultValue={address} placeholder="Freetown, Sierra Leone" autoComplete="street-address" className={`${textInputClass} mt-1`} />
        </label>
      </div>
    </SettingForm>
  );
}

export function HoldSettingForm({ minutes }: { minutes: number | null }) {
  const [state, action, pending] = useActionState(updateHoldSettingAction, initial);
  return (
    <SettingForm action={action} title="Payment hold" icon="clock" pending={pending} submitLabel="Save hold" state={state} intro="New unpaid bookings expire after this many minutes. Allowed range is 5 to 120. Existing holds are not rewritten.">
      {minutes === null ? <Notice>No payment-hold setting is stored. New bookings use 15 minutes until an administrator saves a value between 5 and 120.</Notice> : null}
      <label className="text-sm font-medium text-brand-navy">
        Minutes
        <input name="minutes" required inputMode="numeric" min={5} max={120} defaultValue={minutes ?? 15} className={`${textInputClass} mt-1`} />
      </label>
    </SettingForm>
  );
}
