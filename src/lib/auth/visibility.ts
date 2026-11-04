import type { Prisma } from "@prisma/client";
import { DEVELOPER_ROLE_CODE } from "./constants";

/** Leave the operator account out of every directory a person can browse. */
export const notDeveloper: Prisma.UserWhereInput = {
  roles: { none: { role: { code: DEVELOPER_ROLE_CODE } } },
};
