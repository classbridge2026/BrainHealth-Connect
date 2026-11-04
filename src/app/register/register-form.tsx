"use client";

import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCalendarDay,
  faEnvelope,
  faEye,
  faEyeSlash,
  faLocationDot,
  faLock,
  faPhone,
  faShieldHalved,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { useActionState, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { COUNTRIES, DEFAULT_NATIONALITY, DEFAULT_PHONE_COUNTRY_ISO } from "@/lib/data/countries";
import {
  fieldErrorsFromZod,
  formDataToRegistration,
  GENDER_LABELS,
  GENDER_VALUES,
  PASSWORD_MAX_LENGTH,
  registrationSchema,
  type RegistrationField,
} from "@/lib/validation/registration";
import { registerPatientAction, type RegistrationFormState } from "./actions";

config.autoAddCss = false;

const initialState: RegistrationFormState = { ok: false };

const focusableField: Partial<Record<RegistrationField, string>> = {
  fullName: "fullName",
  gender: "gender",
  dateOfBirth: "dateOfBirth",
  nationality: "nationality",
  phone: "phoneNational",
  email: "email",
  residentialAddress: "residentialAddress",
  password: "password",
  confirmPassword: "confirmPassword",
};

function shownError(
  name: RegistrationField,
  clientErrors: Partial<Record<RegistrationField, string>>,
  state: RegistrationFormState,
) {
  return clientErrors[name] ?? (state.ok === false ? state.fieldErrors?.[name] : undefined);
}

export function RegisterForm({ systemName }: { systemName: string }) {
  const [state, formAction, pending] = useActionState(registerPatientAction, initialState);
  const [clientErrors, setClientErrors] = useState<Partial<Record<RegistrationField, string>>>({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!pending) {
      submitLock.current = false;
    }
  }, [pending]);

  if (state.ok === true) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-brand-navy sm:text-3xl">
          Your portal is ready
        </h1>
        <p role="status" className="text-base leading-6 text-brand-ink">
          {state.message}
        </p>
        <Link
          href="/patient"
          className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-teal px-4 text-sm font-semibold text-white hover:bg-brand-teal-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
        >
          Open patient portal
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4"
      noValidate
      aria-busy={pending}
      onSubmit={(event) => {
        if (pending || submitLock.current) {
          event.preventDefault();
          return;
        }
        const parsed = registrationSchema.safeParse(formDataToRegistration(new FormData(event.currentTarget)));
        if (!parsed.success) {
          event.preventDefault();
          setClientErrors(fieldErrorsFromZod(parsed.error));
          const key = parsed.error.issues[0]?.path[0];
          const fieldId = typeof key === "string" ? focusableField[key as RegistrationField] : undefined;
          if (fieldId) {
            event.currentTarget.querySelector<HTMLElement>(`#${fieldId}`)?.focus();
          }
          return;
        }
        submitLock.current = true;
        setClientErrors({});
      }}
    >
      <div>
        <h1 className="text-center text-[1.75rem] font-semibold leading-tight tracking-tight text-brand-navy sm:text-3xl">
          Create your account
        </h1>
        <p className="mt-2 text-base leading-6 text-brand-muted">
          Join {systemName} for secure access to healthcare services.
        </p>
        <p className="mt-3 text-sm leading-5 text-brand-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-brand-teal underline decoration-brand-teal/40 underline-offset-2 hover:text-brand-teal-hover"
          >
            Sign in
          </Link>
        </p>
      </div>

      {state.formMessage ? (
        <p
          role="alert"
          className="rounded-xl border border-brand-danger/30 bg-[#fdf4f4] px-3 py-3 text-sm leading-5 text-brand-ink"
        >
          {state.formMessage}
        </p>
      ) : null}

      <Field
        label="Full name"
        name="fullName"
        autoComplete="name"
        placeholder="Enter your full name"
        icon={faUser}
        maxLength={120}
        error={shownError("fullName", clientErrors, state)}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField
          id="gender"
          name="gender"
          label="Gender"
          defaultValue=""
          autoComplete="sex"
          error={shownError("gender", clientErrors, state)}
        >
          <option value="" disabled>
            Select gender
          </option>
          {GENDER_VALUES.map((value) => (
            <option key={value} value={value}>
              {GENDER_LABELS[value]}
            </option>
          ))}
        </SelectField>
        <Field
          id="dateOfBirth"
          label="Date of birth"
          name="dateOfBirth"
          type="date"
          autoComplete="bday"
          icon={faCalendarDay}
          max={new Date().toISOString().slice(0, 10)}
          error={shownError("dateOfBirth", clientErrors, state)}
        />
      </div>

      <SelectField
        id="nationality"
        name="nationality"
        label="Nationality"
        defaultValue={DEFAULT_NATIONALITY}
        autoComplete="country-name"
        error={shownError("nationality", clientErrors, state)}
      >
        {COUNTRIES.map((country) => (
          <option key={country.iso} value={country.name}>
            {country.name}
          </option>
        ))}
      </SelectField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <SelectField
          id="phoneCountry"
          name="phoneCountry"
          label="Country calling code"
          defaultValue={DEFAULT_PHONE_COUNTRY_ISO}
          error={undefined}
        >
          {COUNTRIES.map((country) => (
            <option key={country.iso} value={country.iso}>
              {country.name} {country.dial}
            </option>
          ))}
        </SelectField>
        <Field
          id="phoneNational"
          label="Phone number"
          name="phoneNational"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="Local number"
          icon={faPhone}
          maxLength={20}
          error={shownError("phone", clientErrors, state)}
          errorId="phone-error"
        />
      </div>

      <Field
        label="Email address"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        icon={faEnvelope}
        spellCheck={false}
        error={shownError("email", clientErrors, state)}
      />

      <AddressField error={shownError("residentialAddress", clientErrors, state)} />

      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="new-password"
        placeholder="Create a password"
        visible={passwordVisible}
        value={password}
        inputRef={passwordRef}
        error={shownError("password", clientErrors, state)}
        onChange={setPassword}
        onToggle={() => toggleVisibility(passwordRef, setPasswordVisible)}
      />

      <PasswordField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        autoComplete="new-password"
        placeholder="Re-enter your password"
        visible={confirmVisible}
        value={confirmPassword}
        inputRef={confirmRef}
        error={shownError("confirmPassword", clientErrors, state)}
        onChange={setConfirmPassword}
        onToggle={() => toggleVisibility(confirmRef, setConfirmVisible)}
      />

      <input type="hidden" name="acceptTerms" value="on" />
      <input type="hidden" name="acceptPrivacy" value="on" />

      <p className="text-sm leading-5 text-brand-muted">
        By creating an account, you agree to the{" "}
        <Link
          href="/terms"
          className="font-semibold text-brand-teal underline decoration-brand-teal/40 underline-offset-2 hover:text-brand-teal-hover"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="font-semibold text-brand-teal underline decoration-brand-teal/40 underline-offset-2 hover:text-brand-teal-hover"
        >
          Privacy Notice
        </Link>.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-teal text-base font-semibold text-white transition-colors hover:bg-brand-teal-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal disabled:cursor-wait disabled:opacity-70"
      >
        Create Account
      </button>

      <p className="flex items-start gap-2.5 text-sm leading-5 text-brand-muted">
        <FontAwesomeIcon icon={faShieldHalved} className="mt-0.5 h-4 w-4 shrink-0 text-brand-teal" aria-hidden="true" />
        <span>Your personal information is protected. We handle your data with care.</span>
      </p>
    </form>
  );
}

