"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ReleaseWhenHoldEnds({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();

  useEffect(() => {
    const expiry = new Date(expiresAt).getTime();
    let timer = 0;
    let stopped = false;
    let refreshes = 0;

    const tick = () => {
      if (stopped) return;
      const remaining = expiry - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(tick, Math.min(remaining + 300, 1000));
        return;
      }
      if (refreshes < 3) {
        refreshes += 1;
        router.refresh();
        timer = window.setTimeout(tick, 1500);
      }
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [expiresAt, router]);

  return null;
}
