import { afterEach, describe, expect, it } from "vitest";
import { metadataBase, publicAppOrigin } from "./metadata-base";

const original = process.env.APP_BASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = original;
});

describe("metadataBase", () => {
  it("uses APP_BASE_URL when it is an http origin", () => {
    process.env.APP_BASE_URL = "https://care.example/app";
    expect(metadataBase()?.origin).toBe("https://care.example");
    expect(metadataBase()?.pathname).toBe("/app");
  });

  it("ignores a value that is not an http URL", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    process.env.APP_BASE_URL = "ftp://care.example";
    expect(metadataBase()?.href).toBe("http://localhost:3000/");
    process.env.APP_BASE_URL = "not a url";
    expect(metadataBase()?.href).toBe("http://localhost:3000/");
  });

  it("falls back to the local dev server when APP_BASE_URL is unset outside production", () => {
    delete process.env.APP_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(metadataBase()?.href).toBe("http://localhost:3000/");
  });

  it("uses the Vercel production host when APP_BASE_URL is unset", () => {
    delete process.env.APP_BASE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "brain-health-connect.vercel.app";
    expect(metadataBase()?.origin).toBe("https://brain-health-connect.vercel.app");
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  it("sends email links to the live site when the configured address is local", () => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(publicAppOrigin("http://localhost:3000")).toBe("https://brain-health-connect.vercel.app");
    expect(publicAppOrigin()).toBe("https://brain-health-connect.vercel.app");
  });

  it("keeps a public site address in email links", () => {
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(publicAppOrigin("https://care.example")).toBe("https://care.example");
  });

  it("prefers the current Vercel production host over an older vercel.app address", () => {
    process.env.APP_BASE_URL = "https://care-circle-mind-together.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "brain-health-connect.vercel.app";
    expect(metadataBase()?.origin).toBe("https://brain-health-connect.vercel.app");
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });
});
