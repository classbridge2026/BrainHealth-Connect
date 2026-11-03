import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createPaymentHold } from "@/lib/appointments/payment-holds";
import { createSpecialty, updateSpecialty } from "@/lib/doctors/specialties";
import { updateDefaultCurrency } from "./configuration";
import { placesFromNominatim } from "./geocode";
import { createLocation, updateLocation } from "./locations";
import { decimalToMinorUnits, formatMoneyAmount, parseMoney, sameMoney, snapshotAppointmentFee, visitCharge } from "./money";
import { createDoctorOffering, updateDoctorOffering, updateOfferingFee } from "./offerings";
import { activeOfferingBlocker, bookingCatalogDecision, referencedDeleteDecision } from "./rules";
import { createConsultationService, updateServiceFee } from "./services";

const admin = { userId: "22222222-2222-4222-8222-222222222222", roleCodes: ["ADMIN"] };
const doctorId = "44444444-4444-4444-8444-444444444444";
const specialtyId = "11111111-1111-4111-8111-111111111111";
const serviceId = "55555555-5555-4555-8555-555555555555";
const offeringId = "66666666-6666-4666-8666-666666666666";
const locationId = "77777777-7777-4777-8777-777777777777";

const closedDb = new Proxy(
  {},
  {
    get() {
      throw new Error("database was called");
    },
  },
);

