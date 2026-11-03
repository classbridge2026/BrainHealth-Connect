/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisitPayment } from "./pay-form";

vi.mock("./pay-actions", () => ({
  refreshWalletPaymentAction: vi.fn(),
  reportOrangeTransferAction: vi.fn(),
  startWalletPaymentAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

afterEach(() => cleanup());

const checkout = {
  appointmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  fee: "100.00 SLL",
  doctor: "Dr Example",
  service: "Online consultation",
  when: "3 Nov 2026, 3:00 PM",
  paid: false,
  canPay: true,
  pendingApproval: false,
  walletApi: false,
  orange: true,
  afrimoney: true,
  phone: "",
  dialNumber: "076 604 922",
  code: "#144*2*1*076604922*100*PIN#",
  dialHref: "tel:%23144*2*1*076604922*100*",
  afriNumber: "077 604 922",
  afriCode: "*161*1*1*077604922*100*PIN#",
  afriHref: "tel:*%23161*1*1*077604922*100*",
  waitingReference: null,
  waitingWallet: null,
};

describe("visit payment methods", () => {
  it("hides the other wallet after the patient chooses Afrimoney", async () => {
    const user = userEvent.setup();
    render(<VisitPayment {...checkout} />);
    expect(screen.getByRole("button", { name: /Orange Money/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Afrimoney/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Watch how to pay" }));
    expect(screen.getByRole("dialog", { name: "How to book and pay" })).toBeTruthy();
    expect(screen.getByLabelText("How to book and pay, in Krio").getAttribute("src")).toBe("/guides/brainhealth-connect-patient-booking-krio.mp4");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "How to book and pay" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Afrimoney/ }));

    expect(screen.queryByRole("button", { name: /Orange Money/ })).toBeNull();
    expect(screen.getByText("*161*1*1*077604922*100*PIN#")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open phone dialer" }).getAttribute("href")).toBe(checkout.afriHref);

    await user.click(screen.getByRole("button", { name: "Change payment method" }));
    expect(screen.getByRole("button", { name: /Orange Money/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Afrimoney/ })).toBeTruthy();
  });

  it("hides Afrimoney after the patient chooses Orange Money", async () => {
    const user = userEvent.setup();
    render(<VisitPayment {...checkout} />);
    await user.click(screen.getByRole("button", { name: /Orange Money/ }));
    expect(screen.queryByRole("button", { name: /Afrimoney/ })).toBeNull();
    expect(screen.getByText("#144*2*1*076604922*100*PIN#")).toBeTruthy();
  });
});
