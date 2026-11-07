import { describe, expect, it } from "vitest";
import { saveAvailabilityRule } from "./schedule";

const OTHER = "33333333-3333-4333-8333-333333333333";

function database() {
  const created: string[] = [];
  return {
    created,
    db: {
      doctorProfile: {
        findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
          if (where.userId === "user-1") return { id: "own-doctor" };
          if (where.id) return { id: where.id };
          return null;
        },
      },
      doctorAvailabilityRule: {
        findMany: async () => [],
        create: async ({ data }: { data: { doctorProfileId: string } }) => {
          created.push(data.doctorProfileId);
          return { id: "rule-1" };
        },
      },
      auditLog: { create: async () => ({}) },
    },
  };
}

const hours = { dayOfWeek: 1, start: "09:00", end: "12:00", mode: "ONLINE" as const };

describe("availability ownership", () => {
  it("saves a doctor-administrator's own hours when no other doctor is selected", async () => {
    const store = database();
    const result = await saveAvailabilityRule(
      { actor: { userId: "user-1", roleCodes: ["DOCTOR", "ADMIN"] }, ...hours },
      { db: store.db as never },
    );
    expect(result.ok).toBe(true);
    expect(store.created).toEqual(["own-doctor"]);
  });

  it("stores a typed clinic for in-person hours", async () => {
    const store = database();
    const locations: Array<{ name: string }> = [];
    const db = {
      ...store.db,
      location: {
        findFirst: async () => null,
        findUnique: async () => ({ isActive: true }),
        create: async ({ data }: { data: { name: string } }) => {
          locations.push(data);
          return { id: "22222222-2222-4222-8222-222222222222" };
        },
      },
    };
    const result = await saveAvailabilityRule(
      {
        actor: { userId: "user-1", roleCodes: ["DOCTOR"] },
        dayOfWeek: 2,
        start: "10:00",
        end: "13:00",
        mode: "IN_PERSON",
        clinic: "34 Wilkinson Road, Freetown",
      },
      { db: db as never },
    );
    expect(result.ok).toBe(true);
    expect(locations[0]?.name).toBe("34 Wilkinson Road");
    expect(store.created).toEqual(["own-doctor"]);
  });

  it("stores shared hours when patients may choose either visit type", async () => {
    const store = database();
    const saved: Array<{ mode: string | null; locationId: string | null; offeringId: string | null }> = [];
    const db = {
      ...store.db,
      doctorAvailabilityRule: {
        findMany: async () => [],
        create: async ({ data }: { data: { doctorProfileId: string; mode: string | null; locationId: string | null; offeringId: string | null } }) => {
          store.created.push(data.doctorProfileId);
          saved.push({ mode: data.mode, locationId: data.locationId, offeringId: data.offeringId });
          return { id: "rule-1" };
        },
      },
      location: {
        findFirst: async () => ({ id: "22222222-2222-4222-8222-222222222222", isActive: true }),
        findUnique: async () => ({ isActive: true }),
      },
    };
    const result = await saveAvailabilityRule(
      {
        actor: { userId: "user-1", roleCodes: ["DOCTOR"] },
        dayOfWeek: 3,
        start: "09:00",
        end: "12:00",
        mode: "BOTH",
        clinic: "34 Wilkinson Road, Freetown",
      },
      { db: db as never },
    );
    expect(result.ok).toBe(true);
    expect(saved).toEqual([{ mode: null, locationId: "22222222-2222-4222-8222-222222222222", offeringId: null }]);
  });

  it("reuses a clinic that is already saved under the same name and city", async () => {
    const store = database();
    let created = false;
    const db = {
      ...store.db,
      location: {
        findFirst: async ({ where }: { where: { name: { equals: string }; locality: { equals: string } } }) => {
          if (where.name.equals === "34 Wilkinson Road" && where.locality.equals === "Freetown") {
            return { id: "22222222-2222-4222-8222-222222222222", isActive: true };
          }
          return null;
        },
        findUnique: async () => ({ isActive: true }),
        create: async () => {
          created = true;
          return { id: "new" };
        },
      },
    };
    const result = await saveAvailabilityRule(
      {
        actor: { userId: "user-1", roleCodes: ["DOCTOR"] },
        dayOfWeek: 4,
        start: "09:00",
        end: "12:00",
        mode: "IN_PERSON",
        clinic: "34 Wilkinson Road, Freetown",
      },
      { db: db as never },
    );
    expect(result.ok).toBe(true);
    expect(created).toBe(false);
    expect(store.created).toEqual(["own-doctor"]);
  });

  it("tells the doctor when the matching clinic is turned off", async () => {
    const store = database();
    const db = {
      ...store.db,
      location: {
        findFirst: async () => ({ id: "22222222-2222-4222-8222-222222222222", isActive: false }),
      },
    };
    const result = await saveAvailabilityRule(
      {
        actor: { userId: "user-1", roleCodes: ["DOCTOR"] },
        dayOfWeek: 4,
        start: "09:00",
        end: "12:00",
        mode: "IN_PERSON",
        clinic: "34 Wilkinson Road, Freetown",
      },
      { db: db as never },
    );
    expect(result).toEqual({
      ok: false,
      message: "That clinic is already on file but is not active. Ask an administrator to turn it on.",
    });
    expect(store.created).toEqual([]);
  });

  it("rejects a doctor editing another doctor's schedule", async () => {
    const store = database();
    const result = await saveAvailabilityRule(
      { actor: { userId: "user-1", roleCodes: ["DOCTOR"] }, doctorProfileId: OTHER, ...hours },
      { db: store.db as never },
    );
    expect(result.ok).toBe(false);
    expect(store.created).toEqual([]);
  });
});
