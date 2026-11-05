import { displayEmail, normalizeEmail } from "./email-address";
import { passwordRuleError } from "./password-rule";

/** Checks the sign-in form before any database call. */
export function signInFormError(input: {
  email: string;
  currentPassword: string;
  nextPassword: string;
  confirmPassword: string;
}): string | null {
  if (!displayEmail(input.email) || !normalizeEmail(input.email)) return "Enter a valid email address.";
  if (!input.currentPassword) return "Enter your current password.";
  if (input.nextPassword || input.confirmPassword) {
    if (input.nextPassword !== input.confirmPassword) return "The new passwords do not match.";
    return passwordRuleError(input.nextPassword);
  }
  return null;
}