describe("location map verification", () => {
  it("turns a map result into a place without asking for coordinates", () => {
    const places = placesFromNominatim(
      [
        {
          place_id: 9,
          lat: "8.484444",
          lon: "-13.234567",
          display_name: "Wilberforce, Freetown, Western Area, Sierra Leone",
          address: { road: "Wilberforce", city: "Freetown", state: "Western Area", country: "Sierra Leone" },
        },
      ],
      "Freetown",
    );
    expect(places).toHaveLength(1);
    expect(places[0]?.title).toBe("Wilberforce");
    expect(places[0]?.detail).toContain("Freetown");
    expect(places[0]?.latitude).toBe("8.484444");
    expect(places[0]?.district).toBe("Western Area");
  });

  it("requires a verified map point before a location is saved", async () => {
    const result = await createLocation(
      {
        name: "Wilberforce",
        addressLine1: "",
        addressLine2: "",
        locality: "Freetown",
        district: "",
        countryCode: "SL",
        countryCodeOther: "",
        phone: "",
        latitude: "",
        longitude: "",
        accessInstructions: "",
      },
      { db: closedDb as never, actor: admin },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("map");
  });
});

describe("catalog money", () => {
  it("adds decimal money exactly and rejects invalid amounts", () => {
    const sum = parseMoney("0.10")!.plus(parseMoney("0.20")!);
    expect(sum.equals(parseMoney("0.30")!)).toBe(true);
    expect(formatMoneyAmount(sum)).toBe("0.30");
    expect(decimalToMinorUnits(parseMoney("10.10")!)).toBe(1010);
    expect(decimalToMinorUnits(parseMoney("0.00")!)).toBe(0);
    expect(parseMoney("-1")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
    expect(sameMoney("10.10", new Prisma.Decimal("10.1"))).toBe(true);
  });

  it("snapshots the offering price that was current at booking", () => {
    const offering = {
      price: new Prisma.Decimal("15.50"),
      priceAmountMinor: 1550,
      currency: "SLL",
    };
    const snapshot = snapshotAppointmentFee({ offering, fallbackMinor: 1, fallbackCurrency: "USD" });
    offering.price = new Prisma.Decimal("99.00");
    offering.priceAmountMinor = 9900;
    expect(snapshot?.feeAmountMinor).toBe(1550);
    expect(snapshot?.feeAmount.toFixed(2)).toBe("15.50");
    expect(snapshot?.currency).toBe("SLL");
  });

  it("uses the administrator service price when a doctor fee was left at zero", () => {
    const charge = visitCharge({
      price: new Prisma.Decimal("0"),
      priceAmountMinor: 0,
      currency: "SLL",
      defaultFee: new Prisma.Decimal("100.00"),
      defaultCurrency: "SLL",
    });
    expect(charge?.feeAmountMinor).toBe(10000);
    expect(charge?.feeAmount.toFixed(2)).toBe("100.00");
    const kept = visitCharge({
      price: new Prisma.Decimal("15.50"),
      priceAmountMinor: 1550,
      currency: "SLL",
      defaultFee: "100.00",
      defaultCurrency: "SLL",
    });
    expect(kept?.feeAmountMinor).toBe(1550);
  });
});

describe("catalog authorization and validation", () => {
  it("rejects administrators-only changes from other roles", async () => {
    for (const roleCodes of [["DOCTOR"], ["PATIENT"], []]) {
      const actor = { userId: admin.userId, roleCodes };
      const db = closedDb as never;
      expect((await createSpecialty({ name: "Cardiology", slug: "cardiology", description: "" }, { db, actor })).ok).toBe(false);
      expect(
        (
          await createConsultationService(
            {
              name: "Nutrition review",
              slug: "nutrition-review",
              description: "",
              mode: "ONLINE",
              durationMinutes: "30",
              defaultFee: "10.00",
              currency: "SLL",
              preparationInstructions: "",
            },
            { db, actor },
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await createDoctorOffering(
            {
              doctorProfileId: doctorId,
              specialtyId,
              consultationServiceId: serviceId,
              mode: "ONLINE",
              durationMinutes: "30",
              fee: "10.00",
              currency: "SLL",
              notes: "",
              isActive: true,
            },
            { db, actor },
          )
        ).ok,
      ).toBe(false);
      expect(
        (
          await createLocation(
            {
              name: "Wilberforce",
              addressLine1: "12 Main Road",
              addressLine2: "",
              locality: "Freetown",
              district: "Western Area Urban",
              countryCode: "SL",
              countryCodeOther: "",
              phone: "",
              latitude: "",
              longitude: "",
              accessInstructions: "",
            },
            { db, actor },
          )
        ).ok,
      ).toBe(false);
      expect((await updateDefaultCurrency("USD", { db, actor })).ok).toBe(false);
      expect((await updateServiceFee({ id: serviceId, defaultFee: "5.00", currency: "SLL" }, { db, actor })).ok).toBe(false);
    }
  });

  it("rejects duplicate specialty names and slugs", async () => {
    const byName = {
      specialty: { findFirst: async () => ({ nameKey: "cardiology", slug: "heart", code: "HEART" }) },
    };
    const nameResult = await createSpecialty(
      { name: "Cardiology", slug: "cardiology", description: "" },
      { db: byName as never, actor: admin },
    );
    expect(nameResult.ok).toBe(false);
    if (!nameResult.ok) expect(nameResult.message).toContain("name");

    const bySlug = {
      specialty: { findFirst: async () => ({ nameKey: "other", slug: "cardiology", code: "OTHER" }) },
    };
    const slugResult = await createSpecialty(
      { name: "Heart care", slug: "cardiology", description: "" },
      { db: bySlug as never, actor: admin },
    );
    expect(slugResult.ok).toBe(false);
    if (!slugResult.ok) expect(slugResult.message).toContain("slug");
  });

  it("rejects duplicate services, negative fees, and invalid durations", async () => {
    const duplicate = await createConsultationService(
      {
        name: "Online consultation",
        slug: "online-consultation",
        description: "",
        mode: "ONLINE",
        durationMinutes: "30",
        defaultFee: "0.00",
        currency: "SLL",
        preparationInstructions: "",
      },
      { db: { consultationService: { findFirst: async () => ({ name: "Online consultation" }) } } as never, actor: admin },
    );
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.message).toContain("already exists");

    const negative = await createConsultationService(
      {
        name: "Nutrition review",
        slug: "nutrition-review",
        description: "",
        mode: "ANY",
        durationMinutes: "30",
        defaultFee: "-1.00",
        currency: "SLL",
        preparationInstructions: "",
      },
      { db: closedDb as never, actor: admin },
    );
    expect(negative.ok).toBe(false);

    const duration = await createConsultationService(
      {
        name: "Nutrition review",
        slug: "nutrition-review",
        description: "",
        mode: "ANY",
        durationMinutes: "0",
        defaultFee: "10.00",
        currency: "SLL",
        preparationInstructions: "",
      },
      { db: closedDb as never, actor: admin },
    );
    expect(duration.ok).toBe(false);
    if (!duration.ok) expect(duration.message).toContain("duration");
  });
});

describe("offerings, locations, and historical prices", () => {
  const baseDoctor = {
    verificationStatus: "APPROVED",
    user: { status: "ACTIVE", deletedAt: null },
    specialties: [{ claimStatus: "VERIFIED", specialty: { isActive: true } }],
  };

  function offeringDb(doctor = baseDoctor) {
    const created: Array<Record<string, unknown>> = [];
    const appointmentWrites: string[] = [];
    const appointment = { id: "appt", feeAmount: "25.00", feeAmountMinor: 2500 };
    const tx = {
      doctorProfile: { findUnique: async () => doctor },
      consultationService: { findUnique: async () => ({ isActive: true, mode: null }) },
      doctorOffering: {
        findFirst: async () => null,
        findUnique: async () => ({ id: offeringId, doctorProfileId: doctorId, specialtyId, consultationServiceId: serviceId }),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: offeringId, ...data };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => data,
      },
      appointment: {
        update: async () => {
          appointmentWrites.push("update");
        },
        updateMany: async () => {
          appointmentWrites.push("updateMany");
        },
        delete: async () => {
          appointmentWrites.push("delete");
        },
        count: async () => 0,
      },
      doctorAvailabilityRule: { count: async () => 0 },
      auditLog: { create: async () => ({ id: "audit" }) },
    };
    return {
      db: { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) } as never,
      created,
      appointment,
      appointmentWrites,
    };
  }

  it("refuses active offerings for suspended, rejected, and unverified doctors", async () => {
    const cases = [
      { ...baseDoctor, verificationStatus: "SUSPENDED" },
      { ...baseDoctor, verificationStatus: "REJECTED" },
      { ...baseDoctor, verificationStatus: "SUBMITTED" },
      { ...baseDoctor, user: { status: "SUSPENDED", deletedAt: null } },
      { ...baseDoctor, specialties: [{ claimStatus: "DECLARED", specialty: { isActive: true } }] },
    ];
    for (const doctor of cases) {
      const store = offeringDb(doctor);
      const result = await createDoctorOffering(
        {
          doctorProfileId: doctorId,
          specialtyId,
          consultationServiceId: serviceId,
          mode: "ONLINE",
          durationMinutes: "30",
          fee: "25.50",
          currency: "SLL",
          notes: "",
          isActive: true,
        },
        { db: store.db, actor: admin },
      );
      expect(result.ok).toBe(false);
      expect(store.created).toHaveLength(0);
    }
  });

  it("stores a decimal doctor fee and can deactivate a doctor who is no longer approved", async () => {
    const store = offeringDb();
    const created = await createDoctorOffering(
      {
        doctorProfileId: doctorId,
        specialtyId,
        consultationServiceId: serviceId,
        mode: "IN_PERSON",
        durationMinutes: "45",
        fee: "25.50",
        currency: "SLL",
        notes: "Bring previous notes.",
        isActive: true,
      },
      { db: store.db, actor: admin },
    );
    expect(created.ok).toBe(true);
    expect(store.created[0]?.priceAmountMinor).toBe(2550);
    expect(new Prisma.Decimal(store.created[0]?.price as Prisma.Decimal).toFixed(2)).toBe("25.50");

    const suspended = offeringDb({ ...baseDoctor, verificationStatus: "SUSPENDED" });
    const deactivated = await updateDoctorOffering(
      {
        id: offeringId,
        mode: "IN_PERSON",
        durationMinutes: "45",
        fee: "25.50",
        currency: "SLL",
        notes: "",
        isActive: false,
      },
      { db: suspended.db, actor: admin },
    );
    expect(deactivated.ok).toBe(true);
    expect(suspended.appointmentWrites).toEqual([]);
    expect(suspended.appointment.feeAmount).toBe("25.00");
  });

  it("keeps booked appointment fees when current prices change", async () => {
    const store = offeringDb();
    const result = await updateOfferingFee({ id: offeringId, fee: "80.00", currency: "SLL" }, { db: store.db, actor: admin });
    expect(result.ok).toBe(true);
    expect(store.appointment.feeAmount).toBe("25.00");
    expect(store.appointment.feeAmountMinor).toBe(2500);
    expect(store.appointmentWrites).toEqual([]);

    const serviceWrites: string[] = [];
    const serviceDb = {
      consultationService: {
        findUnique: async () => ({ id: serviceId, name: "Initial consultation" }),
        update: async () => ({ id: serviceId }),
      },
      doctorOffering: {
        update: async () => {
          serviceWrites.push("offering");
        },
      },
      appointment: {
        update: async () => {
          serviceWrites.push("appointment");
        },
      },
      auditLog: { create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(serviceDb),
    };
    const fee = await updateServiceFee({ id: serviceId, defaultFee: "12.00", currency: "SLL" }, { db: serviceDb as never, actor: admin });
    expect(fee.ok).toBe(true);
    expect(serviceWrites).toEqual([]);
  });

  it("deactivates a specialty and a location without changing historical rows", async () => {
    const removed: string[] = [];
    const specialtyDb = {
      specialty: {
        findUnique: async () => ({ id: specialtyId, code: "PSYCHIATRY", slug: "psychiatry", name: "Psychiatry" }),
        findFirst: async () => null,
        update: async ({ data }: { data: { isActive: boolean } }) => data,
        delete: async () => {
          removed.push("specialty");
        },
      },
      doctorSpecialty: {
        delete: async () => {
          removed.push("doctor");
        },
      },
      appointment: {
        delete: async () => {
          removed.push("appointment");
        },
        update: async () => {
          removed.push("appointment");
        },
      },
      auditLog: { create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(specialtyDb),
    };
    const specialty = await updateSpecialty(
      { id: specialtyId, name: "Psychiatry", description: "Still on record", sortOrder: "1", isActive: false },
      { db: specialtyDb as never, actor: admin },
    );
    expect(specialty.ok).toBe(true);
    expect(removed).toEqual([]);

    const historical = { id: "appt", feeAmount: "10.00", locationId };
    let locationActive = true;
    const locationDb = {
      location: {
        findUnique: async () => ({ id: locationId, isActive: true, deactivatedAt: null, name: "Clinic" }),
        findFirst: async () => null,
        update: async ({ data }: { data: { isActive: boolean } }) => {
          locationActive = data.isActive;
          return data;
        },
        delete: async () => {
          removed.push("location");
        },
      },
      appointment: {
        update: async () => {
          removed.push("appointment");
        },
        delete: async () => {
          removed.push("appointment");
        },
      },
      auditLog: { create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(locationDb),
    };
    const location = await updateLocation(
      {
        id: locationId,
        name: "Wilberforce clinic",
        addressLine1: "12 Main Road",
        addressLine2: "",
        locality: "Freetown",
        district: "Western Area Urban",
        countryCode: "SL",
        countryCodeOther: "",
        phone: "076123456",
        latitude: "8.484",
        longitude: "-13.234",
        accessInstructions: "Step-free entrance",
        isActive: false,
      },
      { db: locationDb as never, actor: admin },
    );
    expect(location.ok).toBe(true);
    expect(locationActive).toBe(false);
    expect(historical.feeAmount).toBe("10.00");
    expect(historical.locationId).toBe(locationId);
    expect(removed).toEqual([]);
  });

  it("blocks inactive services and locations for a new appointment and copies the offering fee", async () => {
    const created: Array<Record<string, unknown>> = [];
    const eligibleDoctor = {
      verificationStatus: "APPROVED",
      user: { status: "ACTIVE", deletedAt: null },
      specialties: [{ claimStatus: "VERIFIED", specialty: { isActive: true } }],
    };
    function holdDb(options: { serviceActive: boolean; locationActive?: boolean; offering?: boolean }) {
      const tx = {
        doctorProfile: { findUnique: async () => eligibleDoctor },
        consultationService: { findUnique: async () => ({ isActive: options.serviceActive }) },
        location: { findUnique: async () => ({ isActive: options.locationActive ?? true }) },
        doctorOffering: {
          findUnique: async () =>
            options.offering
              ? {
                  isActive: true,
                  doctorProfileId: doctorId,
                  consultationServiceId: serviceId,
                  specialtyId,
                  mode: "ONLINE",
                  price: new Prisma.Decimal("15.50"),
                  priceAmountMinor: 1550,
                  currency: "SLL",
                }
              : null,
        },
        appointment: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return { id: "appt-1" };
          },
        },
        appointmentEvent: { create: async () => ({}) },
        platformSetting: { findUnique: async () => ({ valueJson: 10 }) },
        $queryRaw: async () => [],
      };
      return { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
    }
    const input = {
      patientProfileId: "88888888-8888-4888-8888-888888888888",
      doctorProfileId: doctorId,
      specialtyId,
      consultationServiceId: serviceId,
      mode: "ONLINE" as const,
      startsAt: new Date("2026-10-20T10:00:00Z"),
      endsAt: new Date("2026-10-20T10:30:00Z"),
      feeAmountMinor: 1,
      currency: "USD",
    };

    const inactiveService = await createPaymentHold(input, holdDb({ serviceActive: false }) as never);
    expect(inactiveService).toEqual({ ok: false, code: "CATALOG_UNAVAILABLE" });

    const inactiveLocation = await createPaymentHold(
      { ...input, locationId },
      holdDb({ serviceActive: true, locationActive: false }) as never,
    );
    expect(inactiveLocation).toEqual({ ok: false, code: "CATALOG_UNAVAILABLE" });
    expect(created).toHaveLength(0);

    const booked = await createPaymentHold({ ...input, offeringId }, holdDb({ serviceActive: true, offering: true }) as never);
    expect(booked.ok).toBe(true);
    expect(created[0]?.feeAmountMinor).toBe(1550);
    expect(new Prisma.Decimal(created[0]?.feeAmount as Prisma.Decimal).toFixed(2)).toBe("15.50");
    expect(created[0]?.currency).toBe("SLL");
  });
});

describe("catalog rules", () => {
  it("describes who can have an active offering and what can be deleted", () => {
    expect(
      activeOfferingBlocker({
        verificationStatus: "SUSPENDED",
        userStatus: "ACTIVE",
        deletedAt: null,
        specialtyClaim: "VERIFIED",
        specialtyActive: true,
        serviceActive: true,
        serviceMode: null,
        offeringMode: "ONLINE",
      }),
    ).toBeTruthy();
    expect(bookingCatalogDecision({ serviceActive: false, locationRequested: false, locationActive: null, offeringRequested: false, offeringActive: null, offeringMatches: false })).toBe(
      "blocked",
    );
    expect(
      bookingCatalogDecision({
        serviceActive: true,
        locationRequested: true,
        locationActive: false,
        offeringRequested: false,
        offeringActive: null,
        offeringMatches: false,
      }),
    ).toBe("blocked");
    expect(referencedDeleteDecision({ appointments: 2 }, "offering").allowed).toBe(false);
    expect(referencedDeleteDecision({ appointments: 0, rules: 0 }, "location").allowed).toBe(true);
  });
});
