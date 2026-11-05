import type { Metadata } from "next";
import { CatalogPager, catalogQuery } from "@/components/admin/catalog-ui";
import { LiveQueryForm } from "@/components/live-query";
import { textInputClass } from "@/components/form-classes";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadUsers } from "@/lib/admin/directories";
import { accessLabel, formatPlatformDay, userStatusLabel, userStatusTone } from "@/lib/admin/labels";
import { isUuid } from "@/lib/admin/rules";
import { readPage, readParam } from "@/lib/catalog/queries";
import { prisma } from "@/lib/db/prisma";
import { UsersBoard } from "./users-board";

export const metadata: Metadata = { title: "All users" };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const superAdmin = actor.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
  const params = await searchParams;
  const q = readParam(params.q);
  const status = readParam(params.status);
  const role = readParam(params.role);
  const page = readPage(params.page);
  const requestedView = readParam(params.view);
  const initialViewId = isUuid(requestedView) ? requestedView : null;
  const result = await loadUsers(prisma, { q, status, role, page });
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const query = catalogQuery("/admin/users", { q, status, role });
  const rows = result.users.map((user) => {
    const elevated = user.roleCodes.includes("ADMIN") || user.roleCodes.includes("SUPER_ADMIN");
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.patientName ?? user.doctorName,
      roleLabel: accessLabel(user.roleCodes),
      status: user.status,
      statusLabel: userStatusLabel(user.status),
      statusTone: userStatusTone(user.status),
      createdLabel: formatPlatformDay(new Date(user.createdAt)),
      timezone: user.timezone,
      canManage: actor.id !== user.id && (!elevated || superAdmin),
      canEdit: actor.id === user.id || (actor.id !== user.id && (!elevated || superAdmin)),
      self: actor.id === user.id,
      lockLabel: actor.id === user.id ? "You" : "Locked",
      imageVersion: user.imageVersion,
    };
  });
  return (
    <main className="users-page">
      <div className="users-desk">
      <LiveQueryForm
        pathname="/admin/users"
        className="users-filters"
        fields={[
          { name: "q", label: "Search", kind: "text", value: q, placeholder: "Name or email", labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1` },
          { name: "status", label: "Status", kind: "select", value: status || "ALL", labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1`, options: [
            { value: "ALL", label: "All statuses" },
            { value: "ACTIVE", label: "Active" },
            { value: "SUSPENDED", label: "Suspended" },
            { value: "PENDING_VERIFICATION", label: "Pending verification" },
          ] },
          { name: "role", label: "Role", kind: "select", value: role || "ALL", labelClassName: "text-sm font-medium", inputClassName: `${textInputClass} mt-1`, options: [
            { value: "ALL", label: "All roles" },
            { value: "PATIENT", label: "Patient" },
            { value: "DOCTOR", label: "Doctor" },
            { value: "ADMIN", label: "Administrator" },
          ] },
        ]}
      />
      </div>
      <UsersBoard
        rows={rows}
        canCreateElevated={superAdmin}
        initialViewId={initialViewId}
        list={{ q, status, role, page: result.page, pageSize: result.pageSize, total: result.total, query }}
      />
      <div className="users-desk">
        <CatalogPager page={result.page} pageSize={result.pageSize} total={result.total} query={query} label="account" />
      </div>
    </main>
  );
}
