import type { Metadata } from "next";
import { CatalogPager, catalogQuery } from "@/components/admin/catalog-ui";
import { LiveQueryForm } from "@/components/live-query";
import { textInputClass } from "@/components/form-classes";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { loadOfferingWorkspace, readPage, readParam } from "@/lib/catalog/queries";
import { loadSelfDoctorOption } from "@/lib/catalog/self-doctor";
import { prisma } from "@/lib/db/prisma";
import { formatWhen } from "@/lib/doctors/invitation-email";
import { OfferingsBoard, type OfferingRecord } from "./offering-forms";

export const metadata: Metadata = { title: "Doctor offerings" };
export const dynamic = "force-dynamic";

export default async function OfferingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const params = await searchParams;
  const q = readParam(params.q);
  const doctorId = readParam(params.doctorId);
  const specialtyId = readParam(params.specialtyId);
  const serviceId = readParam(params.serviceId);
  const status = readParam(params.status);
  const mode = readParam(params.mode);
  const page = readPage(params.page);
  const [result, self] = await Promise.all([
    loadOfferingWorkspace(prisma, { q, doctorId, specialtyId, serviceId, status, mode, page }),
    loadSelfDoctorOption(prisma, user.id),
  ]);
  if (!result.ok) return <RecordsUnavailable code={result.code} />;
  const query = catalogQuery("/admin/offerings", { q, doctorId, specialtyId, serviceId, status, mode });
  const offerings: OfferingRecord[] = result.rows.map((offering) => ({
    ...offering,
    createdLabel: formatWhen(new Date(offering.createdAt)),
    updatedLabel: formatWhen(new Date(offering.updatedAt)),
  }));
  return (
    <main className="users-page">
      <LiveQueryForm
        pathname="/admin/offerings"
        className="users-filters offerings-filters"
        fields={[
          { name: "q", label: "Search", kind: "text", value: q, placeholder: "Doctor, specialty, or service", inputClassName: textInputClass },
          { name: "doctorId", label: "Doctor", kind: "select", value: doctorId, inputClassName: textInputClass, options: [{ value: "", label: "All doctors" }, ...result.doctors.map((doctor) => ({ value: doctor.id, label: doctor.fullName }))] },
          { name: "specialtyId", label: "Specialty", kind: "select", value: specialtyId, inputClassName: textInputClass, options: [{ value: "", label: "All specialties" }, ...result.specialties.map((specialty) => ({ value: specialty.id, label: specialty.name }))] },
          { name: "serviceId", label: "Service", kind: "select", value: serviceId, inputClassName: textInputClass, options: [{ value: "", label: "All services" }, ...result.services.map((service) => ({ value: service.id, label: service.name }))] },
          { name: "status", label: "Status", kind: "select", value: status || "ALL", inputClassName: textInputClass, options: [
            { value: "ALL", label: "All statuses" },
            { value: "ACTIVE", label: "Active" },
            { value: "INACTIVE", label: "Inactive" },
          ] },
        ]}
      />
      <OfferingsBoard
        offerings={offerings}
        doctors={result.eligibleDoctors}
        services={result.services}
        specialties={result.specialties}
        self={self}
        selfRole={user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE) ? "Super administrator" : "Administrator"}
        currency={result.currency}
      />
      <CatalogPager page={result.page} pageSize={result.pageSize} total={result.total} query={query} label="doctor" />
    </main>
  );
}
