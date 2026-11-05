import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { homeForRoles } from "./access";
import { isRecordsOffline, retryRecordsRead } from "@/lib/db/offline";
import { redirectOffline } from "@/lib/db/offline-redirect";
import { readSessionUser } from "./current-user";
import { SESSION_COOKIE } from "./session";
import { prisma } from "@/lib/db/prisma";

/** Reads the session and allows only the roles stored for that account. */
export async function requireStoredRoles(allowed: string[]) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value ?? "";
  let user;
  try {
    user = await retryRecordsRead(() => readSessionUser(prisma, token || undefined, new Date()));
  } catch (error) {
    if (isRecordsOffline(error)) await redirectOffline();
    throw error;
  }
  if (!user) {
    redirect("/login");
  }
  if (user.status === "PENDING_VERIFICATION") {
    redirect("/verify");
  }
  if (user.status !== "ACTIVE") {
    redirect("/account-unavailable");
  }
  if (!allowed.some((code) => user.roleCodes.includes(code))) {
    const home = homeForRoles(user.roleCodes);
    redirect(home ?? "/account-unavailable");
  }
  return user;
}