function toggleVisibility(
  ref: RefObject<HTMLInputElement | null>,
  setVisible: (value: boolean | ((current: boolean) => boolean)) => void,
) {
  const field = ref.current;
  const selectionStart = field?.selectionStart ?? null;
  const selectionEnd = field?.selectionEnd ?? null;
  setVisible((current) => !current);
  requestAnimationFrame(() => {
    if (!field) return;
    field.focus();
    if (selectionStart === null || selectionEnd === null) return;
    try {
      field.setSelectionRange(selectionStart, selectionEnd);
    } catch {
      // Some browsers reject a selection range while the field is masked.
    }
  });
}

function controlClass(error: string | undefined, extra?: string) {
  return [
    "w-full min-w-0 rounded-xl border bg-white text-base text-brand-ink outline-none transition-colors placeholder:text-brand-muted/80",
    "focus:border-brand-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal",
    error ? "border-brand-danger" : "border-brand-line",
    extra ?? "",
  ].join(" ");
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm leading-5 text-brand-danger">
      {message}
    </p>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-brand-ink">
      {children}
      <span className="sr-only"> required</span>
    </label>
  );
}

function LeadingIcon({ icon }: { icon: IconDefinition }) {
  return (
    <span
      className="pointer-events-none absolute top-1/2 left-0 flex h-12 w-11 -translate-y-1/2 items-center justify-center text-brand-teal"
      aria-hidden="true"
    >
      <FontAwesomeIcon icon={icon} className="h-4 w-4" />
    </span>
  );
}

