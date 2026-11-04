import { Prisma, type PrismaClient } from "@prisma/client";
import { listBookableSpecialties } from "@/lib/appointments/queries";
import { rememberFor } from "@/lib/db/remember";
import { isSchemaMismatch } from "@/lib/doctors/errors";

/** Platform-setting keys an administrator can publish for the public contact section. */
export const PUBLIC_CONTACT_EMAIL_KEY = "PUBLIC_CONTACT_EMAIL";
export const PUBLIC_CONTACT_PHONE_KEY = "PUBLIC_CONTACT_PHONE";
export const PUBLIC_CONTACT_ADDRESS_KEY = "PUBLIC_CONTACT_ADDRESS";

const CONTACT_KEYS = [PUBLIC_CONTACT_EMAIL_KEY, PUBLIC_CONTACT_PHONE_KEY, PUBLIC_CONTACT_ADDRESS_KEY];

const approvedDoctor = {
  verificationStatus: "APPROVED" as const,
  user: { status: "ACTIVE" as const, deletedAt: null },
};

export type PublicContact = {
  email: string | null;
  phone: string | null;
  address: string | null;
};

export type PublicSpecialty = {
  id: string;
  name: string;
  description: string | null;
  bookable: boolean;
  lead: boolean;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  bookable: boolean;
  modes: Array<"ONLINE" | "IN_PERSON">;
  durationLabel: string | null;
  fee: string | null;
};

export type PublicDoctor = {
  id: string;
  displayName: string;
  biography: string | null;
  qualification: string | null;
  specialties: string[];
  languages: string[];
  consultationTypes: Array<"ONLINE" | "IN_PERSON">;
  services: string[];
  sessionFee: string | null;
  photo: { userId: string; version: string } | null;
};

export type PublicOffering = {
  id: string;
  doctorId: string;
  doctorName: string;
  serviceName: string;
  specialtyName: string;
  mode: "ONLINE" | "IN_PERSON";
  durationMinutes: number;
  fee: string | null;
};

export type PublicLanding = {
  ok: boolean;
  code?: "SCHEMA" | "UNAVAILABLE";
  specialties: PublicSpecialty[];
  services: PublicService[];
  offerings: PublicOffering[];
  doctors: PublicDoctor[];
  contact: PublicContact;
};

const emptyContact: PublicContact = { email: null, phone: null, address: null };

export function isLeadSpecialty(specialty: { name: string; slug?: string }): boolean {
  const name = specialty.name.toLowerCase();
  const slug = (specialty.slug ?? "").toLowerCase();
  return name.includes("mental health") || slug.includes("mental-health") || name.includes("psychiatr") || slug.includes("psychiatr");
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function storedString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" ? cleanText(value) : null;
}

