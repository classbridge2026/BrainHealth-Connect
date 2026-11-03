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

async function loadAdminAccount(userId: string) {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, profileImageUpdatedAt: true },
  });
  return {
    email: account?.email ?? "Administrator",
    imageVersion: account?.profileImageUpdatedAt?.toISOString() ?? null,
  };
}

const readAdminAccount = unstable_cache(loadAdminAccount, ["admin-account"], { revalidate: 20 });

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  let account: Awaited<ReturnType<typeof loadAdminAccount>>;
  let notices: Awaited<ReturnType<typeof loadInAppNoticeSummary>>;
  try {
    [account, notices] = await Promise.all([
      readAdminAccount(user.id),
      loadInAppNoticeSummary(prisma, user.id, "admin"),
    ]);
  } catch (error) {
    if (isRecordsOffline(error)) await redirectOffline();
    throw error;
  }
  const systemName = await getSystemName();
  const { email, imageVersion } = account;
  const unreadNotifications = notices.unread;
  return (
    <AdminShell
      userId={user.id}
      email={email}
      systemName={systemName}
      imageVersion={imageVersion}
      roleLabel={user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE) ? "Super administrator" : "Administrator"}
      unreadNotifications={unreadNotifications}
      notices={notices.items}
    >
      {children}
    </AdminShell>
  );
}
