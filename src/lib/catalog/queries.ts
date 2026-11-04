import type { Prisma, PrismaClient } from "@prisma/client";
import { isSchemaMismatch } from "@/lib/doctors/errors";
import { readDefaultCurrency } from "./configuration";
import { CATALOG_PAGE_SIZE } from "./constants";
import { formatMoneyAmount, sameMoney } from "./money";
import { parseActivity, parseUuid } from "./rules";

export function readParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim().slice(0, 80);
}

export function readPage(value: string | string[] | undefined): number {
  const page = Number(readParam(value) || "1");
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    return 1;
  }
  return page;
}

function unavailable(error: unknown) {
  if (isSchemaMismatch(error)) {
    return { ok: false as const, code: "SCHEMA" as const };
  }
  return { ok: false as const, code: "UNAVAILABLE" as const };
}

function activityWhere(status: string | undefined): { isActive?: boolean } {
  const activity = parseActivity(status);
  if (activity === "ACTIVE") return { isActive: true };
  if (activity === "INACTIVE") return { isActive: false };
  return {};
}

export async function loadCatalogSummary(db: PrismaClient) {
  try {
    const [activeSpecialties, activeServices, doctorsWithOfferings, activeLocations, inactiveSpecialties, inactiveServices, inactiveLocations] =
      await Promise.all([
        db.specialty.count({ where: { isActive: true } }),
        db.consultationService.count({ where: { isActive: true } }),
        db.doctorProfile.count({
          where: {
            verificationStatus: "APPROVED",
            user: { status: "ACTIVE", deletedAt: null },
            offerings: { some: { isActive: true } },
          },
        }),
        db.location.count({ where: { isActive: true } }),
        db.specialty.count({ where: { isActive: false } }),
        db.consultationService.count({ where: { isActive: false } }),
        db.location.count({ where: { isActive: false } }),
      ]);
    return {
      ok: true as const,
      counts: {
        activeSpecialties,
        activeServices,
        doctorsWithOfferings,
        activeLocations,
        inactiveSpecialties,
        inactiveServices,
        inactiveLocations,
      },
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadSpecialties(db: PrismaClient, filters: { q?: string; status?: string; page?: number } = {}) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.SpecialtyWhereInput = { ...activityWhere(filters.status) };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  try {
    const [total, rows] = await Promise.all([
      db.specialty.count({ where }),
      db.specialty.findMany({
        where,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        include: {
          _count: { select: { doctors: true, offerings: true, appointments: true } },
          doctors: {
            orderBy: { doctor: { fullName: "asc" } },
            take: 12,
            select: {
              id: true,
              isPrimary: true,
              claimStatus: true,
              doctor: { select: { id: true, fullName: true, verificationStatus: true } },
            },
          },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      rows: rows.map((specialty) => ({
        id: specialty.id,
        code: specialty.code,
        slug: specialty.slug,
        name: specialty.name,
        description: specialty.description,
        sortOrder: specialty.sortOrder,
        isActive: specialty.isActive,
        referenced: specialty._count.doctors + specialty._count.offerings + specialty._count.appointments > 0,
        doctorCount: specialty._count.doctors,
        offeringCount: specialty._count.offerings,
        appointmentCount: specialty._count.appointments,
        doctors: specialty.doctors.map((link) => ({
          id: link.id,
          doctorId: link.doctor.id,
          fullName: link.doctor.fullName,
          claimStatus: link.claimStatus,
          isPrimary: link.isPrimary,
          verificationStatus: link.doctor.verificationStatus,
        })),
      })),
    };
  } catch (error) {
    return unavailable(error);
  }
}

function serviceDto(row: {
  id: string;
  code: string;
  slug: string;
  name: string;
  description: string | null;
  mode: "ONLINE" | "IN_PERSON" | null;
  defaultDurationMinutes: number;
  defaultFee: Prisma.Decimal;
  currency: string;
  preparationInstructions: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count: { offerings: number; appointments: number };
}) {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    name: row.name,
    description: row.description,
    mode: row.mode,
    durationMinutes: row.defaultDurationMinutes,
    defaultFee: formatMoneyAmount(row.defaultFee),
    currency: row.currency.trim(),
    preparationInstructions: row.preparationInstructions,
    isActive: row.isActive,
    referenced: row._count.offerings + row._count.appointments > 0,
    offeringCount: row._count.offerings,
    appointmentCount: row._count.appointments,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadServices(db: PrismaClient, filters: { q?: string; status?: string; mode?: string; page?: number }) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.ConsultationServiceWhereInput = { ...activityWhere(filters.status) };
  if (filters.mode === "ONLINE" || filters.mode === "IN_PERSON") where.mode = filters.mode;
  if (filters.mode === "ANY") where.mode = null;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { slug: { contains: q, mode: "insensitive" } },
      { code: { contains: q, mode: "insensitive" } },
    ];
  }
  try {
    const currency = await readDefaultCurrency(db);
    const [total, rows] = await Promise.all([
      db.consultationService.count({ where }),
      db.consultationService.findMany({
        where,
        orderBy: [{ name: "asc" }],
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        include: { _count: { select: { offerings: true, appointments: true } } },
      }),
    ]);
    return { ok: true as const, total, page, pageSize: CATALOG_PAGE_SIZE, currency, rows: rows.map(serviceDto) };
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadOfferingWorkspace(
  db: PrismaClient,
  filters: { q?: string; doctorId?: string; specialtyId?: string; serviceId?: string; status?: string; mode?: string; page?: number },
) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.DoctorOfferingWhereInput = { ...activityWhere(filters.status) };
  if (filters.mode === "ONLINE" || filters.mode === "IN_PERSON") where.mode = filters.mode;
  const doctorId = filters.doctorId ? parseUuid(filters.doctorId) : null;
  const specialtyId = filters.specialtyId ? parseUuid(filters.specialtyId) : null;
  const serviceId = filters.serviceId ? parseUuid(filters.serviceId) : null;
  if (doctorId) where.doctorProfileId = doctorId;
  if (specialtyId) where.specialtyId = specialtyId;
  if (serviceId) where.consultationServiceId = serviceId;
  if (q) {
    where.OR = [
      { doctor: { fullName: { contains: q, mode: "insensitive" } } },
      { consultationService: { name: { contains: q, mode: "insensitive" } } },
      { specialty: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  try {
    const [total, doctorPage, doctors, eligibleDoctors, specialties, services, currency] = await Promise.all([
      db.doctorProfile.count({ where: { offerings: { some: where } } }),
      db.doctorProfile.findMany({
        where: { offerings: { some: where } },
        orderBy: { fullName: "asc" },
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        select: { id: true },
      }),
      db.doctorProfile.findMany({
        orderBy: { fullName: "asc" },
        take: 200,
        select: { id: true, fullName: true },
      }),
      db.doctorProfile.findMany({
        where: { verificationStatus: "APPROVED", user: { status: "ACTIVE", deletedAt: null } },
        orderBy: { fullName: "asc" },
        take: 200,
        select: {
          id: true,
          fullName: true,
          specialties: {
            where: { claimStatus: "VERIFIED", specialty: { isActive: true } },
            select: { specialty: { select: { id: true, name: true } } },
          },
        },
      }),
      db.specialty.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.consultationService.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, mode: true, defaultDurationMinutes: true, defaultFee: true, currency: true },
      }),
      readDefaultCurrency(db),
    ]);
    const rows = doctorPage.length
      ? await db.doctorOffering.findMany({
          where: { AND: [where, { doctorProfileId: { in: doctorPage.map((doctor) => doctor.id) } }] },
          orderBy: [{ doctor: { fullName: "asc" } }, { consultationService: { name: "asc" } }, { mode: "asc" }],
          include: {
            doctor: { select: { id: true, fullName: true, verificationStatus: true } },
            specialty: { select: { id: true, name: true } },
            consultationService: { select: { id: true, name: true, defaultFee: true, currency: true, mode: true } },
            _count: { select: { appointments: true, availabilityRules: true } },
          },
        })
      : [];
    return {
      ok: true as const,
      total,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      currency,
      doctors,
      specialties,
      services: services.map((service) => ({
        id: service.id,
        name: service.name,
        mode: service.mode,
        durationMinutes: service.defaultDurationMinutes,
        defaultFee: formatMoneyAmount(service.defaultFee),
        currency: service.currency.trim(),
      })),
      eligibleDoctors: eligibleDoctors
        .map((doctor) => ({
          id: doctor.id,
          fullName: doctor.fullName,
          specialties: doctor.specialties.map((link) => link.specialty),
        }))
        .filter((doctor) => doctor.specialties.length > 0),
      rows: rows.map((row) => ({
        id: row.id,
        doctorId: row.doctor.id,
        doctorName: row.doctor.fullName,
        verificationStatus: row.doctor.verificationStatus,
        specialtyId: row.specialty.id,
        specialtyName: row.specialty.name,
        serviceId: row.consultationService.id,
        serviceName: row.consultationService.name,
        serviceMode: row.consultationService.mode,
        defaultFee: formatMoneyAmount(row.consultationService.defaultFee),
        mode: row.mode,
        durationMinutes: row.durationMinutes,
        fee: formatMoneyAmount(row.price),
        currency: row.currency.trim(),
        serviceCurrency: row.consultationService.currency.trim(),
        sameAsDefault:
          row.currency.trim() === row.consultationService.currency.trim() && sameMoney(row.price, row.consultationService.defaultFee),
        notes: row.notes,
        isActive: row.isActive,
        appointmentCount: row._count.appointments,
        ruleCount: row._count.availabilityRules,
        referenced: row._count.appointments + row._count.availabilityRules > 0,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadLocations(db: PrismaClient, filters: { q?: string; status?: string; district?: string; page?: number }) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.LocationWhereInput = { ...activityWhere(filters.status) };
  if (filters.district) where.district = filters.district;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { locality: { contains: q, mode: "insensitive" } },
      { addressLine1: { contains: q, mode: "insensitive" } },
      { district: { contains: q, mode: "insensitive" } },
    ];
  }
  try {
    const [total, rows, districts] = await Promise.all([
      db.location.count({ where }),
      db.location.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        include: { _count: { select: { appointments: true, availabilityRules: true } } },
      }),
      db.location.findMany({ distinct: ["district"], select: { district: true }, orderBy: { district: "asc" }, take: 100 }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      districts: districts.map((row) => row.district),
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        addressLine1: row.addressLine1,
        addressLine2: row.addressLine2,
        locality: row.locality,
        district: row.district,
        countryCode: row.countryCode.trim(),
        phone: row.phone,
        latitude: row.latitude ? row.latitude.toString() : "",
        longitude: row.longitude ? row.longitude.toString() : "",
        accessInstructions: row.accessInstructions,
        isActive: row.isActive,
        referenced: row._count.appointments + row._count.availabilityRules > 0,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadPricing(db: PrismaClient, filters: { q?: string; status?: string; page?: number }) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const where: Prisma.ConsultationServiceWhereInput = { ...activityWhere(filters.status) };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { offerings: { some: { doctor: { fullName: { contains: q, mode: "insensitive" } } } } },
    ];
  }
  try {
    const currency = await readDefaultCurrency(db);
    const [total, rows] = await Promise.all([
      db.consultationService.count({ where }),
      db.consultationService.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        include: {
          offerings: {
            orderBy: { doctor: { fullName: "asc" } },
            take: 20,
            include: { doctor: { select: { fullName: true, verificationStatus: true } } },
          },
        },
      }),
    ]);
    return {
      ok: true as const,
      total,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      currency,
      rows: rows.map((service) => ({
        id: service.id,
        name: service.name,
        isActive: service.isActive,
        mode: service.mode,
        defaultFee: formatMoneyAmount(service.defaultFee),
        currency: service.currency.trim(),
        offerings: service.offerings.map((offering) => ({
          id: offering.id,
          doctorName: offering.doctor.fullName,
          verificationStatus: offering.doctor.verificationStatus,
          fee: formatMoneyAmount(offering.price),
          currency: offering.currency.trim(),
          isActive: offering.isActive,
          mode: offering.mode,
          sameAsDefault: offering.currency.trim() === service.currency.trim() && sameMoney(offering.price, service.defaultFee),
        })),
      })),
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function loadConfiguration(db: PrismaClient, filters: { q?: string; page?: number }) {
  const page = filters.page && filters.page > 0 ? Math.floor(filters.page) : 1;
  const q = (filters.q ?? "").trim().slice(0, 80);
  const auditWhere: Prisma.AuditLogWhereInput = {
    OR: [
      { action: { startsWith: "specialty." } },
      { action: { startsWith: "service." } },
      { action: { startsWith: "offering." } },
      { action: { startsWith: "location." } },
      { action: { startsWith: "pricing." } },
      { action: { startsWith: "configuration." } },
    ],
  };
  if (q) {
    auditWhere.AND = [{ OR: [{ action: { contains: q, mode: "insensitive" } }, { entityType: { contains: q, mode: "insensitive" } }] }];
  }
  try {
    const [summary, currency, settings, total, audits] = await Promise.all([
      loadCatalogSummary(db),
      readDefaultCurrency(db),
      db.platformSetting.findMany({
        where: { key: { in: ["MINOR_REGISTRATION_ENABLED", "MINOR_TREATMENT_ENABLED", "APPOINTMENT_PAYMENT_HOLD_MINUTES", "DEFAULT_CURRENCY", "SYSTEM_NAME"] } },
      }),
      db.auditLog.count({ where: auditWhere }),
      db.auditLog.findMany({
        where: auditWhere,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * CATALOG_PAGE_SIZE,
        take: CATALOG_PAGE_SIZE,
        select: { id: true, action: true, entityType: true, occurredAt: true, actor: { select: { email: true } } },
      }),
    ]);
    if (!summary.ok) return summary;
    return {
      ok: true as const,
      counts: summary.counts,
      currency,
      settings: settings.map((setting) => ({ key: setting.key, value: setting.valueJson })),
      total,
      page,
      pageSize: CATALOG_PAGE_SIZE,
      audits: audits.map((audit) => ({
        id: audit.id,
        action: audit.action,
        entityType: audit.entityType,
        occurredAt: audit.occurredAt.toISOString(),
        actor: audit.actor?.email ?? "System",
      })),
    };
  } catch (error) {
    return unavailable(error);
  }
}