export function normalizePublicContact(input: { email: string; phone: string; address: string }):
  | { ok: true; email: string | null; phone: string | null; address: string | null }
  | { ok: false; message: string } {
  const email = cleanText(input.email);
  const phone = cleanText(input.phone);
  const address = cleanText(input.address);
  if (email && (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { ok: false, message: "Enter a valid public email address, up to 120 characters." };
  }
  if (phone && !/^\+?[0-9][0-9\s().-]{6,22}$/.test(phone)) {
    return { ok: false, message: "Enter a public phone number, such as +232 76 000 000." };
  }
  if (address && (address.length < 5 || address.length > 200)) {
    return { ok: false, message: "Enter a public address between 5 and 200 characters, or leave it blank." };
  }
  return { ok: true, email, phone, address };
}

export async function savePublicContact(
  input: { email: string; phone: string; address: string },
  db: PrismaClient,
  actorUserId: string,
) {
  const parsed = normalizePublicContact(input);
  if (!parsed.ok) return parsed;
  const fields = [
    [PUBLIC_CONTACT_EMAIL_KEY, parsed.email],
    [PUBLIC_CONTACT_PHONE_KEY, parsed.phone],
    [PUBLIC_CONTACT_ADDRESS_KEY, parsed.address],
  ] as const;
  await db.$transaction(async (tx) => {
    const prior = await tx.platformSetting.findFirst({
      where: { key: { in: fields.map(([key]) => key) } },
      select: { id: true },
    });
    let entityId = prior?.id ?? actorUserId;
    for (const [key, value] of fields) {
      if (!value) {
        await tx.platformSetting.deleteMany({ where: { key } });
        continue;
      }
      const saved = await tx.platformSetting.upsert({
        where: { key },
        create: { key, valueJson: value },
        update: { valueJson: value },
      });
      entityId = saved.id;
    }
    await tx.auditLog.create({
      data: {
        actorUserId,
        action: "settings.public_contact_updated",
        entityType: "PlatformSetting",
        entityId,
        metadata: {
          email: Boolean(parsed.email),
          phone: Boolean(parsed.phone),
          address: Boolean(parsed.address),
        },
      },
    });
  });
  const shown = [parsed.email, parsed.phone, parsed.address].filter(Boolean).length;
  return {
    ok: true as const,
    message: shown === 0
      ? "Public contact details were cleared. The homepage notice stays until an email, phone, or address is saved."
      : "Public contact details are saved. The homepage shows the email, phone, and address that were filled in.",
  };
}

export function readPublicContact(rows: { key: string; valueJson: Prisma.JsonValue }[]): PublicContact {
  const byKey = new Map(rows.map((row) => [row.key, row.valueJson]));
  const email = storedString(byKey.get(PUBLIC_CONTACT_EMAIL_KEY));
  const phone = storedString(byKey.get(PUBLIC_CONTACT_PHONE_KEY));
  const address = storedString(byKey.get(PUBLIC_CONTACT_ADDRESS_KEY));
  return {
    email: email && email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    phone: phone && /^\+?[0-9][0-9\s().-]{6,22}$/.test(phone) ? phone : null,
    address: address && address.length >= 5 && address.length <= 200 ? address : null,
  };
}

export function formatQualification(
  input: { title: string | null; institution: string | null; year: number | null },
  nowYear: number,
): string | null {
  const title = cleanText(input.title);
  if (!title) return null;
  const institution = cleanText(input.institution);
  const yearOk = typeof input.year === "number" && input.year >= 1940 && input.year <= nowYear + 1;
  const line = institution ? `${title}, ${institution}` : title;
  return yearOk ? `${line} (${input.year})` : line;
}

export function publicDurationLabel(minutes: number[]): string | null {
  const values = [...new Set(minutes.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return null;
  return first === last ? `${first} min` : `${first}–${last} min`;
}

export function uniqueConsultationModes(modes: Array<"ONLINE" | "IN_PERSON">): Array<"ONLINE" | "IN_PERSON"> {
  const present = new Set(modes);
  return (["IN_PERSON", "ONLINE"] as const).filter((mode) => present.has(mode));
}

export function publicLanguages(values: string[]): string[] {
  const seen = new Set<string>();
  const languages: string[] = [];
  for (const value of values) {
    const text = value.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (text.length < 2 || text.length > 40 || seen.has(key)) continue;
    seen.add(key);
    languages.push(text);
    if (languages.length === 3) break;
  }
  return languages;
}

export function publicSessionFee(rows: { price: { toString(): string }; currency: string }[]): string | null {
  const priced = rows.flatMap((row) => {
    const currency = row.currency.replace(/[^A-Za-z]/g, "").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return [];
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(row.price.toString());
    } catch {
      return [];
    }
    if (!amount.gt(0)) return [];
    return [{ amount, currency }];
  });
  if (priced.length === 0) return null;
  const currency = priced[0]?.currency;
  if (!currency || priced.some((row) => row.currency !== currency)) return null;
  priced.sort((left, right) => left.amount.comparedTo(right.amount));
  const lowest = priced[0];
  if (!lowest) return null;
  const shown = lowest.amount.toFixed(2).replace(/\.00$/, "");
  const varies = priced.some((row) => !row.amount.equals(lowest.amount));
  return `${varies ? "From " : ""}${currency} ${shown} / session`;
}

/** Offering price first, then the service default when a doctor fee was not stored. */
export function publishedServiceFee(input: {
  offerings: Array<{ price: { toString(): string }; priceAmountMinor?: number | null; currency: string }>;
  defaultFee?: { toString(): string } | null;
  currency?: string | null;
}): string | null {
  const offeringFee = publicSessionFee(input.offerings);
  if (offeringFee) return offeringFee;
  const fromMinor = publicSessionFee(
    input.offerings.flatMap((row) => {
      const minor = row.priceAmountMinor;
      if (typeof minor !== "number" || !Number.isSafeInteger(minor) || minor <= 0) return [];
      return [{ price: { toString: () => new Prisma.Decimal(minor).div(100).toFixed(2) }, currency: row.currency }];
    }),
  );
  if (fromMinor) return fromMinor;
  if (!input.defaultFee || !input.currency) return null;
  return publicSessionFee([{ price: input.defaultFee, currency: input.currency }]);
}

export function excerpt(value: string, max = 220): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const shortened = (lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${shortened}…`;
}

function unavailable(contact: PublicContact, code: "SCHEMA" | "UNAVAILABLE"): PublicLanding {
  return { ok: false, code, specialties: [], services: [], offerings: [], doctors: [], contact };
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

async function readPublicLanding(db: PrismaClient, now: Date): Promise<PublicLanding> {
  try {
    const [specialtyResult, bookableResult, serviceResult, offeringResult, doctorResult, settingsResult] = await Promise.allSettled([
      db.specialty.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true, description: true },
      }),
      listBookableSpecialties(db),
      db.consultationService.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        take: 12,
        select: {
          id: true,
          name: true,
          description: true,
          mode: true,
          defaultDurationMinutes: true,
          defaultFee: true,
          currency: true,
          offerings: {
            where: {
              isActive: true,
              specialty: { isActive: true },
              doctor: approvedDoctor,
            },
            select: { mode: true, durationMinutes: true, price: true, priceAmountMinor: true, currency: true },
          },
        },
      }),
      db.doctorOffering.findMany({
        where: {
          isActive: true,
          consultationService: { isActive: true },
          specialty: { isActive: true },
          doctor: approvedDoctor,
        },
        orderBy: [{ consultationService: { name: "asc" } }, { doctor: { displayName: "asc" } }],
        take: 12,
        select: {
          id: true,
          mode: true,
          durationMinutes: true,
          price: true,
          currency: true,
          specialty: { select: { id: true, name: true } },
          consultationService: { select: { name: true } },
          doctor: { select: { id: true, displayName: true, fullName: true } },
        },
      }),
      db.doctorProfile.findMany({
        where: {
          ...approvedDoctor,
          specialties: { some: { claimStatus: "VERIFIED", specialty: { isActive: true } } },
        },
        orderBy: { displayName: "asc" },
        take: 24,
        select: {
          id: true,
          fullName: true,
          displayName: true,
          biography: true,
          user: { select: { id: true, profileImageUpdatedAt: true } },
          qualificationTitle: true,
          qualificationInstitution: true,
          qualificationYear: true,
          languages: true,
          specialties: {
            where: { claimStatus: "VERIFIED", specialty: { isActive: true } },
            orderBy: [{ isPrimary: "desc" }, { specialty: { name: "asc" } }],
            select: { specialty: { select: { name: true } } },
          },
          offerings: {
            where: {
              isActive: true,
              consultationService: { isActive: true },
              specialty: { isActive: true },
            },
            select: { mode: true, price: true, currency: true, consultationService: { select: { name: true } } },
          },
        },
      }),
      db.platformSetting.findMany({
        where: { key: { in: CONTACT_KEYS } },
        select: { key: true, valueJson: true },
      }),
    ]);

    const failures = [specialtyResult, serviceResult, offeringResult, doctorResult, settingsResult].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const specialtyRows = fulfilled(specialtyResult) ?? [];
    const serviceRows = fulfilled(serviceResult) ?? [];
    const offeringRows = fulfilled(offeringResult) ?? [];
    const doctorRows = fulfilled(doctorResult) ?? [];
    const settings = fulfilled(settingsResult) ?? [];
    const contact = readPublicContact(settings);
    const listingsMissing = specialtyRows.length === 0 && serviceRows.length === 0 && offeringRows.length === 0 && doctorRows.length === 0;
    if (listingsMissing && failures.length > 0) {
      return unavailable(contact, failures.some((error) => isSchemaMismatch(error)) ? "SCHEMA" : "UNAVAILABLE");
    }

    const bookable = bookableResult.status === "fulfilled" ? bookableResult.value : { ok: false as const, code: "UNAVAILABLE" as const };
    if (!bookable.ok && bookable.code === "SCHEMA" && listingsMissing) {
      return unavailable(contact, "SCHEMA");
    }
    const bookableIds = new Set(
      bookable.ok ? bookable.specialties.map((specialty) => specialty.id) : offeringRows.map((offering) => offering.specialty.id),
    );
    const specialties = specialtyRows.map((specialty) => ({
      id: specialty.id,
      name: specialty.name,
      description: cleanText(specialty.description),
      bookable: bookableIds.has(specialty.id),
      lead: isLeadSpecialty(specialty),
    }));
    const lead = specialties.find((specialty) => specialty.lead) ?? null;
    const orderedSpecialties = lead
      ? [lead, ...specialties.filter((specialty) => specialty !== lead)]
      : specialties;

    const doctors = doctorRows
      .map((doctor) => {
        const biography = cleanText(doctor.biography);
        const displayName = doctor.displayName.trim() || doctor.fullName.trim();
        const services = [...new Set(doctor.offerings.map((offering) => offering.consultationService.name.trim()).filter((name) => name.length > 0))].slice(0, 3);
        return {
          id: doctor.id,
          displayName,
          biography: biography ? excerpt(biography) : null,
          qualification: formatQualification(
            {
              title: doctor.qualificationTitle,
              institution: doctor.qualificationInstitution,
              year: doctor.qualificationYear,
            },
            now.getUTCFullYear(),
          ),
          specialties: doctor.specialties.map((row) => row.specialty.name),
          languages: publicLanguages(doctor.languages),
          consultationTypes: uniqueConsultationModes(doctor.offerings.map((offering) => offering.mode)),
          services,
          sessionFee: publicSessionFee(doctor.offerings),
          photo: doctor.user.profileImageUpdatedAt
            ? { userId: doctor.user.id, version: doctor.user.profileImageUpdatedAt.toISOString() }
            : null,
        };
      })
      .filter((doctor) => doctor.displayName.length >= 2 && doctor.specialties.length > 0)
      .sort((left, right) => Number(right.services.length > 0) - Number(left.services.length > 0))
      .slice(0, 6);

    const offerings = offeringRows.flatMap((offering) => {
      const doctorName = offering.doctor.displayName.trim() || offering.doctor.fullName.trim();
      const serviceName = offering.consultationService.name.trim();
      const specialtyName = offering.specialty.name.trim();
      if (doctorName.length < 2 || serviceName.length === 0 || specialtyName.length === 0) return [];
      return [
        {
          id: offering.id,
          doctorId: offering.doctor.id,
          doctorName,
          serviceName,
          specialtyName,
          mode: offering.mode,
          durationMinutes: offering.durationMinutes,
          fee: publicSessionFee([{ price: offering.price, currency: offering.currency }]),
        },
      ];
    });

    return {
      ok: true,
      specialties: orderedSpecialties,
      services: serviceRows.map((service) => {
        const modes = uniqueConsultationModes(service.offerings.map((offering) => offering.mode));
        const shownModes = modes.length > 0 ? modes : service.mode ? [service.mode] : [];
        const durations = service.offerings.map((offering) => offering.durationMinutes);
        return {
          id: service.id,
          name: service.name,
          description: cleanText(service.description),
          bookable: modes.length > 0,
          modes: shownModes,
          durationLabel: publicDurationLabel(durations.length > 0 ? durations : [service.defaultDurationMinutes]),
          fee: publishedServiceFee({
            offerings: service.offerings,
            defaultFee: service.defaultFee,
            currency: service.currency,
          }),
        };
      }),
      offerings,
      doctors,
      contact,
    };
  } catch (error) {
    return unavailable(emptyContact, isSchemaMismatch(error) ? "SCHEMA" : "UNAVAILABLE");
  }
}

export async function loadPublicLanding(db: PrismaClient, now = new Date()): Promise<PublicLanding> {
  if (process.env.NODE_ENV === "test") return readPublicLanding(db, now);
  return rememberFor(`public-landing:${Math.floor(now.getTime() / 60_000)}`, 60_000, () => readPublicLanding(db, now), (page) => page.ok);
}
