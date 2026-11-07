export type FormEntry =
  | { name: string; text: string }
  | { name: string; fileName: string; file: Blob };

export type StoredBody =
  | { kind: "none" }
  | { kind: "text"; value: string }
  | { kind: "form"; entries: FormEntry[] };

export type StoredChange = {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body: StoredBody;
};

const SKIP = [
  /^\/(login|register|forgot-password|reset-password|verify)(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /\/consultation\//,
  /payment/i,
  /wallet/i,
  /checkout/i,
  /orange-money/i,
  /afrimoney/i,
];

/** Mutations that are safe to keep on the device and send later. Live calls, sign-in, and payments are not. */
export function shouldQueue(method: string, pathname: string) {
  const verb = method.toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  return !SKIP.some((pattern) => pattern.test(pathname));
}

/** A finished response can be dropped. A server or network failure should be tried again. */
export function syncDecision(status: number): "done" | "drop" | "retry" {
  if (status >= 200 && status < 300) return "done";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "drop";
}

function formBody(form: FormData): StoredBody {
  const entries: FormEntry[] = [];
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") entries.push({ name, text: value });
    else entries.push({ name, fileName: value.name || "file", file: value });
  }
  return { kind: "form", entries };
}

export function replayBody(body: StoredBody): BodyInit | undefined {
  if (body.kind === "none") return undefined;
  if (body.kind === "text") return body.value;
  const form = new FormData();
  for (const entry of body.entries) {
    if ("file" in entry) form.append(entry.name, entry.file, entry.fileName);
    else form.append(entry.name, entry.text);
  }
  return form;
}

export function captureHeaders(headers: Headers, form: boolean) {
  const kept: Array<[string, string]> = [];
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (form && name === "content-type") return;
    if (name === "cookie" || name === "host" || name === "content-length" || name === "connection") return;
    if (name === "content-type" || name === "accept" || name.startsWith("next-") || name === "rsc") kept.push([key, value]);
  });
  return kept;
}

export async function captureBody(body: BodyInit | null | undefined): Promise<StoredBody> {
  if (body == null) return { kind: "none" };
  if (typeof body === "string") return { kind: "text", value: body };
  if (body instanceof URLSearchParams) return { kind: "text", value: body.toString() };
  if (typeof FormData !== "undefined" && body instanceof FormData) return formBody(body);
  if (typeof Blob !== "undefined" && body instanceof Blob) return { kind: "text", value: await body.text() };
  if (body instanceof ArrayBuffer) return { kind: "text", value: new TextDecoder().decode(body) };
  if (ArrayBuffer.isView(body)) return { kind: "text", value: new TextDecoder().decode(body) };
  return { kind: "none" };
}
