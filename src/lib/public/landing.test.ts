import { describe, expect, it } from "vitest";
import { formatQualification, isLeadSpecialty, normalizePublicContact, publicLanguages, publicSessionFee, publishedServiceFee, readPublicContact, uniqueConsultationModes } from "./landing";

describe("public landing data", () => {
  it("publishes only the configured contact fields", () => {
    const contact = readPublicContact([
      { key: "PUBLIC_CONTACT_EMAIL", valueJson: " hello@clinic.test " },
      { key: "PUBLIC_CONTACT_PHONE", valueJson: "+232 76 000 000" },
      { key: "PUBLIC_CONTACT_ADDRESS", valueJson: "Freetown, Sierra Leone" },
      { key: "EMAIL_FROM", valueJson: "hidden@internal.test" },
      { key: "PUBLIC_CONTACT_EMAIL_NOTE", valueJson: { email: "nested@clinic.test" } },
    ]);

    expect(contact).toEqual({
      email: "hello@clinic.test",
      phone: "+232 76 000 000",
      address: "Freetown, Sierra Leone",
    });
  });

  it("accepts a public contact an administrator can save", () => {
    expect(normalizePublicContact({ email: " hello@clinic.test ", phone: "", address: "Freetown" })).toEqual({
      ok: true,
      email: "hello@clinic.test",
      phone: null,
      address: "Freetown",
    });
    expect(normalizePublicContact({ email: "not-an-email", phone: "", address: "" }).ok).toBe(false);
    expect(normalizePublicContact({ email: "", phone: "call us", address: "" }).ok).toBe(false);
  });

  it("drops contact values that are not ready to display", () => {
    const contact = readPublicContact([
      { key: "PUBLIC_CONTACT_EMAIL", valueJson: "not-an-email" },
      { key: "PUBLIC_CONTACT_PHONE", valueJson: "call us" },
      { key: "PUBLIC_CONTACT_ADDRESS", valueJson: "  " },
    ]);

    expect(contact).toEqual({ email: null, phone: null, address: null });
  });

  it("recognises mental health without treating every specialty as the lead specialty", () => {
    expect(isLeadSpecialty({ name: "Mental Health", slug: "mental-health" })).toBe(true);
    expect(isLeadSpecialty({ name: "Psychiatry", slug: "psychiatry" })).toBe(true);
    expect(isLeadSpecialty({ name: "General practice", slug: "general-practice" })).toBe(false);
    expect(uniqueConsultationModes(["ONLINE", "ONLINE", "IN_PERSON"])).toEqual(["IN_PERSON", "ONLINE"]);
  });

  it("formats a published qualification and omits a missing title", () => {
    expect(
      formatQualification(
        { title: "MBChB", institution: "University of Sierra Leone", year: 2014 },
        2026,
      ),
    ).toBe("MBChB, University of Sierra Leone (2014)");
    expect(formatQualification({ title: " ", institution: "Hidden", year: 2014 }, 2026)).toBeNull();
  });

  it("publishes languages and one session price without mixing currencies", () => {
    expect(publicLanguages([" English ", "english", "Krio", ""])).toEqual(["English", "Krio"]);
    expect(publicSessionFee([{ price: { toString: () => "450.00" }, currency: "sll" }])).toBe("SLL 450 / session");
    expect(
      publicSessionFee([
        { price: { toString: () => "500" }, currency: "SLL" },
        { price: { toString: () => "400" }, currency: "SLL" },
      ]),
    ).toBe("From SLL 400 / session");
    expect(
      publicSessionFee([
        { price: { toString: () => "10" }, currency: "USD" },
        { price: { toString: () => "400" }, currency: "SLL" },
      ]),
    ).toBeNull();
    expect(publicSessionFee([{ price: { toString: () => "0" }, currency: "SLL" }])).toBeNull();
    expect(
      publishedServiceFee({
        offerings: [{ price: { toString: () => "0" }, priceAmountMinor: 10000, currency: "SLL" }],
        defaultFee: { toString: () => "25.00" },
        currency: "SLL",
      }),
    ).toBe("SLL 25 / session");
    expect(
      publishedServiceFee({
        offerings: [{ price: { toString: () => "0" }, currency: "SLL" }],
        defaultFee: { toString: () => "100.00" },
        currency: "SLL",
      }),
    ).toBe("SLL 100 / session");
  });
});
