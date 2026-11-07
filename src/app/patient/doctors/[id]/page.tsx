import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { loadPublicDoctor } from "@/lib/appointments/queries";
import { prisma } from "@/lib/db/prisma";
import { DoctorProfileView } from "./doctor-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicDoctor(prisma, id);
  return { title: result.ok && result.doctor.bookable ? result.doctor.displayName : "Doctor" };
}

export default async function PublicDoctorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const visit = typeof query.visit === "string" ? query.visit : "";
  const result = await loadPublicDoctor(prisma, id);
  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <RecordsUnavailable code={result.code} />;
  }
  if (!result.doctor.bookable) notFound();
  const offer = typeof query.offer === "string" ? query.offer : "";
  return <DoctorProfileView doctor={result.doctor} visit={visit} offer={offer} />;
}

