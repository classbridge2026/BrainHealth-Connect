import Image from "next/image";
import Link from "next/link";
import type { PublicContact, PublicLanding, PublicService } from "@/lib/public/landing";
import { CareCircleMark } from "@/components/brand";
import { BenefitAppIcon, StepAppIcon } from "./icons";
import { DoctorCarousel } from "./doctor-carousel";
import { LandingScroll } from "./landing-scroll";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { AccountSupportPanel } from "@/components/support/account-support-panel";
import { btnOnNavy, btnOnNavyGhost, btnOnNavyOutline, btnPrimary, btnSecondary, focusRing } from "./styles";

const steps = [
  {
    title: "Create Your Account",
    body: "Register as a patient. Public registration creates a patient account only.",
    icon: "account" as const,
  },
  {
    title: "Find Your Care",
    body: "Explore the doctors and consultation services that are approved and currently available.",
    icon: "search" as const,
  },
  {
    title: "Choose a Time",
    body: "View published appointment times and select a suitable slot. Times are shown in Africa/Freetown.",
    icon: "calendar" as const,
  },
  {
    title: "Get Care",
    body: "Attend in the way recorded on the booking. An online visit opens a waiting room. You join the video or audio call when the doctor is ready.",
    icon: "care" as const,
  },
];

const benefits = [
  {
    title: "Patient-Centred Care",
    body: "A welcoming experience designed around patient needs.",
    icon: "care" as const,
  },
  {
    title: "Convenient Access",
    body: "Discover available services and appointment options in one place.",
    icon: "access" as const,
  },
  {
    title: "Privacy and Trust",
    body: "Patient information is meant to be kept confidential. This is a privacy principle, not a security certification.",
    icon: "shield" as const,
  },
  {
    title: "A Growing Healthcare Network",
    body: "Mental health comes first, on a platform shaped for future specialties.",
    icon: "network" as const,
  },
];

function modeLabel(mode: "ONLINE" | "IN_PERSON") {
  return mode === "ONLINE" ? "Online" : "In person";
}

function UnavailableNotice() {
  return (
    <p className="rounded-2xl border border-brand-line bg-white p-5 text-sm leading-6 text-brand-muted" role="status">
      Live listings could not be loaded just now. You can still create a patient account, and the doctor directory will show what is available when you sign in.
    </p>
  );
}

