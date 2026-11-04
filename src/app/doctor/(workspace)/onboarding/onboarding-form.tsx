"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { primaryButtonClass, secondaryButtonClass, textAreaClass, textInputClass } from "@/components/form-classes";
import { CREDENTIAL_TYPES, QUALIFICATION_KINDS, QUALIFICATION_LABELS } from "@/lib/validation/doctor";
import { credentialLabel } from "@/lib/doctors/rules";
import { useConfirmedSubmit, useOutcomeAlert } from "@/lib/ui/sweet-alert";
import { deleteCredentialAction, saveProfileAction, uploadCredentialAction, type ProfileActionState } from "./actions";

const initial: ProfileActionState = {};

type SpecialtyOption = { id: string; name: string; active: boolean };

export function OnboardingForm({
  values,
  specialties,
  selectedAdditional,
  credentials,
  editable,
  resubmit = false,
  showLicenseFields = true,
  showConsultationPreferences = true,
  inPlace = false,
}: {
  values: {
    fullName: string;
    displayName: string;
    email: string;
    phone: string;
    biography: string;
    primarySpecialtyId: string;
    qualificationKind: string;
    qualificationTitle: string;
    qualificationInstitution: string;
    qualificationYear: string;
    licenseNumber: string;
    licenseAuthority: string;
    licenseExpiresOn: string;
    yearsExperience: string;
    languages: string;
    consultationOnline: boolean;
    consultationInPerson: boolean;
  };
  specialties: SpecialtyOption[];
  selectedAdditional: string[];
  credentials: Array<{ id: string; type: string; status: string; filename: string; archived: boolean; reviewed: boolean }>;
  editable: boolean;
  resubmit?: boolean;
  showLicenseFields?: boolean;
  showConsultationPreferences?: boolean;
  inPlace?: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveProfileAction, initial);
  useEffect(() => {
    if (state.tone === "ok" && !pending) router.refresh();
  }, [state.tone, state.message, pending, router]);
  const [uploadState, upload, uploadPending] = useActionState(uploadCredentialAction, initial);
  const [deleteState, remove, deletePending] = useActionState(deleteCredentialAction, initial);
  const confirmRemove = useConfirmedSubmit({
    title: "Remove this document?",
    text: "The credential file will be taken off this profile.",
    confirmText: "Remove document",
    danger: true,
  });
  useOutcomeAlert(deleteState.message, deletePending, deleteState.tone === "ok" ? "ok" : "error");
  useOutcomeAlert(uploadState.message, uploadPending, uploadState.tone === "ok" ? "ok" : "error");
  const errors = state.fieldErrors ?? {};

  return (
    <div className="grid gap-8">
      <form action={action} className="grid gap-4" noValidate>
        {state.message ? (
          <p role={state.tone === "error" ? "alert" : "status"} className="rounded-xl border border-brand-line bg-white px-3 py-3 text-sm leading-6">
            {state.message}
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Full name" name="fullName" defaultValue={values.fullName} error={errors.fullName} disabled={!editable} placeholder="Aminata Kamara" />
          <Field label="Professional display name" name="displayName" defaultValue={values.displayName} error={errors.displayName} disabled={!editable} placeholder="Osman Tholley" hint="This is the name patients see. A title such as Dr. is optional." />
          <label className="text-sm font-medium">
            Professional email
            <input value={values.email} readOnly className={`${textInputClass} mt-1 bg-brand-paper`} />
          </label>
          <Field label="Phone number" name="phone" defaultValue={values.phone} error={errors.phone} disabled={!editable} placeholder="076 123 456" hint="Example: 076 123 456, or +232 76 123 456." />
        </div>
        <label className="text-sm font-medium">
          Professional biography
          <textarea name="biography" defaultValue={values.biography} disabled={!editable} placeholder="I provide mental health consultations for adults in Freetown, in Krio and English." className={`${textAreaClass} mt-1`} />
          <span className="mt-1 block font-normal text-brand-muted">At least 40 characters. Example: I provide mental health consultations for adults in Freetown, in Krio and English.</span>
          {errors.biography ? <span className="mt-1 block text-sm text-brand-danger">{errors.biography}</span> : null}
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">
            Primary specialty
            <select name="primarySpecialtyId" defaultValue={values.primarySpecialtyId} disabled={!editable} className={`${textInputClass} mt-1`}>
              <option value="">Choose a specialty</option>
              {specialties.map((specialty) => (
                <option key={specialty.id} value={specialty.id}>
                  {specialty.name}
                  {specialty.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-brand-muted">Example: Psychiatry.</span>
            {errors.primarySpecialtyId ? <span className="mt-1 block text-sm text-brand-danger">{errors.primarySpecialtyId}</span> : null}
          </label>
          <fieldset className="text-sm font-medium">
            <legend>Additional specialties</legend>
            <span className="mt-1 block font-normal text-brand-muted">Example: also tick Psychology when you practise in more than one area.</span>
            <div className="mt-2 grid gap-2">
              {specialties.map((specialty) => (
                <label key={specialty.id} className="flex items-center gap-2 font-normal">
                  <input
                    type="checkbox"
                    name="additionalSpecialtyIds"
                    value={specialty.id}
                    defaultChecked={selectedAdditional.includes(specialty.id)}
                    disabled={!editable}
                  />
                  {specialty.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="text-sm font-medium">
            Qualification type
            <select name="qualificationKind" defaultValue={values.qualificationKind} disabled={!editable} className={`${textInputClass} mt-1`}>
              <option value="">Choose a type</option>
              {QUALIFICATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {QUALIFICATION_LABELS[kind]}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-normal text-brand-muted">Example: Medical degree.</span>
            {errors.qualificationKind ? <span className="mt-1 block text-sm text-brand-danger">{errors.qualificationKind}</span> : null}
          </label>
          <Field label="Qualification" name="qualificationTitle" defaultValue={values.qualificationTitle} error={errors.qualificationTitle} disabled={!editable} placeholder="BSc Hons Clinical Psychology" />
          <Field label="Institution" name="qualificationInstitution" defaultValue={values.qualificationInstitution} error={errors.qualificationInstitution} disabled={!editable} placeholder="University of Sierra Leone" />
          <Field label="Qualification year" name="qualificationYear" defaultValue={values.qualificationYear} error={errors.qualificationYear} disabled={!editable} placeholder="2016" />
          {showLicenseFields ? (
            <>
              <Field label="Registration or licence number" name="licenseNumber" defaultValue={values.licenseNumber} error={errors.licenseNumber} disabled={!editable} placeholder="SLMC-10483" />
              <Field label="Licensing or registration authority" name="licenseAuthority" defaultValue={values.licenseAuthority} error={errors.licenseAuthority} disabled={!editable} placeholder="Sierra Leone Medical and Dental Council" />
              <Field label="Licence expiry, if applicable" name="licenseExpiresOn" type="date" defaultValue={values.licenseExpiresOn} error={errors.licenseExpiresOn} disabled={!editable} required={false} hint="Optional. Example: 31 Dec 2028." />
            </>
          ) : (
            <>
              <input type="hidden" name="licenseNumber" value={values.licenseNumber} />
              <input type="hidden" name="licenseAuthority" value={values.licenseAuthority} />
              <input type="hidden" name="licenseExpiresOn" value={values.licenseExpiresOn} />
            </>
          )}
          <Field label="Years of experience" name="yearsExperience" defaultValue={values.yearsExperience} error={errors.yearsExperience} disabled={!editable} placeholder="8" />
          <Field label="Languages spoken" name="languages" defaultValue={values.languages} error={errors.languages} disabled={!editable} placeholder="Krio, English" hint="Separate languages with commas. Example: Krio, English." />
        </div>
        {showConsultationPreferences ? (
          <fieldset className="text-sm font-medium">
            <legend>Consultation preferences</legend>
            <div className="mt-2 flex flex-wrap gap-4 font-normal">
              <label className="flex items-center gap-2">
                <input type="radio" name="consultationPreference" value="ONLINE" defaultChecked={values.consultationOnline && !values.consultationInPerson} disabled={!editable} />
                Online
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="consultationPreference" value="IN_PERSON" defaultChecked={values.consultationInPerson && !values.consultationOnline} disabled={!editable} />
                In person
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="consultationPreference" value="BOTH" defaultChecked={values.consultationOnline && values.consultationInPerson} disabled={!editable} />
                Both
              </label>
            </div>
            {errors.consultationModes ? <span className="mt-1 block text-sm text-brand-danger">{errors.consultationModes}</span> : null}
          </fieldset>
        ) : (
          <input
            type="hidden"
            name="consultationPreference"
            value={
              values.consultationOnline && values.consultationInPerson
                ? "BOTH"
                : values.consultationOnline
                  ? "ONLINE"
                  : values.consultationInPerson
                    ? "IN_PERSON"
                    : ""
            }
          />
        )}
        {editable ? (
          <div className="grid gap-3">
            {resubmit && !inPlace ? (
              <p className="text-sm leading-6 text-brand-muted">
                Saving sends these details to an administrator for verification. Patients can book you again after the review is approved.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              {inPlace ? (
                <button className={primaryButtonClass} name="intent" value="draft" disabled={pending} type="submit">
                  {pending ? "Saving…" : "Save changes"}
                </button>
              ) : (
                <>
                  {resubmit ? null : (
                    <button className={secondaryButtonClass} name="intent" value="draft" disabled={pending} type="submit">
                      {pending ? "Saving…" : "Save draft"}
                    </button>
                  )}
                  <button className={primaryButtonClass} name="intent" value="submit" disabled={pending} type="submit">
                    {pending ? "Saving…" : resubmit ? "Save and send for verification" : "Submit for verification"}
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-brand-muted">This profile is locked while it is under review or suspended.</p>
        )}
      </form>

      <section className="grid gap-4">
        <h2 className="text-xl font-semibold text-brand-navy">Credentials</h2>
        <ul className="grid gap-2">
          {credentials.length === 0 ? <li className="text-sm text-brand-muted">No documents uploaded yet.</li> : null}
          {credentials.map((credential) => (
            <li key={credential.id} className="flex flex-col gap-2 rounded-xl border border-brand-line bg-white px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span>
                {credentialLabel(credential.type)} · {credential.filename} · {credential.status}
                {credential.archived ? " · Archived" : ""}
              </span>
              <span className="flex gap-3">
                <a className="font-semibold text-brand-teal" href={`/api/credentials/${credential.id}/file`}>
                  Download
                </a>
                {editable && !credential.reviewed && !credential.archived ? (
                  <form action={remove} onSubmit={confirmRemove}>
                    <input type="hidden" name="credentialId" value={credential.id} />
                    <button className="font-semibold text-brand-danger" disabled={deletePending} type="submit">
                      Remove
                    </button>
                  </form>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {uploadState.message ? (
          <p role={uploadState.tone === "error" ? "alert" : "status"} className="text-sm">
            {uploadState.message}
          </p>
        ) : null}
        {deleteState.message ? (
          <p role={deleteState.tone === "error" ? "alert" : "status"} className="text-sm">
            {deleteState.message}
          </p>
        ) : null}
        {editable ? (
          <form action={upload} className="grid gap-3 rounded-2xl border border-brand-line bg-white p-4">
            <label className="text-sm font-medium">
              Document type
              <select name="type" className={`${textInputClass} mt-1`}>
                {CREDENTIAL_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {credentialLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              File
              <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" required className="mt-1 block w-full text-sm" />
            </label>
            <label className="text-sm font-medium">
              Expiry date, if the document has one
              <input name="expiresOn" type="date" className={`${textInputClass} mt-1`} />
            </label>
            <button className={primaryButtonClass} disabled={uploadPending} type="submit">
              {uploadPending ? "Uploading…" : "Upload document"}
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  error,
  disabled,
  type = "text",
  required = true,
  hint,
  placeholder,
}: {
  label: string;
  name: string;
  defaultValue: string;
  error?: string;
  disabled?: boolean;
  type?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} disabled={disabled} required={required} placeholder={placeholder} className={`${textInputClass} mt-1`} />
      {hint ? <span className="mt-1 block font-normal text-brand-muted">{hint}</span> : null}
      {error ? <span className="mt-1 block text-sm text-brand-danger">{error}</span> : null}
    </label>
  );
}
