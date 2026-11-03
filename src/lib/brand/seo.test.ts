import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_NAME } from "./system-name";
import { homeTitle, publicDescription, publicSitemap, PUBLIC_INDEX_PATHS } from "./seo";

describe("public search listing", () => {
  it("keeps the homepage title and description inside the length search results show", () => {
    for (const name of [DEFAULT_SYSTEM_NAME, "BrainHealth Connect"]) {
      expect(homeTitle(name).length).toBeLessThanOrEqual(60);
      expect(publicDescription(name).length).toBeLessThanOrEqual(160);
      expect(publicDescription(name)).toContain(name);
      expect(publicDescription(name)).toContain("Sierra Leone");
    }
  });

  it("lists only public pages and keeps portals out of the sitemap", () => {
    const entries = publicSitemap(new URL("https://brain-health-connect.vercel.app"));
    const urls = entries.map((entry) => entry.url);
    expect(urls).toEqual(PUBLIC_INDEX_PATHS.map((path) => new URL(path, "https://brain-health-connect.vercel.app").href));
    expect(urls.join(" ")).not.toContain("/patient");
    expect(urls.join(" ")).not.toContain("/doctor");
    expect(urls.join(" ")).not.toContain("/admin");
    expect(entries[0]?.priority).toBe(1);
  });
});
