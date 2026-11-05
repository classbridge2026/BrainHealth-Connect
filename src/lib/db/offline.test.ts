import { describe, expect, it } from "vitest";
import { RECORDS_OFFLINE_MESSAGE, RecordsOfflineError, isRecordsOffline, retryRecordsRead } from "./offline";
import { safeReturnPath } from "./return-path";

describe("records offline", () => {
  it("recognises a database the app cannot reach without repeating the server address", () => {
    const host = "ep-still-fog-b5ooi6w0-pooler.c-7.us-east-2.aws.neon.tech:5432";
    const error = Object.assign(new Error(`Can't reach database server at \`${host}\``), { code: "P1001" });
    expect(isRecordsOffline(error)).toBe(true);
    expect(isRecordsOffline(new RecordsOfflineError())).toBe(true);
    expect(isRecordsOffline(new Error("Response from the Engine was empty"))).toBe(true);
    expect(isRecordsOffline(Object.assign(new Error("connect ETIMEDOUT"), { code: "P1001" }))).toBe(true);
    expect(RECORDS_OFFLINE_MESSAGE).not.toContain(host);
    expect(RECORDS_OFFLINE_MESSAGE).not.toContain("Prisma");
  });

  it("leaves other database errors alone", () => {
    expect(isRecordsOffline(Object.assign(new Error("Unique constraint"), { code: "P2002" }))).toBe(false);
    expect(isRecordsOffline(null)).toBe(false);
  });

  it("reads again after a dropped connection and keeps the second result", async () => {
    let calls = 0;
    const value = await retryRecordsRead(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("Response from the Engine was empty"), { code: "P1001" });
      return "ready";
    }, 0);
    expect(value).toBe("ready");
    expect(calls).toBe(2);
  });
});

describe("offline return path", () => {
  it("keeps the page the person was on and refuses the offline page or another site", () => {
    expect(safeReturnPath("/doctor/appointments/49a0ab55-4fc2-40c8-aceb-2a830dc8ad5a")).toBe("/doctor/appointments/49a0ab55-4fc2-40c8-aceb-2a830dc8ad5a");
    expect(safeReturnPath("/patient/appointments?view=past")).toBe("/patient/appointments?view=past");
    expect(safeReturnPath("/offline")).toBeNull();
    expect(safeReturnPath("/offline?from=/doctor")).toBeNull();
    expect(safeReturnPath("https://example.com/doctor")).toBeNull();
    expect(safeReturnPath("//example.com")).toBeNull();
  });
});