function ServiceCard({ service }: { service: PublicService }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#d5deea] bg-white shadow-sm">
      <header className="bg-brand-navy px-5 py-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{service.name}</h3>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${service.bookable ? "bg-brand-teal text-white" : "bg-white/15 text-white/80"}`}>
            {service.bookable ? "Open" : "Closed"}
          </span>
        </div>
      </header>
      <div className="flex flex-1 flex-col bg-[#f7fafc] px-5 py-4">
        {service.description ? <p className="line-clamp-3 flex-1 text-sm leading-6 text-[#3a4a60]">{service.description}</p> : <div className="flex-1" />}
        {service.modes.length > 0 || service.durationLabel || service.fee ? (
          <dl className="mt-4 grid grid-cols-2 gap-3">
            {service.modes.length > 0 ? (
              <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#d5deea]">
                <dt className="text-[11px] font-semibold tracking-wide text-[#5b6d84] uppercase">Visit</dt>
                <dd className="mt-1 text-sm font-semibold text-brand-navy">{service.modes.map(modeLabel).join(" and ")}</dd>
              </div>
            ) : null}
            {service.durationLabel ? (
              <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-[#d5deea]">
                <dt className="text-[11px] font-semibold tracking-wide text-[#5b6d84] uppercase">Length</dt>
                <dd className="mt-1 text-sm font-semibold whitespace-nowrap text-brand-navy">{service.durationLabel}</dd>
              </div>
            ) : null}
            {service.fee ? (
              <div className="col-span-2 rounded-xl bg-[#e7f3f1] px-3 py-2 ring-1 ring-[#b7ddd6]">
                <dt className="text-[11px] font-semibold tracking-wide text-brand-teal uppercase">Price</dt>
                <dd className="mt-1 text-sm font-semibold text-[#0b5f59]">{service.fee}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {service.bookable ? (
          <Link href={`/patient/find?service=${service.id}`} prefetch={false} className={`${btnPrimary} mt-4 w-full`}>
            Book now
          </Link>
        ) : (
          <p className="mt-4 text-sm text-[#5b6d84]">This service is published, and it is not available to book yet.</p>
        )}
      </div>
    </article>
  );
}

function DoctorsSection({ content }: { content: PublicLanding }) {
  return (
    <section id="doctors" aria-labelledby="doctors-heading" className="scroll-mt-24 bg-[#f3f8fb]">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-8 sm:py-20 lg:px-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="doctors-heading" className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
              Meet Our Doctors
            </h2>
            <p className="mt-2 max-w-2xl text-base leading-7 text-brand-muted">
              Approved doctors with a verified specialty. A consultation service appears here when an administrator assigns it. Sign in to choose a time.
            </p>
          </div>
          <Link href="/patient/find" prefetch={false} className={`shrink-0 text-sm font-semibold text-brand-navy underline-offset-4 hover:underline ${focusRing}`}>
            View all doctors
          </Link>
        </div>
        <div className="mt-8">
          {!content.ok ? (
            <UnavailableNotice />
          ) : content.doctors.length === 0 ? (
            <p className="rounded-2xl border border-brand-line bg-white p-6 text-sm leading-6 text-brand-muted">
              No approved doctors are available to feature yet. Please check again as the healthcare network grows.
            </p>
          ) : (
            <DoctorCarousel doctors={content.doctors} />
          )}
        </div>
      </div>
    </section>
  );
}

function ServicesSection({ content }: { content: PublicLanding }) {
  return (
    <section id="services" aria-labelledby="services-heading" className="scroll-mt-24 bg-brand-ice">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="text-sm font-semibold tracking-[0.14em] text-brand-teal uppercase">Services</p>
        <h2 id="services-heading" className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
          Consultation services
        </h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-brand-muted">
          Published consultation services. A service can be booked when it is open.
        </p>
        <div className="mt-8">
          {!content.ok ? (
            <UnavailableNotice />
          ) : content.services.length === 0 ? (
            <p className="rounded-2xl border border-brand-line bg-white p-5 text-sm leading-6 text-brand-muted">
              No consultation services are available to book yet.
            </p>
          ) : (
            <ul className="grid gap-4 md:grid-cols-2">
              {content.services.map((service) => (
                <li key={service.id}>
                  <ServiceCard service={service} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ContactSection({ contact }: { contact: PublicContact }) {
  const hasContact = Boolean(contact.email || contact.phone || contact.address);
  return (
    <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-24 bg-brand-ice">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:px-8">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-brand-teal uppercase">Contact</p>
          <h2 id="contact-heading" className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
            Talk with the platform team
          </h2>
          <p className="mt-4 text-base leading-7 text-brand-muted">
            For help signing in or recovering a password, send an account support request. An administrator reads it in the admin portal.
          </p>
        </div>
        <div className="rounded-2xl border border-brand-line bg-white p-6 shadow-sm">
          {hasContact ? (
            <ul className="grid gap-4 text-sm leading-6 text-brand-ink">
              {contact.email ? (
                <li>
                  <p className="font-semibold text-brand-navy">Email</p>
                  <a className={`text-brand-teal underline-offset-4 hover:underline ${focusRing}`} href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </li>
              ) : null}
              {contact.phone ? (
                <li>
                  <p className="font-semibold text-brand-navy">Phone</p>
                  <a className={`text-brand-teal underline-offset-4 hover:underline ${focusRing}`} href={`tel:${contact.phone.replace(/\s+/g, "")}`}>
                    {contact.phone}
                  </a>
                </li>
              ) : null}
              {contact.address ? (
                <li>
                  <p className="font-semibold text-brand-navy">Address</p>
                  <p>{contact.address}</p>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-brand-muted">
              Public contact details have not been configured yet. An administrator can add them before launch. No telephone number, email address, or location is shown until then.
            </p>
          )}
        </div>
        <AccountSupportPanel />
      </div>
    </section>
  );
}

export function LandingView({ content, year, systemName }: { content: PublicLanding; year: number; systemName: string }) {
  return (
    <div id="top" className="min-h-dvh bg-white text-brand-ink">
      <LandingScroll />
      <a
        href="#main"
        className={`sr-only z-50 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-brand-navy focus:not-sr-only focus:fixed focus:top-3 focus:left-3 ${focusRing}`}
      >
        Skip to content
      </a>
      <SiteHeader systemName={systemName} />
      <main id="main">
        <section aria-labelledby="hero-heading" className="bg-brand-navy text-white">
          <div className="grid lg:grid-cols-2">
            <div className="order-2 flex flex-col justify-center px-4 py-10 sm:px-8 sm:py-14 lg:order-1 lg:px-12 lg:py-16 xl:px-16">
              <div className="flex items-center gap-3">
                <CareCircleMark className="h-14 w-14 sm:h-16 sm:w-16" />
                <p className="text-sm font-semibold tracking-[0.14em] text-white/80 uppercase">{systemName}</p>
              </div>
              <h1 id="hero-heading" className="mt-6 max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl xl:text-6xl">
                Healthcare That Puts You First.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-white/80 sm:text-lg sm:leading-8">
                Connect with qualified healthcare professionals, explore available services, and access care that fits your needs. {systemName} is building a more connected healthcare experience for Sierra Leone.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/patient/find" prefetch={false} className={`${btnOnNavy} w-full sm:w-auto`}>
                  Find a Doctor
                </Link>
                <Link href="/#how-it-works" className={`${btnOnNavyOutline} w-full sm:w-auto`}>
                  How It Works
                </Link>
              </div>
              <p className="mt-4 text-sm leading-6 text-white/75">Your care. Your privacy. Your journey.</p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
                Browsing the directory and booking an appointment continue after you sign in with a patient account.
              </p>
            </div>
            <figure className="relative order-1 h-full min-h-64 sm:min-h-80 md:min-h-96 lg:order-2 lg:min-h-[40rem]">
              <Image
                src="/hero-consultation.jpg"
                alt="A physician in a white coat listens to a patient during a clinic consultation."
                fill
                priority
                quality={60}
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover object-[center_22%]"
              />
            </figure>
          </div>
        </section>

        <ServicesSection content={content} />

        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-24 bg-brand-paper">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold tracking-[0.16em] text-brand-teal uppercase">How it works</p>
              <h2 id="how-heading" className="mt-3 text-[22px] font-semibold tracking-tight whitespace-nowrap text-brand-navy min-[400px]:text-[26px] sm:text-4xl">
                Four steps to a booked visit
              </h2>
              <p className="mt-4 text-base leading-7 text-brand-muted">
                Register, choose an approved doctor, pick a published time, and attend the visit the way it was booked.
              </p>
            </div>
            <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:mt-14 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title} className="flex h-full">
                  <article className={`flex h-full w-full flex-col rounded-2xl border p-5 shadow-sm ${index % 2 === 0 ? "border-[#c5d4e6] bg-[#eef3f8]" : "border-[#b7ddd6] bg-[#e7f3f1]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <StepAppIcon name={step.icon} />
                      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white ${index % 2 === 0 ? "bg-brand-navy" : "bg-brand-teal"}`}>
                        {index + 1}
                      </span>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-brand-navy">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-brand-muted">{step.body}</p>
                  </article>
                </li>
              ))}
            </ol>
            <div className="mt-10 text-center">
              <Link href="/patient/find" prefetch={false} className={btnPrimary}>
                Start booking
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="why-heading" className="bg-brand-mist">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold tracking-[0.16em] text-brand-teal uppercase">Why CareCircle</p>
              <h2 id="why-heading" className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                Why choose {systemName}?
              </h2>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2">
              {benefits.map((benefit, index) => (
                <li key={benefit.title} className={`flex h-full gap-4 rounded-2xl border border-brand-line bg-white p-5 shadow-sm ${index % 2 === 0 ? "border-l-4 border-l-brand-navy" : "border-l-4 border-l-brand-teal"}`}>
                  <BenefitAppIcon name={benefit.icon} />
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-brand-navy">{benefit.title}</h3>
                    <p className="mt-1.5 text-sm leading-6 text-brand-muted">{benefit.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <DoctorsSection content={content} />

        <section aria-labelledby="next-heading" className="bg-brand-navy text-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
            <h2 id="next-heading" className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Your Next Step Towards Better Care Starts Here.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/80">
              Create a patient account, or sign in to look through available doctors and choose a published appointment time.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href="/patient/find" prefetch={false} className={btnOnNavy}>
                Find a Doctor
              </Link>
              <Link href="/register" prefetch={false} className={btnOnNavyOutline}>
                Create a Patient Account
              </Link>
              <Link href="/login" prefetch={false} className={btnOnNavyGhost}>
                Log In
              </Link>
            </div>
          </div>
        </section>

        <div aria-hidden="true" className="h-1 w-full bg-brand-teal" />

        <section id="about" aria-labelledby="about-heading" className="scroll-mt-24 w-full">
          <div className="grid w-full grid-cols-1 md:grid-cols-2">
            <div className="w-full bg-[#f7fafc] px-4 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16">
              <p className="text-sm font-semibold tracking-[0.16em] text-brand-teal uppercase">About us</p>
              <h2 id="about-heading" className="mt-3 text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                Care that can grow with the people who need it
              </h2>
              <p className="mt-4 text-base leading-7 text-[#3a4a60]">
                {systemName} connects patients with healthcare professionals and is being built to expand access to care. Mental health is the first specialty. Other specialties can be introduced as real services are ready, rather than promised in advance.
              </p>
              <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row">
                <Link href="/patient/find" prefetch={false} className={`${btnPrimary} w-full sm:flex-1`}>
                  Find a Doctor
                </Link>
                <Link href="/register" prefetch={false} className={`${btnSecondary} w-full sm:flex-1`}>
                  Create a Patient Account
                </Link>
              </div>
            </div>
            <div className="w-full bg-[#0f6b45] px-4 py-10 text-white sm:px-8 sm:py-14 lg:px-12 lg:py-16">
              <h3 className="text-lg font-semibold">What you can do today</h3>
              <ol className="mt-6 grid gap-5">
                {[
                  "Create a patient account and sign in.",
                  "Review specialties and consultation services that have been published.",
                  "Choose a time when an approved doctor has an open appointment.",
                ].map((item, index) => (
                  <li key={item} className="flex gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-[#0f6b45]">
                      {index + 1}
                    </span>
                    <p className="min-w-0 pt-1 text-sm leading-6 text-white/85">{item}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <ContactSection contact={content.contact} />
      </main>
      <SiteFooter year={year} contact={content.contact} systemName={systemName} />
    </div>
  );
}
