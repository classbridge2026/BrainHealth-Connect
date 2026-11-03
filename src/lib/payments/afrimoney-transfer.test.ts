import { describe, expect, it } from "vitest";
import { afrimoneyDialHref, afrimoneyTransferCode } from "./afrimoney-transfer";

describe("Afrimoney phone transfer", () => {
  it("dials *161*1*1*number*amount and leaves the PIN on the phone", () => {
    expect(afrimoneyTransferCode("077604922", "50")).toBe("*161*1*1*077604922*50*PIN#");
    expect(afrimoneyTransferCode("077 604 922", "50")).toBe("*161*1*1*077604922*50*PIN#");
    expect(afrimoneyDialHref("077604922", "50")).toBe(`tel:${encodeURIComponent("*161*1*1*077604922*50*")}`);
    expect(afrimoneyDialHref("077604922", "50")).not.toContain("PIN");
  });
});
