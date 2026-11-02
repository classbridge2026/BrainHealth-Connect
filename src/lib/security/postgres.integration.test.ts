import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { createRateLimiter } from "@/lib/auth/rate-limit";
import { hashSessionToken } from "@/lib/auth/tokens";
import { readSessionUser } from "@/lib/auth/current-user";
import { changeElevatedRole } from "@/lib/admin/mutations";
import { loadPatientDetail } from "@/lib/admin/directories";
import { bookScheduledSlot } from "@/lib/appointments/booking";
import { confirmVerifiedPayment } from "@/lib/appointments/payment-holds";
import { loadReleasedSummary } from "@/lib/patient/portal";

process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.EMAIL_FROM = "";

function isolatedUrl(): string | null {
  const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL.");
  }
  const host = parsed.hostname;
  const name = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error("Integration tests refuse a database that is not on localhost.");
  }
  if (!/test/i.test(name)) {
    throw new Error("Integration tests refuse a database whose name does not contain 'test'.");
  }
  return url;
}

const databaseUrl = isolatedUrl();
const enabled = databaseUrl !== null;
const db = enabled
  ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  : (null as unknown as PrismaClient);

type VisitGraph = {
  doctorUserId: string;
  doctorProfileId: string;
  specialtyId: string;
  serviceId: string;
  offeringId: string;
  patients: Array<{ userId: string; profileId: string }>;
};

async function ensureRole(code: string, name: string) {
  return db.role.upsert({ where: { code }, update: {}, create: { code, name }, select: { id: true } });
}

async function seedVisitGraph(label: string, patientCount: number): Promise<VisitGraph> {
  const patientRole = await ensureRole("PATIENT", "Patient");
  const doctorRole = await ensureRole("DOCTOR", "Doctor");
  const suffix = randomUUID().slice(0, 8);
  const specialty = await db.specialty.create({
    data: {
      code: `phase15-${suffix}`,
      slug: `phase15-${suffix}`,
      name: `Phase 15 ${label}`,
      nameKey: `phase15-${suffix}`,
      isActive: true,
    },
  });
  const service = await db.consultationService.create({
    data: {
      code: `phase15-svc-${suffix}`,
      slug: `phase15-svc-${suffix}`,
      name: `Phase 15 visit ${label}`,
      nameKey: `phase15-svc-${suffix}`,
      defaultDurationMinutes: 30,
      isActive: true,
      currency: "SLL",
    },
  });
  const doctorUser = await db.user.create({
    data: {
      email: `doctor-${suffix}@example.invalid`,
      emailNormalized: `doctor-${suffix}@example.invalid`,
      passwordHash: "integration-hash-not-used",
      status: "ACTIVE",
      roles: { create: { roleId: doctorRole.id } },
      doctorProfile: {
        create: {
          fullName: "Phase Fifteen Doctor",
          displayName: "Dr Phase Fifteen",
          verificationStatus: "APPROVED",
          verifiedAt: new Date(),
        },
      },
    },
    select: { id: true, doctorProfile: { select: { id: true } } },
  });
  const doctorProfileId = doctorUser.doctorProfile!.id;
  await db.doctorSpecialty.create({
    data: { doctorProfileId, specialtyId: specialty.id, claimStatus: "VERIFIED", isPrimary: true, verifiedAt: new Date() },
  });
  const offering = await db.doctorOffering.create({
    data: {
      doctorProfileId,
      specialtyId: specialty.id,
      consultationServiceId: service.id,
      mode: "ONLINE",
      durationMinutes: 30,
      price: new Prisma.Decimal("15.50"),
      priceAmountMinor: 1550,
      currency: "SLL",
      isActive: true,
    },
  });
  await db.doctorAvailabilityRule.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
      doctorProfileId,
      dayOfWeek,
      localStartTime: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)),
      localEndTime: new Date(Date.UTC(1970, 0, 1, 23, 0, 0)),
      timezone: "Africa/Freetown",
      mode: "ONLINE" as const,
      isActive: true,
    })),
  });
  const patients = [];
  for (let index = 0; index < patientCount; index += 1) {
    const id = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `patient-${suffix}-${id}@example.invalid`,
        emailNormalized: `patient-${suffix}-${id}@example.invalid`,
        passwordHash: "integration-hash-not-used",
        status: "ACTIVE",
        roles: { create: { roleId: patientRole.id } },
        patientProfile: { create: { fullName: `Phase Fifteen ${label} ${index}`, gender: "FEMALE" } },
      },
      select: { id: true, patientProfile: { select: { id: true } } },
    });
    patients.push({ userId: user.id, profileId: user.patientProfile!.id });
  }
  return {
    doctorUserId: doctorUser.id,
    doctorProfileId,
    specialtyId: specialty.id,
    serviceId: service.id,
    offeringId: offering.id,
    patients,
  };
}

