import { describe, expect, it } from "vitest";
import { forgetRemembered, rememberFor } from "./remember";

describe("rememberFor", () => {
  it("reuses one load for overlapping callers and later hits", async () => {
    forgetRemembered("sample:");
    let calls = 0;
    const load = () => {
      calls += 1;
      return Promise.resolve("kept");
    };
    const [first, second] = await Promise.all([
      rememberFor("sample:one", 5_000, load),
      rememberFor("sample:one", 5_000, load),
    ]);
    expect(first).toBe("kept");
    expect(second).toBe("kept");
    expect(await rememberFor("sample:one", 5_000, load)).toBe("kept");
    expect(calls).toBe(1);
    forgetRemembered("sample:");
  });

  it("does not reuse a value the caller rejects", async () => {
    forgetRemembered("sample:");
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    expect(await rememberFor("sample:drop", 5_000, load, () => false)).toBe(1);
    expect(await rememberFor("sample:drop", 5_000, load, () => false)).toBe(2);
    forgetRemembered("sample:");
  });
});
