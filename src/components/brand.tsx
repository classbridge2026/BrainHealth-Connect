import Image from "next/image";

export function CareCircleMark({ className }: { className?: string }) {
  return (
    <span className={`brand-mark relative inline-block shrink-0 ${className ?? "h-10 w-10"}`}>
      <Image src="/carecircle-logo.png" alt="" fill sizes="80px" className="object-cover" priority loading="eager" />
    </span>
  );
}

export function CareCircleSpinner() {
  return (
    <span className="inline-flex h-20 w-20 shrink-0 rounded-full shadow-[0_8px_24px_rgba(12,43,69,0.12)]">
      <span className="inline-flex h-full w-full animate-spin motion-reduce:animate-none" aria-hidden="true">
        <CareCircleMark className="h-20 w-20" />
      </span>
    </span>
  );
}

export function PortalLoading({ tall = false }: { tall?: boolean }) {
  const height = tall
    ? "min-h-[calc(100dvh-6rem)] sm:min-h-[calc(100dvh-6.5rem)]"
    : "min-h-[calc(100dvh-7rem)] lg:min-h-[calc(100dvh-7.5rem)]";
  return (
    <div className={`grid h-full place-items-center ${height}`} role="status" aria-label="Loading">
      <CareCircleSpinner />
    </div>
  );
}

export function DoctorAvatar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Illustrated clinician" className={`aspect-square ${className ?? ""}`}>
      <rect width="200" height="200" fill="#12304A" />
      <circle cx="100" cy="78" r="34" fill="#F7FBFC" />
      <path d="M38 200c10-58 38-86 62-86s52 28 62 86" fill="#0F766E" />
      <rect x="82" y="112" width="36" height="16" rx="3" fill="#ffffff" />
    </svg>
  );
}
