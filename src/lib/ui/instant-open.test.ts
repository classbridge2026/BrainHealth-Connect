import { describe, expect, it } from "vitest";
import { isPortalPath, pageHref } from "@/lib/ui/instant-open";

const here = { origin: "https://care.test", pathname: "/patient", search: "" };

describe("page to open", () => {
  it("keeps a same-origin page and its query", () => {
    expect(pageHref("https://care.test/patient/appointments?when=today", here)).toBe("/patient/appointments?when=today");
  });

  it("skips the page already on screen, other sites, and non-pages", () => {
    expect(pageHref("https://care.test/patient", here)).toBeNull();
    expect(pageHref("https://care.test/patient#account", here)).toBeNull();
    expect(pageHref("https://example.com/patient", here)).toBeNull();
    expect(pageHref("mailto:care@care.test", here)).toBeNull();
    expect(pageHref("https://care.test/api/care-chat", here)).toBeNull();
    expect(pageHref("https://care.test/_next/static/chunk.js", here)).toBeNull();
  });

  it("recognises the signed-in portals", () => {
    expect(isPortalPath("/patient/messages")).toBe(true);
    expect(isPortalPath("/doctor")).toBe(true);
    expect(isPortalPath("/admin/users")).toBe(true);
    expect(isPortalPath("/")).toBe(false);
  });
});