function Field({
  id,
  label,
  name,
  error,
  errorId,
  type = "text",
  autoComplete,
  placeholder,
  icon,
  maxLength,
  max,
  inputMode,
  spellCheck,
}: {
  id?: string;
  label: string;
  name: string;
  error?: string;
  errorId?: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  icon?: IconDefinition;
  maxLength?: number;
  max?: string;
  inputMode?: "text" | "tel" | "email";
  spellCheck?: boolean;
}) {
  const fieldId = id ?? name;
  const messageId = errorId ?? `${fieldId}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <div className="relative">
        {icon ? <LeadingIcon icon={icon} /> : null}
        <input
          id={fieldId}
          name={name}
          type={type}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          max={max}
          inputMode={inputMode}
          spellCheck={spellCheck}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? messageId : undefined}
          className={controlClass(error, `h-12 ${icon ? "pr-3 pl-11" : "px-3"}`)}
        />
      </div>
      <FieldError id={messageId} message={error} />
    </div>
  );
}

function AddressField({ error }: { error?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor="residentialAddress">Address</FieldLabel>
      <div className="relative">
        <span
          className="pointer-events-none absolute top-3 left-0 flex h-6 w-11 items-center justify-center text-brand-teal"
          aria-hidden="true"
        >
          <FontAwesomeIcon icon={faLocationDot} className="h-4 w-4" />
        </span>
        <textarea
          id="residentialAddress"
          name="residentialAddress"
          required
          rows={3}
          maxLength={200}
          autoComplete="street-address"
          placeholder="Street, city, and area"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "residentialAddress-error" : undefined}
          className={controlClass(error, "min-h-24 resize-y py-3 pr-3 pl-11")}
        />
      </div>
      <FieldError id="residentialAddress-error" message={error} />
    </div>
  );
}

function SelectField({
  id,
  name,
  label,
  defaultValue,
  autoComplete,
  error,
  children,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  autoComplete?: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <select
          id={id}
          name={name}
          required
          defaultValue={defaultValue}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={controlClass(error, "h-12 appearance-none pr-10 pl-3")}
        >
          {children}
        </select>
        <span
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-brand-muted"
          aria-hidden="true"
        >
          <Chevron />
        </span>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
  placeholder,
  visible,
  value,
  inputRef,
  error,
  describedBy,
  onChange,
  onToggle,
}: {
  id: string;
  name: "password" | "confirmPassword";
  label: string;
  autoComplete: string;
  placeholder: string;
  visible: boolean;
  value: string;
  inputRef: RefObject<HTMLInputElement | null>;
  error?: string;
  describedBy?: string;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  const errorId = `${name}-error`;
  const describedByIds = [describedBy, error ? errorId : undefined].filter(Boolean).join(" ");
  const hiddenLabel = name === "confirmPassword" ? "password confirmation" : "password";
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <span
          className="pointer-events-none absolute top-1/2 left-0 flex h-12 w-11 -translate-y-1/2 items-center justify-center text-brand-teal"
          aria-hidden="true"
        >
          <FontAwesomeIcon icon={faLock} className="h-4 w-4" />
        </span>
        <input
          ref={inputRef}
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          maxLength={PASSWORD_MAX_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedByIds || undefined}
          className={controlClass(error, "h-12 pr-14 pl-11")}
        />
        <button
          type="button"
          className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-brand-teal hover:bg-brand-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
          aria-label={visible ? `Hide ${hiddenLabel}` : `Show ${hiddenLabel}`}
          aria-controls={id}
          onClick={onToggle}
        >
          <FontAwesomeIcon icon={visible ? faEyeSlash : faEye} className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
