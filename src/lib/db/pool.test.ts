import { describe, expect, it } from "vitest";
import { poolTag, withPoolSettings } from "./pool";

const pooled = "postgresql://USER:PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";

describe("database pool settings", () => {
  it("gives the development server enough connections for overlapping admin pages", () => {
    const url = withPoolSettings(pooled, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("15");
    expect(params.get("pool_timeout")).toBe("20");
    expect(params.get("connect_timeout")).toBe("30");
    expect(params.get("max_idle_connection_lifetime")).toBe("20");
    expect(params.get("pgbouncer")).toBe("true");
    expect(poolTag(url)).toBe("15/20/30/20");
  });

  it("keeps an explicit connection limit from the environment", () => {
    const url = withPoolSettings(`${pooled}&connection_limit=8`, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("8");
  });

  it("uses a smaller production pool on the Neon pooler", () => {
    const url = withPoolSettings(pooled, "production");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("5");
    expect(params.get("pool_timeout")).toBe("10");
    expect(params.get("connect_timeout")).toBe("10");
  });
});
