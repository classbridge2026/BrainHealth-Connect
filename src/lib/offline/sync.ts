import { enqueueChange, flushChanges, pendingChanges, type SyncNotice } from "./outbox";
import { captureBody, captureHeaders, shouldQueue, type StoredChange } from "./queue";

export type OfflineListener = (notice: SyncNotice & { offline: boolean }) => void;

function pathnameOf(input: RequestInfo | URL, locationOrigin: string) {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  try {
    return new URL(raw, locationOrigin);
  } catch {
    return null;
  }
}

function networkFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "TypeError" || /failed to fetch|network|offline|load failed/i.test(error.message);
}

/**
 * Keeps a change on this device when it cannot reach the server, then sends the
 * queue when the internet returns. The original request stays open until then,
 * so a message or a saved form completes instead of looking lost.
 */
export function installOfflineSync(onChange: OfflineListener, win: Window = window) {
  const native = win.fetch.bind(win);
  const waiting = new Map<number, (response: Response) => void>();
  let stopped = false;
  let retryTimer = 0;

  function publish(notice: SyncNotice) {
    if (stopped) return;
    onChange({ ...notice, offline: win.navigator.onLine === false });
  }

  async function flush() {
    if (win.navigator.onLine === false) {
      publish({ pending: (await pendingChanges()).length, failed: 0, synced: false });
      return;
    }
    await flushChanges(native, {
      onNotice: publish,
      onResult(id, response) {
        const resolve = waiting.get(id);
        if (!resolve) return;
        waiting.delete(id);
        resolve(response);
      },
    });
    if (stopped) return;
    const left = await pendingChanges();
    if (left.length > 0) retryTimer = win.setTimeout(() => { void flush(); }, 8000);
  }

  async function patched(input: RequestInfo | URL, init?: RequestInit) {
    const url = pathnameOf(input, win.location.origin);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!url || url.origin !== win.location.origin || headers.has("x-carecircle-replay") || !shouldQueue(method, url.pathname)) {
      return native(input, init);
    }
    let raw = init?.body ?? null;
    if (raw == null && input instanceof Request && input.body) {
      const type = input.headers.get("content-type") ?? "";
      raw = type.includes("multipart/form-data") ? await input.clone().formData() : await input.clone().text();
    }
    const body = await captureBody(raw);
    const change: StoredChange = {
      url: `${url.pathname}${url.search}`,
      method: method.toUpperCase(),
      headers: captureHeaders(headers, body.kind === "form"),
      body,
    };
    const send = () => native(input, init);
    if (win.navigator.onLine !== false) {
      try {
        return await send();
      } catch (error) {
        if (!networkFailure(error)) throw error;
      }
    }
    const id = await enqueueChange(change);
    const pending = new Promise<Response>((resolve) => {
      waiting.set(id, resolve);
    });
    publish({ pending: (await pendingChanges()).length, failed: 0, synced: false });
    void flush();
    return pending;
  }

  function markOffline() {
    void pendingChanges().then((queued) => publish({ pending: queued.length, failed: 0, synced: false }));
  }

  win.fetch = patched as typeof fetch;
  win.addEventListener("offline", markOffline);
  win.addEventListener("online", flush);
  void pendingChanges().then((queued) => {
    publish({ pending: queued.length, failed: 0, synced: false });
    if (queued.length > 0) void flush();
  });

  return function uninstall() {
    stopped = true;
    win.clearTimeout(retryTimer);
    if (win.fetch === (patched as typeof fetch)) win.fetch = native;
    win.removeEventListener("offline", markOffline);
    win.removeEventListener("online", flush);
  };
}
