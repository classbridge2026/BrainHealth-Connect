"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Loads the current page again after a server action returns, so the new status shows without a manual reload. */
export function useRefreshAfterAction(message: string | undefined) {
  const router = useRouter();
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!message || message === seen.current) return;
    seen.current = message;
    router.refresh();
  }, [message, router]);
}
