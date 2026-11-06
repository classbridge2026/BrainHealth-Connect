/**
 * Prisma generate sometimes leaves query_engine copies named *.tmp<pid>.
 * File tracing ships every one of them. They are not used at runtime.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const clientDir = path.join(process.cwd(), "node_modules", ".prisma", "client");

let names;
try {
  names = await readdir(clientDir);
} catch {
  process.exit(0);
}

const leftover = names.filter((name) => name.startsWith("query_engine") && name.includes(".tmp"));
await Promise.all(leftover.map((name) => rm(path.join(clientDir, name), { force: true })));

if (leftover.length > 0) {
  console.log(`Removed ${leftover.length} leftover Prisma engine files`);
}
