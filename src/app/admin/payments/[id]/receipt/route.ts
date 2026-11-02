import { NextResponse } from "next/server";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { parseUuid } from "@/lib/catalog/rules";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const missing = new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const { id: rawId } = await context.params;
  const id = parseUuid(rawId);
  if (!id) return missing;
  const row = await prisma.payment.findUnique({
    where: { id },
    select: { receiptBytes: true, receiptMime: true, providerReference: true },
  });
  if (!row?.receiptBytes || !row.receiptMime) return missing;
  const name = (row.providerReference ?? "transaction").replace(/[^A-Za-z0-9._-]/g, "");
  return new NextResponse(Buffer.from(row.receiptBytes), {
    headers: {
      "Content-Type": row.receiptMime,
      "Content-Disposition": `inline; filename="${name || "transaction"}.jpg"`,
      "Cache-Control": "private, no-store",
    },
  });
}
