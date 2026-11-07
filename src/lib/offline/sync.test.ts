import { afterEach, describe, expect, it } from "vitest";
import { resetOutboxForTests } from "./outbox";
import { shouldQueue, syncDecision } from "./queue";
import { installOfflineSync } from "./sync";

afterEach(() => {
  resetOutboxForTests();
});

describe("offline queue rules", () => {
  it("keeps ordinary saves and skips live calls, sign-in, and payments", () => {
    expect(shouldQueue("POST", "/api/care-chat")).toBe(true);
    expect(shouldQueue("POST", "/patient/appointments")).toBe(true);
    expect(shouldQueue("GET", "/patient")).toBe(false);
    expect(shouldQueue("POST", "/login")).toBe(false);
    expect(shouldQueue("POST", "/api/appointments/1/consultation/leave")).toBe(false);
    expect(shouldQueue("POST", "/api/payments/start")).toBe(false);
  });

  it("retries server failures and drops a rejected change", () => {
    expect(syncDecision(200)).toBe("done");
    expect(syncDecision(503)).toBe("retry");
    expect(syncDecision(401)).toBe("drop");
  });
});

describe("offline sync", () => {
  it("holds a change made offline and sends it when the internet returns", async () => {
    let online = false;
    const sent: Array<{ url: string; body: string | undefined }> = [];
    const listeners = new Map<string, () => void>();
    const notices: Array<{ pending: number; offline: boolean }> = [];
    const win = {
      location: { origin: "https://care.test" },
      navigator: { get onLine() { return online; } },
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        sent.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ line: { id: "m1" } }), { status: 200, headers: { "content-type": "application/json" } });
      },
      addEventListener(type: string, listener: () => void) {
        listeners.set(type, listener);
      },
      removeEventListener() {},
      setTimeout,
      clearTimeout,
    } as unknown as Window;

    const uninstall = installOfflineSync((notice) => notices.push(notice), win);
    const pending = win.fetch("/api/care-chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hello" }),
    });
    await Promise.resolve();
    expect(sent).toHaveLength(0);

    online = true;
    listeners.get("online")?.();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ line: { id: "m1" } });
    expect(sent).toEqual([{ url: "/api/care-chat", body: JSON.stringify({ body: "hello" }) }]);
    expect(notices.some((notice) => notice.pending > 0)).toBe(true);
    uninstall();
  });

  it("does not keep a payment to send later", async () => {
    const win = {
      location: { origin: "https://care.test" },
      navigator: { onLine: false },
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
      clearTimeout,
    } as unknown as Window;
    const uninstall = installOfflineSync(() => {}, win);
    await expect(win.fetch("/api/payments/start", { method: "POST", body: "{}" })).rejects.toThrow(/fetch/i);
    uninstall();
  });
});
