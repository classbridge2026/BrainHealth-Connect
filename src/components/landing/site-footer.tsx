import Link from "next/link";
import type { PublicContact } from "@/lib/public/landing";
import { BrandMark } from "./brand-mark";
import { focusRing } from "./styles";

const footerLink = `block rounded-md text-xs leading-5 text-white/85 underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-sm sm:leading-6 ${focusRing}`;

export function SiteFooter({ year, contact, systemName }: { year: number; contact: PublicContact; systemName: string }) {
  const hasContact = Boolean(contact.email || contact.phone || contact.address);
  return (
    <footer className="bg-brand-navy text-white">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_minmax(0,1fr)_max-content] gap-x-4 gap-y-6 px-4 py-6 sm:gap-x-6 sm:gap-y-8 sm:px-6 sm:py-10 lg:grid-cols-3 lg:gap-x-10 lg:px-8 lg:py-12">
        <div className="col-span-3 min-w-0">
          <div className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9 shrink-0 sm:h-10 sm:w-10" />
            <p className="min-w-0 text-base font-semibold tracking-tight">{systemName}</p>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-5 text-white/75 sm:mt-4 sm:leading-6">
            A healthcare platform for Sierra Leone, launching with mental health and built to grow into further specialties.
          </p>
        </div>

        <nav aria-label="Footer" className="min-w-0 break-words">
          <h2 className="text-sm font-semibold">Explore</h2>
          <ul className="mt-2 grid gap-1.5 sm:mt-3 sm:gap-2">
            <li>
              <Link className={footerLink} href="/#services">
                Services
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/#how-it-works">
                How It Works
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/#about">
                About Us
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/patient/find" prefetch={false}>
                Find a Doctor
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Account" className="min-w-0 break-words">
          <h2 className="text-sm font-semibold">Account</h2>
          <ul className="mt-2 grid gap-1.5 sm:mt-3 sm:gap-2">
            <li>
              <Link className={footerLink} href="/login" prefetch={false}>
                Log In
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/register" prefetch={false}>
                Create Patient Account
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/patient/find" prefetch={false}>
                Book an Appointment
              </Link>
            </li>
          </ul>
        </nav>

        <div className="break-words">
          <h2 className="text-sm font-semibold">Contact</h2>
          {hasContact ? (
            <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-white/85 sm:mt-3 sm:gap-2 sm:text-sm sm:leading-6">
              {contact.email ? (
                <li>
                  <a className={footerLink} href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </li>
              ) : null}
              {contact.phone ? (
                <li>
                  <a className={`${footerLink} whitespace-nowrap`} href={`tel:${contact.phone.replace(/\s+/g, "")}`}>
                    {contact.phone}
                  </a>
                </li>
              ) : null}
              {contact.address ? <li>{contact.address}</li> : null}
            </ul>
          ) : (
            <p className="mt-2 text-xs leading-5 whitespace-nowrap text-white/75 sm:mt-3 sm:text-sm sm:leading-6">+232 80 790065</p>
          )}
          <ul className="mt-2 grid gap-1.5 sm:mt-3 sm:gap-2">
            <li>
              <Link className={footerLink} href="/privacy">
                Privacy Notice
              </Link>
            </li>
            <li>
              <Link className={footerLink} href="/terms">
                Terms of Service
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/15">
        <p className="mx-auto w-full max-w-6xl px-4 py-3 text-center text-xs leading-5 text-white/70 sm:px-6 sm:py-4 sm:text-left sm:text-sm sm:leading-6 lg:px-8">
          Developed by Osman Tholley <span aria-hidden="true">·</span> © {year} {systemName}
        </p>
      </div>
    </footer>
  );
}
