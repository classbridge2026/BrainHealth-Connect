import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CachedProfileImage = {
  body: Buffer;
  mimeType: string;
  shared: boolean;
  version: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cacheDir() {
  return process.env.PROFILE_IMAGE_CACHE_DIR?.trim() || path.join(os.tmpdir(), "carecircle-profile-images");
}

function fileBase(userId: string) {
  if (!UUID.test(userId)) return null;
  return path.join(cacheDir(), userId.toLowerCase());
}

/** A photo already copied off the database. The version is the save time in the image address. */
export async function readCachedProfileImage(userId: string, version: string | null): Promise<CachedProfileImage | null> {
  const base = fileBase(userId);
  if (!base) return null;
  try {
    const meta = JSON.parse(await readFile(`${base}.json`, "utf8")) as { version?: unknown; mimeType?: unknown; shared?: unknown };
    if (typeof meta.version !== "string" || typeof meta.mimeType !== "string" || typeof meta.shared !== "boolean") return null;
    if (version && meta.version !== version) return null;
    const body = await readFile(`${base}.img`);
    if (body.byteLength === 0) return null;
    return { body, mimeType: meta.mimeType, shared: meta.shared, version: meta.version };
  } catch {
    return null;
  }
}

export async function writeCachedProfileImage(userId: string, image: CachedProfileImage) {
  const base = fileBase(userId);
  if (!base) return;
  await mkdir(cacheDir(), { recursive: true });
  await writeFile(`${base}.img`, image.body);
  await writeFile(
    `${base}.json`,
    JSON.stringify({ version: image.version, mimeType: image.mimeType, shared: image.shared }),
  );
}

export async function forgetCachedProfileImage(userId: string) {
  const base = fileBase(userId);
  if (!base) return;
  await rm(`${base}.img`, { force: true }).catch(() => undefined);
  await rm(`${base}.json`, { force: true }).catch(() => undefined);
}
