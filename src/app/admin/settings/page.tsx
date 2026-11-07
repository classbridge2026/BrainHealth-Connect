import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminIcon, type AdminIconName } from "@/components/admin/admin-icons";
import { PageHeader } from "@/components/admin/catalog-ui";
import { Notice } from "@/components/admin/portal-ui";
import { RecordsUnavailable } from "@/components/records-unavailable";
import { ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { emailProviderConfigured } from "@/lib/auth/delivery";
import { loadPlatformSettings } from "@/lib/admin/directories";
import { formatPlatformWhen } from "@/lib/admin/labels";
import { prisma } from "@/lib/db/prisma";
import { afrimoneyConfigured, orangeConfigured } from "@/lib/payments/mobile-money";
import { formatOrangeDialNumber } from "@/lib/payments/orange-transfer";
import { AfrimoneyNumberForm, CurrencySettingForm, HoldSettingForm, OrangeNumberForm, PublicContactForm, SystemNameForm } from "./settings-forms";

export const metadata: Metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

const lockedNames: Record<string, string> = {
  MINOR_REGISTRATION_ENABLED: "Minor registration",
  MINOR_TREATMENT_ENABLED: "Minor treatment",
  DOCTOR_IDENTITY_DOCUMENT_REQUIRED: "Doctor identity document",
};

function storedValue(value: unknown) {
  if (value === true) return "Enabled";
  if (value === false) return "Disabled";
  if (value === null || value === undefined) return "Not stored";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "Stored structured value";
}

function Snapshot({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: AdminIconName; tone: string }) {
  return (
    <article className="stat-card" style={{ "--stat": tone } as CSSProperties} title={value}>
      <span className="stat-card-icon">
        <AdminIcon name={icon} />
      </span>
      <span className="stat-card-copy">
        <span className="stat-card-value">{value}</span>
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-note">{note}</span>
      </span>
    </article>
  );
}

function StatusChip({ ready, readyLabel, offLabel }: { ready: boolean; readyLabel: string; offLabel: string }) {
  return <span className={ready ? "inline-flex h-7 shrink-0 items-center rounded-full bg-[#e7f3f1] px-3 text-xs font-bold text-[#0b5f59]" : "inline-flex h-7 shrink-0 items-center rounded-full bg-[#f4f7fb] px-3 text-xs font-bold text-brand-muted"}>{ready ? readyLabel : offLabel}</span>;
}

export default async function SettingsPage() {
  await requireStoredRoles([ADMIN_ROLE_CODE, SUPER_ADMIN_ROLE_CODE]);
  const settings = await loadPlatformSettings(prisma);
  if (!settings.ok) return <RecordsUnavailable code={settings.code} />;
  const emailReady = emailProviderConfigured();
  const orangeApi = orangeConfigured();
  const afriApi = afrimoneyConfigured();
  const orangeDial = settings.orangeNumber ? formatOrangeDialNumber(settings.orangeNumber) : "";
  const afriDial = settings.afrimoneyNumber ? formatOrangeDialNumber(settings.afrimoneyNumber) : "";
  const contactReady = Boolean(settings.publicEmail || settings.publicPhone || settings.publicAddress);
  const contactValue = settings.publicEmail || settings.publicPhone || settings.publicAddress || "Not set";
  return (
    <main className="grid gap-4">
      <PageHeader eyebrow="Platform" title="Platform settings" description="Only settings the application already reads can be changed. Environment secrets are not listed." />
      <section className="stat-grid settings-stat" aria-label="Current platform values">
        <Snapshot label="System name" value={settings.systemName} note="Public site and portals" icon="settings" tone="#12304a" />
        <Snapshot label="Public contact" value={contactValue} note={contactReady ? "Shown on the homepage" : "Homepage notice is showing"} icon="location" tone={contactReady ? "#0f766e" : "#d97706"} />
        <Snapshot label="Currency" value={settings.currency} note="New catalog prices" icon="fee" tone="#0369a1" />
        <Snapshot label="Orange Money" value={orangeDial || "Not saved"} note={orangeApi ? "API connected" : "Patients dial this number"} icon="payment" tone={orangeDial ? "#0f766e" : "#d97706"} />
        <Snapshot label="Afrimoney" value={afriDial || "Not saved"} note={afriApi ? "API connected" : "Patients dial *161*1*1*"} icon="payment" tone={afriDial ? "#15803d" : "#d97706"} />
        <Snapshot label="Payment hold" value={settings.holdMinutes === null ? "15 min" : `${settings.holdMinutes} min`} note={settings.holdMinutes === null ? "Default until you save" : "Unpaid bookings expire"} icon="clock" tone="#12304a" />
      </section>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="grid gap-4">
          <SystemNameForm systemName={settings.systemName} />
          <PublicContactForm email={settings.publicEmail} phone={settings.publicPhone} address={settings.publicAddress} />
          <section className="admin-panel">
            <header className="admin-panel-head">
              <h2>
                <AdminIcon name="shield" />
                Clinic defaults
              </h2>
            </header>
            <ul className="admin-feed">
              <li>
                <div className="admin-feed-row">
                  <span>
                    <span className="admin-feed-title">Screening support contact</span>
                    <span className="admin-feed-meta">The service name and phone number shown when a screen raises a safety flag.</span>
                  </span>
                  <Link className="shrink-0 text-sm font-semibold text-brand-teal" href="/admin/screening">
                    Open screening
                  </Link>
                </div>
              </li>
              <li>
                <div className="admin-feed-row">
                  <span>
                    <span className="admin-feed-title">New account timezone</span>
                    <span className="admin-feed-meta">New accounts default to Africa/Freetown. Availability rules keep their own timezone. Existing schedules are not rewritten from this page.</span>
                  </span>
                </div>
              </li>
            </ul>
          </section>
        </div>
        <div className="grid gap-4">
          <OrangeNumberForm number={orangeDial} />
          <AfrimoneyNumberForm number={afriDial} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <CurrencySettingForm currency={settings.currency} />
            <HoldSettingForm minutes={settings.holdMinutes} />
          </div>
        </div>
      </div>
      <section className="admin-panel">
        <header className="admin-panel-head">
          <h2>
            <AdminIcon name="calendar" />
            Booking rules
          </h2>
        </header>
        <div className="admin-panel-body grid gap-3">
          <Notice>
            A doctor cannot have two occupying appointments in the same time range. Occupying statuses are pending payment, confirmed, checked in, and in progress. That rule is enforced by the database and is not a setting.
          </Notice>
          <p className="text-sm leading-6 text-brand-muted">
            The payment hold above is the booking duration the application reads.{" "}
            <Link className="font-semibold text-brand-teal" href="/admin/configuration">
              Catalog status
            </Link>{" "}
            shows active specialties, services, and locations.
          </p>
        </div>
      </section>
      <section className="admin-panel">
        <header className="admin-panel-head">
          <h2>
            <AdminIcon name="shieldCheck" />
            Locked policy settings
          </h2>
        </header>
        <div className="admin-panel-body grid gap-3">
          <p className="text-sm leading-6 text-brand-muted">Minor-care flags and the identity-document requirement are shown as stored. This portal does not change them.</p>
          <div className="stat-grid settings-stat">
            {settings.locked.map((setting) => {
              const value = storedValue(setting.value);
              return (
                <article key={setting.key} className="stat-card" style={{ "--stat": value === "Enabled" ? "#15803d" : "#12304a" } as CSSProperties}>
                  <span className="stat-card-copy">
                    <span className="stat-card-value">{value}</span>
                    <span className="stat-card-label">{lockedNames[setting.key] ?? setting.key}</span>
                    <span className="stat-card-note">{setting.updatedAt ? `Updated ${formatPlatformWhen(new Date(setting.updatedAt))}` : "No row stored"}</span>
                  </span>
                </article>
              );
            })}
          </div>
        </div>
      </section>
      <section className="admin-panel">
        <header className="admin-panel-head">
          <h2>
            <AdminIcon name="bell" />
            Notifications and payments
          </h2>
        </header>
        <ul className="admin-feed">
          <li>
            <div className="admin-feed-row">
              <span>
                <span className="admin-feed-title">Email delivery</span>
                <span className="admin-feed-meta">
                  {emailReady
                    ? "Email delivery is configured with Gmail SMTP. A message is recorded as sent only after Gmail accepts it."
                    : "Email delivery is not configured. Set the SMTP variables outside this page. Verification, invitation, and appointment email stay unsent until then."}
                </span>
              </span>
              <StatusChip ready={emailReady} readyLabel="Ready" offLabel="Not set" />
            </div>
          </li>
          <li>
            <div className="admin-feed-row">
              <span>
                <span className="admin-feed-title">Orange Money API</span>
                <span className="admin-feed-meta">
                  {orangeApi
                    ? "Orange Money API is connected. A paid visit is recorded when Orange confirms it."
                    : "Orange Money API is not connected yet. Add ORANGE_MONEY_CLIENT_ID, ORANGE_MONEY_CLIENT_SECRET, ORANGE_MONEY_MERCHANT_KEY, and ORANGE_MONEY_WEB_PATH on the server. Until then, patients dial the Orange Money number above."}
                </span>
              </span>
              <StatusChip ready={orangeApi} readyLabel="Connected" offLabel="Dial code" />
            </div>
          </li>
          <li>
            <div className="admin-feed-row">
              <span>
                <span className="admin-feed-title">Afrimoney API</span>
                <span className="admin-feed-meta">
                  {afriApi
                    ? "Afrimoney API is connected."
                    : "Afrimoney API is not connected yet. Add AFRIMONEY_API_BASE, AFRIMONEY_API_KEY, and AFRIMONEY_CALLBACK_SECRET on the server when Africell issues them. Until then, patients dial *161*1*1*this number*amount*PIN#."}
                </span>
              </span>
              <StatusChip ready={afriApi} readyLabel="Connected" offLabel="Dial code" />
            </div>
          </li>
        </ul>
      </section>
      {settings.other.length > 0 ? (
        <section className="admin-panel">
          <header className="admin-panel-head">
            <h2>
              <AdminIcon name="audit" />
              Other stored settings
            </h2>
          </header>
          <div className="admin-panel-body">
            <p className="mb-3 text-sm leading-6 text-brand-muted">These keys have no editor because this page only changes the system name, public contact, currency, the Orange Money and Afrimoney numbers, and the payment hold.</p>
          </div>
          <ul className="admin-feed">
            {settings.other.map((setting) => (
              <li key={setting.key}>
                <div className="admin-feed-row">
                  <span>
                    <span className="admin-feed-title">{setting.key}</span>
                    <span className="admin-feed-meta">{setting.value}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
