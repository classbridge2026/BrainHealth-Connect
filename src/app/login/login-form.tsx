"use client";

import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEnvelope, faEye, faEyeSlash, faLock } from "@fortawesome/free-solid-svg-icons";
import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loginIdentifierError } from "@/lib/auth/login-identifier";
import { login, type LoginFormState } from "./actions";

config.autoAddCss = false;

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [clientErrors, setClientErrors] = useState<LoginFormState>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!pending) {
      submitLock.current = false;
    }
  }, [pending]);

  const identifierError = clientErrors.identifierError ?? state.identifierError;
  const passwordError = clientErrors.passwordError ?? state.passwordError;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/"
        aria-label="Back"
        className="inline-flex w-fit items-center gap-2 rounded-md text-sm font-semibold text-brand-navy focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-teal"
      >
        <span aria-hidden="true">←</span>
        Back
      </Link>
      <div className="flex flex-col gap-5 rounded-2xl border border-solid border-brand-line bg-white p-5 sm:p-6 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
      <div className="text-center">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-brand-navy sm:text-3xl">
          Login
        </h1>
        <p className="mt-2 text-base leading-6 text-brand-muted">Welcome back! Please login to your account.</p>
      </div>

      {state.formMessage ? (
        <p role="alert" className="rounded-xl border border-brand-danger/30 bg-[#fdf4f4] px-3 py-3 text-sm leading-5 text-brand-ink">
          {state.formMessage}
        </p>
      ) : null}

      <form
        action={formAction}
        className="flex flex-col gap-5"
        noValidate
        aria-busy={pending}
        onSubmit={(event) => {
          if (pending || submitLock.current) {
            event.preventDefault();
            return;
          }
          const next: LoginFormState = {};
          const identifierProblem = loginIdentifierError(identifier);
          if (identifierProblem) {
            next.identifierError = identifierProblem;
          }
          if (!password) {
            next.passwordError = "Enter your password.";
          } else if (password.length > 128) {
            next.passwordError = "Use a password of 128 characters or fewer.";
          }
          if (next.identifierError || next.passwordError) {
            event.preventDefault();
            setClientErrors(next);
            return;
          }
          submitLock.current = true;
          setClientErrors({});
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="identifier" className="sr-only">
            Email or Phone Number
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-0 flex h-12 w-11 -translate-y-1/2 items-center justify-center text-brand-teal" aria-hidden="true">
              <FontAwesomeIcon icon={faEnvelope} className="h-4 w-4" />
            </span>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              aria-invalid={identifierError ? true : undefined}
              aria-describedby={identifierError ? "identifier-error" : undefined}
              placeholder="Email or Phone Number"
              className={controlClass(identifierError, "h-12 pr-3 pl-11")}
            />
          </div>
          {identifierError ? (
            <p id="identifier-error" className="text-sm leading-5 text-brand-danger">
              {identifierError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-0 flex h-12 w-11 -translate-y-1/2 items-center justify-center text-brand-teal" aria-hidden="true">
              <FontAwesomeIcon icon={faLock} className="h-4 w-4" />
            </span>
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={passwordError ? "password-error" : undefined}
              placeholder="Password"
              className={controlClass(passwordError, "h-12 pr-14 pl-11")}
            />
            <button
              type="button"
              className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-brand-teal hover:bg-brand-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              aria-controls="password"
              onClick={() => {
                const field = passwordRef.current;
                const selectionStart = field?.selectionStart ?? null;
                const selectionEnd = field?.selectionEnd ?? null;
                setPasswordVisible((current) => !current);
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
              }}
            >
              <FontAwesomeIcon icon={passwordVisible ? faEyeSlash : faEye} className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {passwordError ? (
            <p id="password-error" className="text-sm leading-5 text-brand-danger">
              {passwordError}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="inline-flex items-center gap-2 text-sm text-brand-ink">
            <input
              type="checkbox"
              name="remember"
              defaultChecked
              className="h-4 w-4 rounded border-brand-line accent-brand-teal"
            />
            Remember me
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-brand-teal hover:text-brand-teal-hover"
          >
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-brand-teal text-base font-semibold text-white transition-colors hover:bg-brand-teal-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal disabled:cursor-wait disabled:opacity-70"
        >
          Login →
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-brand-muted">
        <span className="h-px flex-1 bg-brand-line" />
        OR
        <span className="h-px flex-1 bg-brand-line" />
      </div>

      <Link
        href="/register"
        className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-brand-line bg-white text-base font-semibold text-brand-navy hover:bg-brand-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
      >
        Create an Account
      </Link>

      <p className="text-center text-sm leading-5 text-brand-muted">
        Need help?{" "}
        <Link href="/support" className="font-semibold text-brand-teal hover:text-brand-teal-hover">
          Contact Support
        </Link>
      </p>
      </div>
    </div>
  );
}

function controlClass(error: string | undefined, extra: string) {
  return [
    "w-full min-w-0 rounded-xl border bg-white text-base text-brand-ink outline-none transition-colors placeholder:text-brand-muted/80",
    "focus:border-brand-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal",
    error ? "border-brand-danger" : "border-brand-line",
    extra,
  ].join(" ");
}
