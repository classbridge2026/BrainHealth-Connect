import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export type StorageFailure = "not_configured" | "provider_failed" | "not_found";

export type StoragePutResult = { ok: true } | { ok: false; reason: Exclude<StorageFailure, "not_found"> };

export type StorageReadResult =
  | { ok: true; body: Uint8Array }
  | { ok: false; reason: StorageFailure };

export type PrivateObjectStorage = {
  readonly configured: boolean;
  put(input: { key: string; body: Uint8Array; mimeType: string }): Promise<StoragePutResult>;
  read(key: string): Promise<StorageReadResult>;
  remove(key: string): Promise<StoragePutResult>;
};

export const STORAGE_CONFIGURATION_HINT =
  "Set STORAGE_PROVIDER to filesystem and STORAGE_LOCAL_ROOT to a private directory outside the public web folder, or set STORAGE_PROVIDER to s3 with STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY_ID, and STORAGE_SECRET_ACCESS_KEY. Optional S3 settings are STORAGE_ENDPOINT and STORAGE_FORCE_PATH_STYLE.";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function storageRootProblem(root: string | undefined, cwd = process.cwd()): string | null {
  if (!root?.trim()) {
    return "STORAGE_LOCAL_ROOT is not set.";
  }
  const resolved = path.resolve(root);
  const publicDir = path.resolve(cwd, "public");
  if (resolved === publicDir || resolved.startsWith(publicDir + path.sep)) {
    return "STORAGE_LOCAL_ROOT must not be inside the public web directory.";
  }
  return null;
}

export function resolvePrivateKey(root: string, key: string): string | null {
  if (!key || key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    return null;
  }
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, key);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return full;
}

function unconfiguredStorage(): PrivateObjectStorage {
  return {
    configured: false,
    async put() {
      return { ok: false, reason: "not_configured" };
    },
    async read() {
      return { ok: false, reason: "not_configured" };
    },
    async remove() {
      return { ok: false, reason: "not_configured" };
    },
  };
}

function filesystemStorage(root: string): PrivateObjectStorage {
  return {
    configured: true,
    async put({ key, body }) {
      const full = resolvePrivateKey(root, key);
      if (!full) {
        return { ok: false, reason: "provider_failed" };
      }
      try {
        const directory = path.dirname(full);
        await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
        await writeFile(/* turbopackIgnore: true */ full, body, { mode: 0o600 });
        return { ok: true };
      } catch {
        return { ok: false, reason: "provider_failed" };
      }
    },
    async read(key) {
      const full = resolvePrivateKey(root, key);
      if (!full) {
        return { ok: false, reason: "not_found" };
      }
      try {
        const file = await readFile(/* turbopackIgnore: true */ full);
        const body = new Uint8Array(file.byteLength);
        body.set(file);
        return { ok: true, body };
      } catch {
        return { ok: false, reason: "not_found" };
      }
    },
    async remove(key) {
      const full = resolvePrivateKey(root, key);
      if (!full) {
        return { ok: false, reason: "provider_failed" };
      }
      try {
        await rm(/* turbopackIgnore: true */ full, { force: true });
        return { ok: true };
      } catch {
        return { ok: false, reason: "provider_failed" };
      }
    },
  };
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function sha256Hex(value: Uint8Array | string): string {
  const hash = createHash("sha256");
  hash.update(value);
  return hash.digest("hex");
}

function encodePath(key: string): string {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle: boolean;
};

function s3Target(config: S3Config, key: string): { url: string; canonicalUri: string; host: string } {
  const encodedKey = encodePath(key);
  if (config.endpoint) {
    const endpoint = config.endpoint.replace(/\/$/, "");
    const url = new URL(endpoint);
    if (config.forcePathStyle) {
      return {
        url: `${endpoint}/${config.bucket}/${encodedKey}`,
        canonicalUri: `/${config.bucket}/${encodedKey}`,
        host: url.host,
      };
    }
    return {
      url: `${url.protocol}//${config.bucket}.${url.host}/${encodedKey}`,
      canonicalUri: `/${encodedKey}`,
      host: `${config.bucket}.${url.host}`,
    };
  }
  return {
    url: `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`,
    canonicalUri: `/${encodedKey}`,
    host: `${config.bucket}.s3.${config.region}.amazonaws.com`,
  };
}

async function s3Request(
  config: S3Config,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body?: Uint8Array,
  mimeType?: string,
): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = method === "PUT" ? "UNSIGNED-PAYLOAD" : EMPTY_SHA256;
  const target = s3Target(config, key);
  const contentType = (mimeType ?? "application/octet-stream").split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  const canonicalHeaders =
    method === "PUT"
      ? `content-type:${contentType}\nhost:${target.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
      : `host:${target.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = method === "PUT" ? "content-type;host;x-amz-content-sha256;x-amz-date" : "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    method,
    target.canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const headers: Record<string, string> = {
    Authorization: authorization,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    host: target.host,
  };
  if (method === "PUT") {
    headers["content-type"] = contentType;
  }
  return fetch(target.url, {
    method,
    headers,
    body: body ? Buffer.from(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
}

function s3Storage(config: S3Config): PrivateObjectStorage {
  return {
    configured: true,
    async put({ key, body, mimeType }) {
      try {
        const response = await s3Request(config, "PUT", key, body, mimeType);
        if (response.ok) return { ok: true };
        const detail = await response.text().catch(() => "");
        console.error("private_storage_put_failed", response.status, detail.slice(0, 400));
        return { ok: false, reason: "provider_failed" };
      } catch (error) {
        console.error("private_storage_put_failed", error instanceof Error ? error.message : "unknown");
        return { ok: false, reason: "provider_failed" };
      }
    },
    async read(key) {
      try {
        const response = await s3Request(config, "GET", key);
        if (response.status === 404) {
          return { ok: false, reason: "not_found" };
        }
        if (!response.ok) {
          return { ok: false, reason: "provider_failed" };
        }
        return { ok: true, body: new Uint8Array(await response.arrayBuffer()) };
      } catch {
        return { ok: false, reason: "provider_failed" };
      }
    },
    async remove(key) {
      try {
        const response = await s3Request(config, "DELETE", key);
        return response.ok || response.status === 404 ? { ok: true } : { ok: false, reason: "provider_failed" };
      } catch {
        return { ok: false, reason: "provider_failed" };
      }
    },
  };
}

export function createPrivateStorage(
  env: Record<string, string | undefined> = process.env,
): PrivateObjectStorage {
  const provider = env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "filesystem") {
    const problem = storageRootProblem(env.STORAGE_LOCAL_ROOT);
    if (problem) {
      return unconfiguredStorage();
    }
    const storageRoot = env.STORAGE_LOCAL_ROOT ?? "";
    return filesystemStorage(path.resolve(/* turbopackIgnore: true */ storageRoot));
  }
  if (provider === "s3") {
    const bucket = env.STORAGE_BUCKET?.trim();
    const region = env.STORAGE_REGION?.trim();
    const accessKeyId = env.STORAGE_ACCESS_KEY_ID?.trim();
    const secretAccessKey = env.STORAGE_SECRET_ACCESS_KEY?.trim();
    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      return unconfiguredStorage();
    }
    return s3Storage({
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: env.STORAGE_ENDPOINT?.trim() || undefined,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE === "true",
    });
  }
  return unconfiguredStorage();
}
