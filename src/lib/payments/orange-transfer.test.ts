import { describe, expect, it } from "vitest";
import { formatOrangeDialNumber, orangeDialNumber, orangeTransferCode, parseOrangeTransactionId, ussdAmount } from "./orange-transfer";

describe("Orange Money phone transfer", () => {
  it("builds the dial code from the clinic number and the visit amount", () => {
    expect(orangeDialNumber("+232 76 604 922")).toBe("076604922");
    expect(formatOrangeDialNumber("076604922")).toBe("076 604 922");
    expect(ussdAmount(5000)).toBe("50");
    expect(ussdAmount(1550)).toBe("15.50");
    expect(orangeTransferCode("076604922", "50")).toBe("#144*2*1*076604922*50*PIN#");
  });

  it("accepts an Orange Money transaction ID and refuses a PIN or a short code", () => {
    expect(parseOrangeTransactionId(" pp250502.1502.b91020 ")).toBe("PP250502.1502.B91020");
    expect(parseOrangeTransactionId("CI161214.1217.A50760")).toBe("CI161214.1217.A50760");
    expect(parseOrangeTransactionId("MP251204.0801.A93191")).toBe("MP251204.0801.A93191");
    expect(parseOrangeTransactionId("PP12.345678")).toBeNull();
    expect(parseOrangeTransactionId("1234")).toBeNull();
    expect(parseOrangeTransactionId("WPS12345")).toBeNull();
  });
});