function futureSlot(): Date {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 21);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 10, 0, 0));
}

async function insertVisit(input: {
  graph: VisitGraph;
  patientIndex?: number;
  status: "CONFIRMED" | "PENDING_PAYMENT" | "CANCELLED_BY_PATIENT" | "RESCHEDULED";
  startsAt: Date;
  hold?: Date | null;
}) {
  const patient = input.graph.patients[input.patientIndex ?? 0]!;
  const endsAt = new Date(input.startsAt.getTime() + 30 * 60_000);
  return db.appointment.create({
    data: {
      patientProfileId: patient.profileId,
      doctorProfileId: input.graph.doctorProfileId,
      specialtyId: input.graph.specialtyId,
      consultationServiceId: input.graph.serviceId,
      offeringId: input.graph.offeringId,
      mode: "ONLINE",
      status: input.status,
      startsAt: input.startsAt,
      endsAt,
      paymentHoldExpiresAt: input.hold ?? null,
      feeAmount: new Prisma.Decimal("15.50"),
      feeAmountMinor: 1550,
      currency: "SLL",
    },
  });
}

describe.skipIf(!enabled)("isolated PostgreSQL", () => {
  beforeAll(async () => {
    await db.$connect();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("has the doctor overlap exclusion constraint and the audit immutability triggers", async () => {
    const constraints = await db.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname = 'Appointment_doctor_occupying_no_overlap'
    `;
    const triggers = await db.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE tgname IN ('AuditLog_no_mutation', 'RecordAccessLog_no_mutation')
    `;
    expect(constraints).toHaveLength(1);
    expect(triggers.map((row) => row.tgname).sort()).toEqual(["AuditLog_no_mutation", "RecordAccessLog_no_mutation"]);
  });

  it("lets only one of two simultaneous overlapping inserts occupy the doctor", async () => {
    const graph = await seedVisitGraph("overlap", 1);
    const startsAt = futureSlot();
    const started = Date.now();
    const attempts = await Promise.allSettled([
      insertVisit({ graph, status: "CONFIRMED", startsAt }),
      insertVisit({ graph, status: "CONFIRMED", startsAt }),
    ]);
    console.info(`phase15_overlap_ms=${Date.now() - started}`);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/23P01|Appointment_doctor_occupying_no_overlap/);
    const stored = await db.appointment.count({ where: { doctorProfileId: graph.doctorProfileId, startsAt } });
    expect(stored).toBe(1);
  });

  it("releases an expired hold and keeps a live hold or a cancelled visit consistent", async () => {
    const graph = await seedVisitGraph("holds", 1);
    const startsAt = futureSlot();
    const held = await insertVisit({
      graph,
      status: "PENDING_PAYMENT",
      startsAt,
      hold: new Date(Date.now() + 10 * 60_000),
    });
    await expect(insertVisit({ graph, status: "CONFIRMED", startsAt })).rejects.toThrow(/23P01|Appointment_doctor_occupying_no_overlap/);
    await db.appointment.update({ where: { id: held.id }, data: { paymentHoldExpiresAt: new Date(Date.now() - 60_000) } });
    const replacement = await insertVisit({ graph, status: "CONFIRMED", startsAt });
    const expired = await db.appointment.findUnique({ where: { id: held.id }, select: { status: true } });
    expect(expired?.status).toBe("EXPIRED_UNPAID");
    expect(replacement.status).toBe("CONFIRMED");

    await db.appointment.update({
      where: { id: replacement.id },
      data: { status: "CANCELLED_BY_PATIENT", cancelledAt: new Date(), cancellationReason: "Patient cancelled this test visit." },
    });
    const reopened = await insertVisit({ graph, status: "CONFIRMED", startsAt });
    expect(reopened.id).not.toBe(replacement.id);
  });

  it("rolls back an appointment insert when the transaction fails", async () => {
    const graph = await seedVisitGraph("rollback", 1);
    const id = randomUUID();
    const startsAt = futureSlot();
    await expect(
      db.$transaction(async (tx) => {
        await tx.appointment.create({
          data: {
            id,
            patientProfileId: graph.patients[0]!.profileId,
            doctorProfileId: graph.doctorProfileId,
            specialtyId: graph.specialtyId,
            consultationServiceId: graph.serviceId,
            mode: "ONLINE",
            status: "CONFIRMED",
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            feeAmount: new Prisma.Decimal("15.50"),
            feeAmountMinor: 1550,
            currency: "SLL",
          },
        });
        throw new Error("phase15-rollback");
      }),
    ).rejects.toThrow("phase15-rollback");
    expect(await db.appointment.findUnique({ where: { id } })).toBeNull();
    await expect(
      db.appointment.create({
        data: {
          patientProfileId: randomUUID(),
          doctorProfileId: graph.doctorProfileId,
          specialtyId: graph.specialtyId,
          consultationServiceId: graph.serviceId,
          mode: "ONLINE",
          status: "CONFIRMED",
          startsAt: new Date(startsAt.getTime() + 60 * 60_000),
          endsAt: new Date(startsAt.getTime() + 90 * 60_000),
          feeAmount: new Prisma.Decimal("15.50"),
          feeAmountMinor: 1550,
          currency: "SLL",
        },
      }),
    ).rejects.toThrow();
  });

  it("books one of two concurrent patients onto the catalog fee and leaves the other without a visit", async () => {
    const graph = await seedVisitGraph("booking", 2);
    const startsAt = futureSlot();
    const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
    const results = await Promise.all(
      graph.patients.map((patient) =>
        bookScheduledSlot(
          { actorUserId: patient.userId, offeringId: graph.offeringId, startsAt, concern: "Tooth pain on the left side since yesterday.", channel: "VIDEO" },
          { db, rateLimiter: limiter },
        ),
      ),
    );
    const codes = results.map((result) => (result.ok ? "ok" : result.code)).sort();
    expect(codes).toEqual(["SLOT_UNAVAILABLE", "ok"]);
    const rows = await db.appointment.findMany({
      where: { doctorProfileId: graph.doctorProfileId, startsAt },
      select: { feeAmountMinor: true, currency: true, status: true, patientProfileId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ feeAmountMinor: 1550, currency: "SLL", status: "PENDING_PAYMENT", visitChannel: "VIDEO" });
  });

  it("confirms a matching payment once and refuses a mismatched amount or a second provider event", async () => {
    const graph = await seedVisitGraph("payment", 1);
    const startsAt = futureSlot();
    const appointment = await insertVisit({
      graph,
      status: "PENDING_PAYMENT",
      startsAt,
      hold: new Date(Date.now() + 20 * 60_000),
    });
    const wrong = await db.payment.create({
      data: {
        appointmentId: appointment.id,
        payerUserId: graph.patients[0]!.userId,
        amountMinor: 1,
        currency: "SLL",
        status: "PENDING",
        providerCode: "manual",
        providerReference: `wrong-${appointment.id}`,
      },
    });
    const mismatch = await confirmVerifiedPayment({ appointmentId: appointment.id, paymentId: wrong.id }, db);
    expect(mismatch).toEqual({ ok: false, code: "AMOUNT_MISMATCH" });
    expect((await db.appointment.findUnique({ where: { id: appointment.id } }))?.status).toBe("PENDING_PAYMENT");
    expect((await db.payment.findUnique({ where: { id: wrong.id } }))?.status).toBe("PENDING");

    const payment = await db.payment.create({
      data: {
        appointmentId: appointment.id,
        payerUserId: graph.patients[0]!.userId,
        amountMinor: 1550,
        currency: "SLL",
        status: "PENDING",
        providerCode: "manual",
        providerReference: `paid-${appointment.id}`,
      },
    });
    const confirmed = await confirmVerifiedPayment({ appointmentId: appointment.id, paymentId: payment.id }, db);
    expect(confirmed).toMatchObject({ ok: true, alreadyConfirmed: false });
    const again = await confirmVerifiedPayment({ appointmentId: appointment.id, paymentId: payment.id }, db);
    expect(again).toMatchObject({ ok: true, alreadyConfirmed: true });
    expect(await db.paymentEvent.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await db.payment.findUnique({ where: { id: payment.id } }))?.status).toBe("PAID");
    await expect(
      db.paymentEvent.create({
        data: {
          paymentId: payment.id,
          providerCode: "manual",
          providerEventId: `verified:${payment.id}`,
          status: "PAID",
        },
      }),
    ).rejects.toThrow();
  });

  it("hides private and other patients' notes, and blocks a patient from granting an administrator role", async () => {
    const graph = await seedVisitGraph("privacy", 2);
    const startsAt = futureSlot();
    const first = await insertVisit({ graph, patientIndex: 0, status: "CONFIRMED", startsAt });
    const secondStarts = new Date(startsAt.getTime() + 60 * 60_000);
    const second = await insertVisit({ graph, patientIndex: 1, status: "CONFIRMED", startsAt: secondStarts });
    const encounter = await db.encounter.create({
      data: {
        appointmentId: first.id,
        patientProfileId: graph.patients[0]!.profileId,
        doctorProfileId: graph.doctorProfileId,
        status: "COMPLETED",
      },
    });
    const privateNote = await db.clinicalNote.create({
      data: {
        encounterId: encounter.id,
        authorDoctorProfileId: graph.doctorProfileId,
        kind: "PRIVATE_WORKING",
        body: "PRIVATE PHASE15 NOTE",
      },
    });
    const released = await db.clinicalNote.create({
      data: {
        encounterId: encounter.id,
        authorDoctorProfileId: graph.doctorProfileId,
        kind: "PATIENT_SUMMARY",
        summaryReleaseStatus: "RELEASED",
        releasedAt: new Date(),
        body: "RELEASED PHASE15 SUMMARY",
      },
    });
    const otherEncounter = await db.encounter.create({
      data: {
        appointmentId: second.id,
        patientProfileId: graph.patients[1]!.profileId,
        doctorProfileId: graph.doctorProfileId,
        status: "COMPLETED",
      },
    });
    const otherReleased = await db.clinicalNote.create({
      data: {
        encounterId: otherEncounter.id,
        authorDoctorProfileId: graph.doctorProfileId,
        kind: "PATIENT_SUMMARY",
        summaryReleaseStatus: "RELEASED",
        releasedAt: new Date(),
        body: "OTHER PATIENT PHASE15 SUMMARY",
      },
    });

    const own = await loadReleasedSummary(db, { id: released.id, userId: graph.patients[0]!.userId });
    const hidden = await loadReleasedSummary(db, { id: privateNote.id, userId: graph.patients[0]!.userId });
    const cross = await loadReleasedSummary(db, { id: otherReleased.id, userId: graph.patients[0]!.userId });
    if (!own.ok) throw new Error("The patient could not read the released summary.");
    expect(own.summary.body).toBe("RELEASED PHASE15 SUMMARY");
    expect(hidden).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(cross).toEqual({ ok: false, code: "NOT_FOUND" });
    const adminView = await loadPatientDetail(db, graph.patients[0]!.profileId);
    expect(JSON.stringify(adminView)).not.toContain("PRIVATE PHASE15 NOTE");
    expect(JSON.stringify(adminView)).not.toContain("RELEASED PHASE15 SUMMARY");

    const before = await db.userRole.count({ where: { userId: graph.doctorUserId, role: { code: ADMIN_ROLE_CODE } } });
    const grant = await changeElevatedRole(
      { userId: graph.doctorUserId, roleCode: ADMIN_ROLE_CODE, change: "grant" },
      { db, actor: { userId: graph.patients[0]!.userId, roleCodes: ["PATIENT"] } },
    );
    const after = await db.userRole.count({ where: { userId: graph.doctorUserId, role: { code: ADMIN_ROLE_CODE } } });
    expect(grant.ok).toBe(false);
    expect(after).toBe(before);
  });

  it("rejects an expired or revoked session and an audit update", async () => {
    const graph = await seedVisitGraph("session", 1);
    const raw = `phase15-${randomUUID()}`;
    const expired = await db.session.create({
      data: {
        userId: graph.patients[0]!.userId,
        tokenHash: hashSessionToken(`${raw}-expired`),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect(await readSessionUser(db, `${raw}-expired`, new Date())).toBeNull();
    const live = await db.session.create({
      data: {
        userId: graph.patients[0]!.userId,
        tokenHash: hashSessionToken(raw),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    expect((await readSessionUser(db, raw, new Date()))?.id).toBe(graph.patients[0]!.userId);
    await db.session.update({ where: { id: live.id }, data: { revokedAt: new Date() } });
    expect(await readSessionUser(db, raw, new Date())).toBeNull();
    expect(expired.id).toBeTruthy();

    const audit = await db.auditLog.create({
      data: { actorUserId: graph.patients[0]!.userId, action: "phase15.audit", entityType: "User", entityId: graph.patients[0]!.userId },
    });
    await expect(db.auditLog.update({ where: { id: audit.id }, data: { action: "tampered" } })).rejects.toThrow(/cannot be updated or deleted/);
    await expect(db.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow(/cannot be updated or deleted/);
    expect((await db.auditLog.findUnique({ where: { id: audit.id } }))?.action).toBe("phase15.audit");

    const access = await db.recordAccessLog.create({
      data: {
        actorUserId: graph.patients[0]!.userId,
        patientProfileId: graph.patients[0]!.profileId,
        entityType: "ClinicalNote",
        entityId: randomUUID(),
        action: "READ",
        outcome: "DENIED",
        reason: "phase15",
      },
    });
    await expect(db.recordAccessLog.delete({ where: { id: access.id } })).rejects.toThrow(/cannot be updated or deleted/);
  });
});
