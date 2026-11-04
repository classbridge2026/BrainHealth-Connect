"use client";

import { useEffect, useRef, useState } from "react";
import { secondaryButtonClass } from "@/components/form-classes";

const minScale = 0.5;
const maxScale = 4;
const step = 0.25;

function clamp(scale: number) {
  return Math.min(maxScale, Math.max(minScale, Math.round(scale * 100) / 100));
}

export function ReceiptViewer({ src }: { src: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      setScale((current) => clamp(current + (event.deltaY < 0 ? step : -step)));
    }
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <figure className="grid max-w-3xl gap-3">
      <div className="flex flex-wrap items-center gap-2" data-no-busy="">
        <button type="button" className={secondaryButtonClass} disabled={scale <= minScale} onClick={() => setScale((current) => clamp(current - step))}>
          Zoom out
        </button>
        <span className="min-w-14 text-center text-sm font-semibold text-brand-navy" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button type="button" className={secondaryButtonClass} disabled={scale >= maxScale} onClick={() => setScale((current) => clamp(current + step))}>
          Zoom in
        </button>
        <button type="button" className={secondaryButtonClass} disabled={scale === 1} onClick={() => setScale(1)}>
          Reset
        </button>
      </div>
      <div ref={frameRef} className="max-h-[75vh] overflow-auto rounded-2xl border border-brand-line bg-white">
        <img
          src={src}
          alt="Screenshot of the transaction details"
          draggable={false}
          className="h-auto max-w-none"
          style={{ width: `${Math.round(320 * scale)}px` }}
        />
      </div>
    </figure>
  );
}
