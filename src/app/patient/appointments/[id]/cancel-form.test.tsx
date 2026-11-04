/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelAppointmentForm } from "./cancel-form";

vi.mock("../actions", () => ({
  cancelPatientAppointmentAction: vi.fn(),
}));

afterEach(() => cleanup());

describe("cancel appointment confirmation", () => {
  it("asks before the cancellation is sent", async () => {
    const user = userEvent.setup();
    render(<CancelAppointmentForm appointmentId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" />);
    await user.type(screen.getByRole("textbox"), "Need to move this visit to another day.");
    await user.click(screen.getByRole("button", { name: "Cancel this appointment" }));

    expect(await screen.findByRole("heading", { name: "Cancel this appointment?" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("heading", { name: "Cancel this appointment?" })).toBeNull();
  });
});
