"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function CurrentScroller({ marker, className = "mbk-days", children }: { marker: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = ref.current;
    const current = scroller?.querySelector("[aria-current]");
    if (!scroller || !(current instanceof HTMLElement)) return;
    const left = current.offsetLeft - (scroller.clientWidth - current.offsetWidth) / 2;
    scroller.scrollTo({ left: Math.max(0, left) });
  }, [marker]);

  return (
    <div ref={ref} className={className} role="list">
      {children}
    </div>
  );
}
