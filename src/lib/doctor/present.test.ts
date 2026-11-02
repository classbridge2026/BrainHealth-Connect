import { describe, expect, it } from "vitest";
import {
  classifyFollowUp,
  clinicalAccess,
  composeConsultationNote,
  splitConsultationNote,
  monthCells,
  parseAnchor,
  patientReference,
  shiftAnchor,
  startOfWeek,
  visibleRange,
} from "./present";

describe("doctor portal presentation", () => {
  it("keeps clinical pages closed until the doctor is approved", () => {
    expect(clinicalAccess(null)).toBe("missing");
    expect(clinicalAccess("DRAFT")).toBe("incomplete");
    expect(clinicalAccess("SUBMITTED")).toBe("pending");
    expect(clinicalAccess("UNDER_REVIEW")).toBe("pending");
    expect(clinicalAccess("REJECTED")).toBe("rejected");
    expect(clinicalAccess("SUSPENDED")).toBe("suspended");
    expect(clinicalAccess("APPROVED")).toBe("ready");
  });

  it("builds a Monday-start week and month grid in Freetown dates", () => {
    const sunday = parseAnchor("2026-10-18", new Date("2026-10-18T12:00:00.000Z"));
    expect(startOfWeek(sunday).toISOString()).toBe("2026-10-12T00:00:00.000Z");
    const week = visibleRange("week", sunday);
    expect(week.start.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(monthCells(parseAnchor("2026-10-18", new Date())).filter((cell) => cell.inMonth)).toHaveLength(31);
    expect(shiftAnchor("day", sunday, 1)).toBe("2026-10-19");
  });

  it("classifies follow-ups from the appointment day and status", () => {
    const dayStart = new Date("2026-10-18T00:00:00.000Z");
    const dayEnd = new Date("2026-10-19T00:00:00.000Z");
    expect(classifyFollowUp({ status: "CONFIRMED", startsAt: new Date("2026-10-18T15:00:00.000Z"), dayStart, dayEnd })).toBe("today");
    expect(classifyFollowUp({ status: "CONFIRMED", startsAt: new Date("2026-10-17T15:00:00.000Z"), dayStart, dayEnd })).toBe("overdue");
    expect(classifyFollowUp({ status: "CONFIRMED", startsAt: new Date("2026-10-20T15:00:00.000Z"), dayStart, dayEnd })).toBe("upcoming");
    expect(classifyFollowUp({ status: "COMPLETED", startsAt: new Date("2026-10-01T15:00:00.000Z"), dayStart, dayEnd })).toBe("completed");
    expect(classifyFollowUp({ status: "CANCELLED_BY_DOCTOR", startsAt: new Date("2026-10-20T15:00:00.000Z"), dayStart, dayEnd })).toBe("cancelled");
  });

  it("composes a specialty-neutral note and rejects an empty one", () => {
    const empty = composeConsultationNote({ complaint: " ", history: "", findings: "", assessment: "", plan: "", followUp: "" });
    expect(empty.ok).toBe(false);
    const saved = composeConsultationNote({
      complaint: "Headache for three days",
      history: "",
      findings: "Alert",
      assessment: "Needs review",
      plan: "Return if symptoms worsen",
      followUp: "",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.body).toContain("Presenting complaint");
      expect(saved.body).not.toContain("History");
      expect(splitConsultationNote(saved.body).complaint).toBe("Headache for three days");
      expect(splitConsultationNote(saved.body).findings).toBe("Alert");
    }
  });

  it("shows a stable short reference without inventing a medical record number", () => {
    expect(patientReference("123e4567-e89b-42d3-a456-426614174000")).toBe("123E4567");
  });
});
