/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoctorWorkspace } from "./doctor-workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const props = {
  appointmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  patientName: "Mariama S. Koroma",
  patientUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  patientImageVersion: null,
  patientLine: "Female · 34 years",
  reference: "AAAAAAA1",
  service: "Mental Health Consultation",
  specialty: "Psychiatry",
  when: "28 Apr 2026, 10:00 GMT",
  until: "28 Apr 2026, 10:30 GMT",
  modeLabel: "Online consultation",
  statusLabel: "In progress",
  paymentLabel: "Paid",
  fee: "GHS 500",
  encounterLabel: "In progress",
  canOpen: false,
  writeBlocked: null,
  canComplete: true,
  privateNote: null,
  summaryNote: null,
  offerings: [],
  locations: [],
  followUps: [],
};

afterEach(cleanup);

describe("doctor consultation workspace", () => {
  it("keeps notes, follow-up, summary, and completion as separate actions", () => {
    render(<DoctorWorkspace {...props} />);
    expect(screen.getByRole("tab", { name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save clinical notes" })).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Follow-up" }));
    expect(screen.getByRole("button", { name: "Save recommendation" })).toBeTruthy();
    expect(screen.getByText(/cannot be booked/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }));
    expect(screen.getByRole("button", { name: "Prepare patient summary" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End consultation" })).toBeTruthy();
    expect(screen.getByText(/marks it complete/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByRole("button", { name: "Store in private bucket" })).toBeTruthy();
  });
});
