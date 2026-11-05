import { describe, expect, it } from "vitest";
import { poolTag, withPoolSettings } from "./pool";

const pooled = "postgresql://USER:PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";

describe("database pool settings", () => {
  it("keeps a small development pool so Neon is not opened once per request", () => {
    const url = withPoolSettings(pooled, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("5");
    expect(params.get("pool_timeout")).toBe("20");
    expect(params.get("connect_timeout")).toBe("30");
    expect(params.get("max_idle_connection_lifetime")).toBe("90");
    expect(params.get("pgbouncer")).toBe("true");
    expect(params.get("channel_binding")).toBe("disable");
    expect(poolTag(url)).toBe("5/20/30/90/disable");
  });

  it("keeps an explicit connection limit from the environment", () => {
    const url = withPoolSettings(`${pooled}&connection_limit=8`, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("8");
  });

  it("turns off channel binding on the Neon pooler", () => {
    const url = withPoolSettings(`${pooled}&channel_binding=require&connect_timeout=15`, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("channel_binding")).toBe("disable");
    expect(params.get("connect_timeout")).toBe("15");
    expect(params.get("pgbouncer")).toBe("true");
  });

  it("leaves channel binding on a direct Neon connection", () => {
    const direct = "postgresql://USER:PASSWORD@ep-example.region.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const url = withPoolSettings(direct, "development");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("channel_binding")).toBe("require");
    expect(params.get("pgbouncer")).toBeNull();
  });

  it("uses a smaller production pool on the Neon pooler", () => {
    const url = withPoolSettings(pooled, "production");
    const params = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(params.get("connection_limit")).toBe("5");
    expect(params.get("pool_timeout")).toBe("10");
    expect(params.get("connect_timeout")).toBe("10");
  });
});
