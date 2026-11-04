"use client";

import { Search } from "lucide-react";
import { LiveSearchInput } from "@/components/live-query";

export function DoctorSearch({ initialQuery }: { initialQuery: string }) {
  return (
    <form className="find-search" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="find-search-field">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search doctors</span>
        <LiveSearchInput destination="/patient/find" initial={initialQuery} placeholder="Search doctors" />
      </label>
    </form>
  );
}
