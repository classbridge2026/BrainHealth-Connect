"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Checking the hold…");

  useEffect(() => {
    const expiry = new Date(expiresAt).getTime();
    let timer = 0;
    let stopped = false;
    let refreshes = 0;

    const tick = () => {
      if (stopped) return;
      const remaining = expiry - Date.now();
      if (remaining <= 0) {
        setLabel("The payment hold has ended. Updating this visit…");
        if (refreshes < 3) {
          refreshes += 1;
          router.refresh();
          timer = window.setTimeout(tick, 1500);
        }
        return;
      }
      const minutes = Math.floor(remaining / 60_000);
      const seconds = Math.floor((remaining % 60_000) / 1000);
      setLabel(`Payment hold: ${minutes}:${String(seconds).padStart(2, "0")} remaining.`);
      timer = window.setTimeout(tick, 1000);
    };

    tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [expiresAt, router]);

  return <p className="text-sm font-medium text-brand-navy">{label}</p>;
}
