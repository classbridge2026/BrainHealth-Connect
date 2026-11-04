/** Stable role codes from the existing Role catalog. Public registration cannot choose another code. */
export const PATIENT_ROLE_CODE = "PATIENT";
export const DOCTOR_ROLE_CODE = "DOCTOR";
export const ADMIN_ROLE_CODE = "ADMIN";
export const SUPER_ADMIN_ROLE_CODE = "SUPER_ADMIN";
/** Operator account. It can use the admin area and is left out of the user directory. */
export const DEVELOPER_ROLE_CODE = "DEVELOPER";

export const TERMS_DOCUMENT_VERSION = "2026-10-18";
export const PRIVACY_DOCUMENT_VERSION = "2026-10-18";
export const DATA_PROCESSING_DOCUMENT_VERSION = "2026-10-18";
export const TELEHEALTH_DOCUMENT_VERSION = "2026-10-18";
export const GUARDIAN_AUTHORIZATION_DOCUMENT_VERSION = "2026-10-18";

export const MINOR_REGISTRATION_SETTING = "MINOR_REGISTRATION_ENABLED";
export const MINIMUM_SELF_REGISTRATION_AGE = 18;

export const SESSION_COOKIE = "cc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

export const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24;
export const PHONE_CODE_TTL_MS = 1000 * 60 * 15;
export const PHONE_MAX_ATTEMPTS = 5;

export const GENERIC_DUPLICATE_ACCOUNT =
  "An account could not be created with these contact details. If you already registered, verify that account or log in.";

export const GENERIC_CREDENTIALS = "Those sign-in details are not valid.";

export const REGISTRATION_RATE_LIMIT = { limit: 8, windowMs: 60 * 60 * 1000 };
export const RESEND_RATE_LIMIT = { limit: 3, windowMs: 15 * 60 * 1000 };
export const VERIFY_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };
