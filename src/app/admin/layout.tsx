import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import "./admin.css";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { AdminShell } from "@/components/admin/admin-shell";
import { getSystemName } from "@/lib/brand/system-name";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { loadInAppNoticeSummary } from "@/lib/notifications/delivery";
import { redirectOffline } from "@/lib/db/offline-redirect";

export const metadata: Metadata = { title: "Administration" };
export const dynamic = "force-dynamic";

async function loadAdminChrome(userId: string) {
  const [account, notices] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, profileImageUpdatedAt: true },
    }),
    loadInAppNoticeSummary(prisma, userId, "admin"),
  ]);
  return {
    email: account?.email ?? "Administrator",
    imageVersion: account?.profileImageUpdatedAt?.toISOString() ?? null,
    unreadNotifications: notices.unread,
    notices: notices.items,
  };
}

const readAdminChrome = unstable_cache(loadAdminChrome, ["admin-chrome"], { revalidate: 20 });

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  let chrome: Awaited<ReturnType<typeof loadAdminChrome>>;
  try {
    chrome = await readAdminChrome(user.id);
  } catch (error) {
    if (isRecordsOffline(error)) await redirectOffline();
    throw error;
  }
  const systemName = await getSystemName();
  const { email, imageVersion, unreadNotifications, notices } = chrome;
  return (
    <AdminShell
      userId={user.id}
      email={email}
      systemName={systemName}
      imageVersion={imageVersion}
      roleLabel={user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE) ? "Super administrator" : "Administrator"}
      unreadNotifications={unreadNotifications}
      notices={notices}
    >
      {children}
    </AdminShell>
  );
}
