/** @vitest-environment happy-dom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsultationSession } from "./session";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/dynamic", () => ({
  default: () => function LiveSessionStub() {
    return null;
  },
}));

const shared = {
  appointmentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  canJoin: true,
  configured: true,
  counterpart: "Dr. Kamara",
  when: "23 Oct 2026, 13:00 GMT",
  returnHref: "/patient/appointments/1",
  message: "Wait for your doctor to start the call.",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("consultation session", () => {
  it("connects a waiting patient without ringing", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/token")) return { ok: true, json: async () => ({ serverUrl: "wss://example.livekit.cloud", token: "token" }) };
      if (url.includes("/call")) return { ok: true, json: async () => ({ calling: true, callId: "call:1", doctorName: "Dr. Kamara", when: "23 Oct 2026, 13:00 GMT" }) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ConsultationSession {...shared} role="patient" />);
    expect(screen.getByRole("button", { name: "I've arrived" })).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/token"))).toBe(true);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept video" })).toBeNull();
  });

  it("shows a spinning logo while an accepted call is opening", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<ConsultationSession {...shared} accept="audio" role="patient" />);
    expect(await screen.findByRole("status", { name: "Loading" })).toBeTruthy();
    expect(screen.queryByText(/joining/i)).toBeNull();
    expect(screen.queryByText(/loading your care record/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Join consultation" })).toBeNull();
  });

  it("hides join when the server says the appointment is not eligible", () => {
    render(<ConsultationSession {...shared} canJoin={false} message="Your consultation is not open yet. Please return closer to your appointment time." role="patient" />);
    expect(screen.queryByRole("button", { name: "I've arrived" })).toBeNull();
    expect(screen.getByText(/not open yet/i)).toBeTruthy();
  });

  it("keeps join consultation for the doctor", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ waiting: false }) })));
    render(<ConsultationSession {...shared} counterpart="A Patient" role="doctor" />);
    expect(screen.getByRole("button", { name: "Join consultation" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells the doctor when the patient is already waiting", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/waiting")) return { ok: true, json: async () => ({ waiting: true, patientName: "Osman" }) };
      return { ok: true, json: async () => ({ calling: false }) };
    }));
    render(
      <ConsultationSession
        {...shared}
        counterpart="Osman"
        counterpartUserId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        counterpartImageVersion={null}
        role="doctor"
      />,
    );
    expect(await screen.findByText(/Osman is in the waiting room/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Admit patient" })).toBeTruthy();
  });

  it("tells the doctor when the patient declines so they can call again", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/calling")) return { ok: true, json: async () => ({ calling: false, notice: "declined" }) };
      return { ok: true, json: async () => ({ waiting: false }) };
    }));
    render(<ConsultationSession {...shared} counterpart="A Patient" role="doctor" />);
    expect(await screen.findByText(/declined the call/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Call again" })).toBeTruthy();
  });
});
