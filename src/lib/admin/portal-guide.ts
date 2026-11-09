import { markClickTargets } from "@/lib/guide/click-targets";
import { GUIDE_EXAMPLES, GUIDE_FEATURES } from "./guide-features";
import { addGuideFeatures, learnPortalFeatures, learnedGuideFeature, predictGuideFeature } from "./guide-model";

export type GuideLink = { href: string; label: string };
export type GuideReply = {
  topicId: string | null;
  title: string;
  paragraphs: string[];
  steps: string[];
  links: GuideLink[];
  prompts: string[];
};

type GuideAction = { verbs: string[]; text: string };
type GuideTopic = {
  id: string;
  title: string;
  href: string;
  exact?: boolean;
  group: string;
  aliases: string[];
  keywords: string[];
  summary: string;
  canDo: string[];
  how: string[];
  limits: string[];
  actions: GuideAction[];
  prompts: string[];
};

const TOPICS: GuideTopic[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    href: "/admin",
    exact: true,
    group: "Overview",
    aliases: ["dashboard", "home", "overview"],
    keywords: ["totals", "trend", "welcome"],
    summary: "The dashboard is the landing page. It counts doctors, patients, today's appointments, active services, and locations, then shows the last seven days of appointments and recent activity.",
    canDo: ["Open a total to jump to that list.", "Read appointment status and the seven-day trend.", "Use recent activity as a trail of what just changed."],
    how: ["The counts come from stored records, not from a separate report.", "Today's appointments use the clinic clock.", "Each card links to the matching sidebar tab."],
    limits: ["The dashboard does not edit records. Open the related tab to change something."],
    actions: [],
    prompts: ["What do the dashboard cards mean?", "Where do I start setting up the clinic?"],
  },
  {
    id: "users",
    title: "All users",
    href: "/admin/users",
    group: "People and access",
    aliases: ["all users", "user account", "user accounts"],
    keywords: ["users", "account", "accounts", "login", "email"],
    summary: "All users is every stored account: patients, doctors, and administrators. Open a row to read the account, then create, update, or delete it.",
    canDo: ["Search by name or email from the page or the header search.", "Create an account.", "Update an account.", "Delete an account that the portal allows you to remove."],
    how: ["The list is paged.", "Administrator access is granted from Administrators and roles, not by public registration.", "A deleted account is removed from sign-in. Clinical history stays governed by the record rules."],
    limits: ["Do not use this list to approve a doctor. That decision is on Doctor verification."],
    actions: [
      { verbs: ["add", "create", "new"], text: "Use New on All users, then save the account. Public registration cannot assign an administrator role." },
      { verbs: ["edit", "update", "change"], text: "Open the user and save the updated account details." },
      { verbs: ["delete", "remove"], text: "Open the user and delete the account only when the portal offers that action." },
    ],
    prompts: ["How do I create a user?", "Where do I grant an administrator?"],
  },
  {
    id: "patients",
    title: "Patients",
    href: "/admin/patients",
    group: "People and access",
    aliases: ["patient", "patients", "patient account"],
    keywords: ["patient", "patients"],
    summary: "Patients lists people who book care. You can search, open a patient, create an account, update it, or delete it.",
    canDo: ["Search the patient list.", "Create a patient account.", "Update the stored account details.", "Open the patient to see the account the portal stores."],
    how: ["Patients book their own appointments from the patient side.", "An administrator can cancel a booking from Appointments.", "Screening answers and clinical notes are not pasted into this chat."],
    limits: ["This guide does not look up a named patient's record or clinical note."],
    actions: [
      { verbs: ["add", "create", "new"], text: "On Patients, create the account and save it." },
      { verbs: ["edit", "update"], text: "Open the patient and save the account changes." },
      { verbs: ["delete", "remove"], text: "Open the patient and use delete when that action is offered." },
    ],
    prompts: ["How do I add a patient?", "Where are a patient's appointments?"],
  },
  {
    id: "doctors",
    title: "Doctors",
    href: "/admin/doctors",
    group: "People and access",
    aliases: ["doctor list", "doctors list", "clinician", "clinicians", "add doctor", "add a doctor", "create doctor", "new doctor"],
    keywords: ["doctor", "doctors", "clinician"],
    summary: "Doctors lists clinician accounts. From here you add a doctor, open a profile, and follow invitations. Approval of a submitted profile is a separate tab, Doctor verification.",
    canDo: ["Search doctors.", "Add a doctor.", "Open a doctor profile.", "Update or delete a doctor when the portal offers it.", "Open invitations to resend or revoke one."],
    how: ["A new doctor is not bookable until the profile is approved and a consultation is assigned on Doctor offerings.", "Invitations live at Doctor invitations, linked from the doctor area.", "Availability is edited on the doctor's own availability page."],
    limits: ["Approving, declining, returning, suspending, or reactivating a profile is done from the doctor profile and Doctor verification, not from this chat."],
    actions: [
      { verbs: ["add", "create", "new", "invite"], text: "Open Doctors, then Add doctor. You need an active specialty first, or the save button stays off. Enter the doctor's full name, email, and phone. The phone can be an international number, or a Sierra Leone number starting with 0. Choose the specialty. Qualification, years of experience, and a short biography are optional. Press Create doctor and send invitation. That creates the account and a single-use invitation. The doctor sets their own password from the link. Public registration cannot create this account. When email is configured, the invitation is sent. If it is not, the account still exists and you can resend it from Doctor invitations. The doctor cannot be booked until you approve the submitted profile and assign a consultation on Doctor offerings." },
      { verbs: ["suspend"], text: "Open the doctor profile and suspend the approved doctor. Reactivate from the same profile when they should practice again." },
      { verbs: ["delete", "remove"], text: "Open the doctor and delete only when the portal offers that action." },
    ],
    prompts: ["How do I add a doctor?", "How is a doctor approved?"],
  },
  {
    id: "verification",
    title: "Doctor verification",
    href: "/admin/doctors/pending",
    group: "People and access",
    aliases: ["doctor verification", "pending verification", "pending doctors", "approve doctor", "verify doctor"],
    keywords: ["verification", "pending", "approve", "approval", "decline", "credential", "credentials", "licence", "license"],
    summary: "Doctor verification lists profiles waiting for a decision. Open a doctor, read what they submitted, then approve, decline, or return it. Credentials are reviewed on the profile.",
    canDo: ["Search pending doctors.", "Open a submitted profile.", "Approve a profile that is ready.", "Decline a profile.", "Return a profile so the doctor can correct it.", "Review a credential.", "Suspend or reactivate an approved doctor from the profile.", "Remove verification with unverify when that action is offered."],
    how: ["Pending means the doctor submitted a profile and it is not approved yet.", "Approval lets the doctor be assigned a consultation on Doctor offerings.", "A specialty claim can be verified on the profile.", "Operational issues also lists doctors still pending."],
    limits: ["The chat cannot approve a doctor. Open the profile and use the decision buttons there."],
    actions: [
      { verbs: ["approve", "accept", "verify"], text: "Open the pending doctor and approve the profile after you have read it. Then assign a service on Doctor offerings." },
      { verbs: ["decline", "reject", "deny"], text: "Open the doctor and decline the profile. The decision is stored with the profile." },
      { verbs: ["return"], text: "Return the profile when the doctor must correct it and submit again." },
    ],
    prompts: ["How do I approve a doctor?", "What happens after a doctor is approved?"],
  },
  {
    id: "roles",
    title: "Administrators and roles",
    href: "/admin/roles",
    group: "People and access",
    aliases: ["administrators and roles", "administrator role", "super administrator", "grant administrator", "grant role"],
    keywords: ["role", "roles", "administrator", "administrators", "superadmin", "permission", "permissions", "access"],
    summary: "This tab lists administrator accounts and their access. A super administrator can grant administrator or super administrator by email. An ordinary administrator can only review the list.",
    canDo: ["Review who already has administrator access.", "Open the account from the email.", "A super administrator can grant administrator or super administrator from the popup."],
    how: ["Public registration cannot assign either administrator role.", "Patient and doctor roles stay separate from administrator access.", "Granting uses the person's existing account email."],
    limits: ["Only a super administrator can grant or remove administrator roles."],
    actions: [
      { verbs: ["grant", "add", "give", "assign"], text: "A super administrator opens Grant administrator, enters the email, and chooses the role. An ordinary administrator sees the list but cannot grant." },
      { verbs: ["remove", "revoke"], text: "Role removal is limited to a super administrator from the account access actions." },
    ],
    prompts: ["Who can grant an administrator?", "What is a super administrator?"],
  },
  {
    id: "specialties",
    title: "Specialties",
    href: "/admin/specialties",
    group: "Healthcare configuration",
    aliases: ["specialty", "specialties", "speciality"],
    keywords: ["specialty", "specialties", "speciality"],
    summary: "Specialties are the clinical areas a doctor can claim, such as a department patients browse. You can create, review, update, and retire them.",
    canDo: ["Search specialties.", "Create a specialty.", "Edit a specialty.", "Retire a specialty so it is hidden from new claims.", "See which specialties already have doctors."],
    how: ["An active specialty can be claimed by a doctor.", "Retiring it leaves doctors already linked in place and hides it from new claims.", "Catalog status shows which specialties are active."],
    limits: ["Closing a specialty does not delete past appointments."],
    actions: [
      { verbs: ["add", "create", "new"], text: "Choose New specialty, enter the name, and save it as active if patients and doctors should see it." },
      { verbs: ["edit", "update", "rename"], text: "Open the specialty and save the new name or status." },
      { verbs: ["delete", "retire", "close", "deactivate"], text: "Retire the specialty to hide it from new claims. Doctors and visits already stored stay in place." },
    ],
    prompts: ["How do I add a specialty?", "What happens if I retire a specialty?"],
  },
  {
    id: "services",
    title: "Consultation services",
    href: "/admin/services",
    group: "Healthcare configuration",
    aliases: ["consultation service", "consultation services", "service catalog", "service", "services"],
    keywords: ["service", "services"],
    summary: "Consultation services are the visit types patients can book, such as a first visit or a follow-up. The fee for a service is set on Fees and pricing.",
    canDo: ["Search services.", "Filter by online or in person, and by active or inactive.", "Create a service.", "Edit a service.", "Retire a service so new bookings stop.", "See the fee that was set on Fees and pricing."],
    how: ["A service is the catalog item. A doctor offering assigns that service to one approved doctor.", "The fee is edited only on Fees and pricing. This page shows that amount.", "Closing a service leaves appointments already booked in place, including the fee stored on those appointments."],
    limits: ["This page does not set the price. Fees and pricing is the only place to change it."],
    actions: [
      { verbs: ["add", "create", "new"], text: "Choose New service, set the name and visit mode, then save. Set the fee afterwards on Fees and pricing." },
      { verbs: ["edit", "update"], text: "Open the service and save the change. Change the fee on Fees and pricing." },
      { verbs: ["delete", "retire", "close"], text: "Retire the service to stop new bookings. Appointments already booked stay." },
    ],
    prompts: ["What is a consultation service?", "How is a service different from a doctor offering?"],
  },
  {
    id: "offerings",
    title: "Doctor offerings",
    href: "/admin/offerings",
    group: "Healthcare configuration",
    aliases: ["doctor offering", "doctor offerings", "assign service", "offering", "offerings"],
    keywords: ["offering", "offerings", "assign"],
    summary: "A doctor offering assigns one consultation service to one approved doctor. The price is the service fee set on Fees and pricing.",
    canDo: ["Search offerings by doctor, specialty, service, or status.", "Assign a service to an approved doctor.", "Assign a service to your own account so patients can book you.", "Choose online or in person.", "Edit or remove an offering.", "See the fee from Fees and pricing."],
    how: ["The doctor must already be approved, unless you are assigning the service to your own account.", "Assigning a service to yourself opens your account for booking and verifies the specialty you choose.", "The service must exist.", "Patients book the offering, not the bare service.", "Publish weekly hours on Availability before a patient can choose a time.", "The fee patients see is the one saved for that service on Fees and pricing."],
    limits: ["Removing an offering stops new bookings of that pair. Appointments already booked stay."],
    actions: [
      { verbs: ["add", "create", "assign", "new"], text: "Choose Assign service, pick the doctor, select one or more services, and choose Online, In person, or Online or in person. The fee comes from Fees and pricing." },
      { verbs: ["myself", "to me", "my account"], text: "Choose Assign service. In the Doctor list, choose Super administrator (you) or your own name. Enter the name patients should see if this account is not already a doctor, choose the specialty and service, set the fee, then save. Publish weekly hours on Availability so patients can choose a time." },
      { verbs: ["edit", "update", "price", "fee"], text: "Change the amount on Fees and pricing. That amount is used for every doctor who offers the service. Booked appointments keep their stored fee." },
      { verbs: ["delete", "remove"], text: "Delete removes that doctor’s service even when appointments already use it. Those appointments stay, including the fee stored when they were booked." },
    ],
    prompts: ["How do I assign a service to a doctor?", "Why can't I assign a service?"],
  },
  {
    id: "pricing",
    title: "Fees and pricing",
    href: "/admin/pricing",
    group: "Healthcare configuration",
    aliases: ["fees and pricing", "fee schedule", "default fee", "doctor fee", "doctor price"],
    keywords: ["fee", "fees", "price", "prices", "pricing", "cost", "costs", "amount", "currency"],
    summary: "Fees and pricing is the only place to set a consultation fee. Each service has one amount, and every doctor who offers that service uses it.",
    canDo: ["Search the schedule.", "Change a service's fee and currency.", "See that amount on consultation services, doctor offerings, and patient booking."],
    how: ["Type the amount and currency on the service row and save that row.", "Saving the fee updates the price shown for that service everywhere a new booking can see it.", "Changing a fee does not rewrite appointments already booked. Those visits keep the fee stored at booking."],
    limits: ["This page does not take payment and does not mark a payment successful."],
    actions: [
      { verbs: ["change", "edit", "update", "save", "set"], text: "Edit the amount or currency on the service row, then press Save. Existing bookings keep their old fee." },
    ],
    prompts: ["How do I change a fee?", "Does a new fee change old appointments?"],
  },
  {
    id: "locations",
    title: "Locations",
    href: "/admin/locations",
    group: "Healthcare configuration",
    aliases: ["location", "locations", "clinic", "address", "map", "verify address"],
    keywords: ["location", "locations", "clinic", "address", "map", "city", "town", "country"],
    summary: "Locations are the clinics patients can visit. You enter the place name, city or town, and country. The portal verifies that address and shows it on a map before you can save.",
    canDo: ["Search by name or city.", "Add a location.", "Verify the address and pick the matching place.", "See the map pin.", "Edit phone and visit instructions.", "Deactivate a location that already has visits.", "Delete a location that is not referenced."],
    how: ["Choose New location and enter the name, city or town, and country.", "Press Verify address. If several places match, pick the right one.", "The map pin is stored for you. You do not type latitude, longitude, street lines, or district.", "Save stays unavailable until a place is selected.", "Changing the name, city, or country clears the pin, so verify again.", "An existing location that was saved before the map check shows as not on the map until you verify and save it."],
    limits: ["The map uses OpenStreetMap. The portal sends the place you typed so it can be checked. It does not ask you for coordinates."],
    actions: [
      { verbs: ["add", "create", "new"], text: "Open New location, enter the name, city, and country, verify the address, select the place on the map, then save." },
      { verbs: ["verify", "map", "check", "save", "disabled"], text: "Use Verify address. Pick a match if more than one appears. Save is enabled only after the pin is set. Changing the name, city, or country clears the pin." },
      { verbs: ["edit", "update"], text: "Edit the location. If you change the name, city, or country, verify the address again before saving." },
      { verbs: ["delete", "remove"], text: "Delete is refused when appointments already use the location. Deactivate it instead so it stays on record but is hidden from new visits." },
    ],
    prompts: ["How do I add a clinic on the map?", "Why is save disabled on a location?"],
  },
  {
    id: "screening",
    title: "Screening management",
    href: "/admin/screening",
    group: "Healthcare configuration",
    aliases: ["screening", "questionnaire", "instrument", "phq", "gad", "mental health screen"],
    keywords: ["screening", "screen", "instrument", "instruments", "questionnaire", "activate", "deactivate", "phq", "gad"],
    summary: "Screening management is the registry of questionnaires such as PHQ-9 and GAD-7. Patients can start an instrument only when it is active and the clinical gates are already satisfied.",
    canDo: ["Read the totals for instruments, how many patients can start, completed assessments, and those waiting for clinical review.", "Open an instrument.", "A super administrator can activate a ready instrument or deactivate an active one.", "Any administrator can save the support contact shown when a screen raises a safety flag."],
    how: ["Activate is shown only to a super administrator, and only when the instrument is not retired.", "Activation still requires clinical approval, licensing clearance, a question set, and a scoring specification.", "If the instrument needs a safety protocol, support contacts must already be saved. Activating records that the safety protocol is approved.", "Deactivate makes it inactive. Patients cannot start it. Approvals and the safety protocol stay in place.", "A retired instrument cannot be toggled.", "Pending clinical review counts submitted assessments that have no review yet. It is not the count of unapproved instruments."],
    limits: ["A screening score is not a diagnosis. This chat cannot complete a patient's questionnaire or read the answers."],
    actions: [
      { verbs: ["activate", "enable", "turn"], text: "A super administrator opens Screening management and presses Activate beside View. Clinical approval, licensing clearance, questions, and scoring must already be stored. If any of those, or the support contacts, are missing, the portal refuses and leaves the instrument inactive." },
      { verbs: ["deactivate", "disable"], text: "When an instrument is active, the button changes to Deactivate. That stops new patient starts and keeps the clinical approvals." },
      { verbs: ["contact", "support", "phone"], text: "Save the support contact on Screening management. That name and phone are what a patient sees if a screen raises a safety flag." },
    ],
    prompts: ["How do I activate a screening instrument?", "Why is a questionnaire still inactive?"],
  },
  {
    id: "appointments",
    title: "Appointments",
    href: "/admin/appointments",
    group: "Operations",
    aliases: ["appointment", "appointments", "booking", "bookings", "visit"],
    keywords: ["appointment", "appointments", "booking", "bookings", "visit", "visits", "cancel", "slot"],
    summary: "Appointments lists booked visits. Filter by patient, status, online or in person, and date. You can open a visit and cancel it. Patients create the booking.",
    canDo: ["Search appointments.", "Filter pending payment holds and expired unpaid bookings.", "Open a visit.", "Cancel a booking.", "Jump here from the dashboard's today card."],
    how: ["A doctor cannot have two occupying appointments in the same time range. Occupying statuses are pending payment, confirmed, checked in, and in progress. The database enforces that rule.", "A new booking can sit in a payment hold. The hold length is set under Platform settings, from 5 to 120 minutes, and defaults to 15.", "When the hold expires unpaid, the slot is released. Operational issues can process those expired holds.", "Cancelling writes the appointment change. It does not send a refund. Patients pay an approved visit by Orange Money transfer to the number saved under Platform settings."],
    limits: ["This page does not create a booking for a patient and does not mark a payment successful."],
    actions: [
      { verbs: ["cancel"], text: "Open the appointment and cancel it. The stored visit is updated. A refund is not sent because no payment provider is connected." },
      { verbs: ["find", "search", "filter"], text: "Use the filters for status, visit mode, and date, or the header search while you are on this tab." },
    ],
    prompts: ["How do appointments get booked?", "How do I cancel a visit?"],
  },
  {
    id: "payments",
    title: "Payments",
    href: "/admin/payments",
    group: "Operations",
    aliases: ["payment", "payments", "payer"],
    keywords: ["payment", "payments", "paid", "payer", "refund"],
    summary: "Payments lists Orange Money and Afrimoney transfers patients have reported. Open a transfer and confirm it only after the amount is on the matching clinic number.",
    canDo: ["Search by patient, payer, reference, or appointment.", "Filter by status and date.", "Open a reported transfer and confirm or reject it."],
    how: ["Patients dial the clinic number from their own phones, then upload a screenshot of the Orange Money or Afrimoney receipt. They do not type a transaction ID. The PIN is never entered in CareCircle.", "The clinic number is saved under Platform settings.", "Open the payment, look at the screenshot, and confirm it after you see the money. Reject it if it did not arrive. This page does not send a refund."],
    limits: ["You confirm from the screenshot and the clinic wallet. A transaction ID is not required.", "You cannot type a patient's PIN or send a refund from the portal."],
    actions: [
      { verbs: ["refund", "capture", "mark"], text: "Open the payment. Confirm it when the Orange Money transfer has arrived, or reject it if it has not. A refund is not sent." },
    ],
    prompts: ["Can I mark a payment successful?", "Where do I see payment problems?"],
  },
  {
    id: "reconciliation",
    title: "Payment reconciliation",
    href: "/admin/reconciliation",
    group: "Operations",
    aliases: ["payment reconciliation", "reconciliation", "reconcile", "mismatch"],
    keywords: ["reconciliation", "reconcile", "mismatch", "mismatches", "exception"],
    summary: "Payment reconciliation groups payment exceptions. It shows money recorded after a hold was released, payments without a confirmed visit, failed or waiting payments, and pending rows with no provider reference.",
    canDo: ["Read each exception group.", "Open the payment from a row.", "See recent provider events that disagree with the payment they belong to."],
    how: ["A payment received after an expired hold stays flagged and does not confirm the appointment, because the slot was already released.", "Event payloads are not shown.", "The page does not change a payment to paid."],
    limits: ["Refunds and provider capture stay unavailable until a payment provider is integrated."],
    actions: [],
    prompts: ["What does payment reconciliation show?", "Why was a late payment not confirmed?"],
  },
  {
    id: "operations",
    title: "Operational issues",
    href: "/admin/operations",
    group: "Operations",
    aliases: ["operational issues", "operations", "expired hold", "overdue hold"],
    keywords: ["operations", "issue", "issues", "overdue", "hold", "holds", "exception", "exceptions"],
    summary: "Operational issues collects exceptions from appointments, payments, invitations, notifications, and doctor verification. There is no separate issue log.",
    canDo: ["Review expired unpaid holds and process them.", "See late payments.", "See failed notification deliveries.", "See failed doctor invitations.", "See doctors still waiting for verification."],
    how: ["Processing expired holds runs the existing expiry routine and writes an appointment event.", "Each row links to the appointment, payment, invitation, or doctor it came from.", "An empty page means no exceptions are recorded."],
    limits: ["Processing holds releases unpaid bookings. It does not take payment."],
    actions: [
      { verbs: ["process", "expire", "release"], text: "On Operational issues, review the expired unpaid holds and process them. That releases the slot and writes an appointment event." },
    ],
    prompts: ["What are operational issues?", "How do I clear an expired payment hold?"],
  },
  {
    id: "support",
    title: "Account support",
    href: "/admin/support",
    group: "Operations",
    aliases: ["account support", "support request", "support requests", "support ticket"],
    keywords: ["request", "requests", "ticket", "tickets", "locked", "screenshot"],
    summary: "Account support lists requests people send from the public homepage. Each request has an email, an issue category, a description, and an optional screenshot.",
    canDo: ["Read a request.", "Open the screenshot when one was attached.", "Mark an open request reviewed."],
    how: ["People submit the form on the homepage Account support section, or on the account support page.", "Open requests are listed before reviewed ones.", "Mark reviewed records that an administrator has read the request. It does not email the person."],
    limits: ["The form does not reset a password or unlock an account by itself."],
    actions: [
      { verbs: ["read", "review", "open"], text: "On Account support, open the request, read the description, and mark it reviewed when you have seen it." },
    ],
    prompts: ["Where do account support requests go?", "How do I review a support request?"],
  },
  {
    id: "notifications",
    title: "Notifications",
    href: "/admin/notifications",
    group: "Platform management",
    aliases: ["notification", "notifications", "inbox", "delivery log", "delivery"],
    keywords: ["notification", "notifications", "inbox", "email", "sms", "unread", "retry"],
    summary: "Notifications has two parts. The inbox is your own in-app notices. The delivery log is every clinic message, with channel, status, attempts, and errors.",
    canDo: ["Read your notices.", "Mark one notice read, mark all read, or clear your inbox.", "Read the delivery log page by page.", "Retry a failed email when the portal still allows another attempt.", "See whether email is on and how many deliveries failed."],
    how: ["In-app notices stay in the inbox. Email is sent only when Gmail SMTP is configured. A sent status means Gmail accepted the message, not that the mailbox confirmed it.", "Text messages are not sent.", "Previews leave out clinical note text.", "Retry is offered for a failed email that the provider refused and that has attempts left.", "The bell in the header shows your unread in-app notices and opens this page."],
    limits: ["Clearing the inbox does not delete the clinic delivery log."],
    actions: [
      { verbs: ["read", "clear"], text: "Use Read on an unread notice, Mark all read for the inbox, or Clear to remove your own notices." },
      { verbs: ["retry", "resend"], text: "In the delivery log, Retry appears on a failed email that can be attempted again. Other rows are already finished." },
    ],
    prompts: ["What is the difference between the inbox and the delivery log?", "When can I retry an email?"],
  },
  {
    id: "settings",
    title: "Platform settings",
    href: "/admin/settings",
    group: "Platform management",
    aliases: ["platform settings", "settings", "system name", "payment hold", "currency setting"],
    keywords: ["settings", "setting", "name", "currency", "hold", "smtp", "timezone"],
    summary: "Platform settings changes the system name, the public contact details, the default currency for new prices, the Orange Money and Afrimoney numbers that receive visit payments, and the payment-hold minutes.",
    canDo: ["Rename the system. The name appears in the header.", "Save the public email, phone, and address shown on the homepage.", "Set the default currency for new catalog prices.", "Save the Orange Money number patients pay.", "Save the Afrimoney number patients pay with *161*1*1*number*amount*PIN#.", "Set the payment hold between 5 and 120 minutes.", "Read whether email delivery is configured.", "Open Catalog status for active specialties, services, and locations."],
    how: ["New accounts default to Africa/Freetown. Changing nothing here rewrites a doctor's availability timezone.", "Booked appointments keep the fee they were given when the currency default changes.", "Email is configured with SMTP variables outside this page. Secrets are not listed.", "Minor registration, minor treatment, and the doctor identity-document requirement are locked. This page shows them and does not change them.", "A doctor cannot have two occupying appointments at once. That rule is in the database, not a setting."],
    limits: ["Environment secrets, SMTP passwords, and payment-provider keys are not edited here."],
    actions: [
      { verbs: ["rename", "name"], text: "Save the system name on Platform settings. It replaces the name in the administration header." },
      { verbs: ["currency"], text: "Save the default currency. It applies to new catalog prices. Booked appointments keep their stored fee." },
      { verbs: ["hold"], text: "Save a payment hold from 5 to 120 minutes. Until a value is stored, new bookings use 15 minutes." },
    ],
    prompts: ["How do I rename the system?", "What settings are locked?"],
  },
  {
    id: "configuration",
    title: "Catalog status",
    href: "/admin/configuration",
    group: "Platform management",
    aliases: ["catalog status", "catalog"],
    keywords: ["catalog", "configuration"],
    summary: "Catalog status shows which specialties, services, and locations are active. It is linked from Platform settings. Day-to-day edits happen on those three tabs, not here.",
    canDo: ["Review what is active in the catalog.", "Jump back to Specialties, Consultation services, or Locations to change a row."],
    how: ["Active means available for new use.", "Inactive or retired catalog rows stay stored so old appointments still make sense."],
    limits: ["This is a status view. Create and edit records on the matching sidebar tab."],
    actions: [],
    prompts: ["Where do I see which services are active?"],
  },
  {
    id: "audit",
    title: "Audit logs",
    href: "/admin/audit",
    group: "Platform management",
    aliases: ["audit log", "audit logs", "audit"],
    keywords: ["audit", "history", "actor"],
    summary: "Audit logs lists administrative and clinical access events. You can search by action, record, or actor, and filter by date. Rows cannot be edited or deleted.",
    canDo: ["Search the log.", "Filter by a date range.", "Open the related record when the event points at one."],
    how: ["Note text, passwords, tokens, and file bytes are omitted.", "The database also rejects updates and deletes on audit logs, access logs, note versions, and summary release history.", "Saving a fee, activating a screen, or granting a role writes an audit row."],
    limits: ["You cannot erase or correct an audit row from the portal."],
    actions: [],
    prompts: ["Can I delete an audit log?", "What gets written to the audit log?"],
  },
  {
    id: "reports",
    title: "Reports and analytics",
    href: "/admin/reports",
    group: "Platform management",
    aliases: ["reports and analytics", "reports", "analytics", "report"],
    keywords: ["report", "reports", "analytics", "range", "totals"],
    summary: "Reports counts records created between two Africa/Freetown dates: new users, new patients, appointments, doctors approved, and payments by status.",
    canDo: ["Choose a from and to date.", "Read the totals and the status bars.", "See payment amounts and how many of those payments are refunded or partly refunded."],
    how: ["The range is limited to 366 days.", "Dates use Africa/Freetown.", "An empty range means nothing was created then, not that older records disappeared.", "The dashboard is the live snapshot. This tab is the date range."],
    limits: ["Reports do not export a file and do not include clinical note text."],
    actions: [],
    prompts: ["How do reports choose dates?", "How is this different from the dashboard?"],
  },
  {
    id: "profile",
    title: "Your photo",
    href: "/admin/profile",
    group: "Account",
    aliases: ["your photo", "profile photo", "my photo", "avatar"],
    keywords: ["photo", "picture", "avatar", "profile"],
    summary: "Your photo is in the account menu beside your email. It is the picture shown on the administration header.",
    canDo: ["Open Your photo from the account menu.", "Replace the picture stored for your administrator account."],
    how: ["The account menu also opens Notifications, Platform settings, and Sign out."],
    limits: ["Changing your photo does not change a doctor's or patient's picture."],
    actions: [],
    prompts: ["Where do I change my photo?"],
  },
  {
    id: "invitations",
    title: "Doctor invitations",
    href: "/admin/doctors/invitations",
    group: "People and access",
    aliases: ["doctor invitation", "doctor invitations", "invitation"],
    keywords: ["invitation", "invitations", "invite", "resend", "revoke"],
    summary: "Doctor invitations tracks invites already sent. You can resend or revoke one. Failed invitations also appear under Operational issues.",
    canDo: ["Resend an invitation.", "Revoke an invitation."],
    how: ["Email is sent only when SMTP is configured. If email is off, the invitation stays unsent until it is.", "A sent email means Gmail accepted it."],
    limits: ["Revoking an invitation does not delete a doctor who has already registered."],
    actions: [
      { verbs: ["resend"], text: "Open Doctor invitations and resend. The email goes out only when SMTP is configured." },
      { verbs: ["revoke", "cancel"], text: "Revoke the invitation so it can no longer be used." },
    ],
    prompts: ["How do I resend a doctor invitation?"],
  },
  {
    id: "booking",
    title: "How a visit is booked",
    href: "/admin/appointments",
    group: "Operations",
    aliases: ["how booking works", "how a visit is booked", "patient booking", "book a visit", "before a patient can book"],
    keywords: ["book", "books", "booking", "journey"],
    summary: "A patient books a visit only after the catalog is ready: a specialty, a consultation service, an approved doctor, an offering, a fee, and a location when the visit is in person.",
    canDo: ["Prepare the catalog in Healthcare configuration.", "Approve the doctor.", "Watch the booking under Appointments.", "Review the payment record. You cannot capture it."],
    how: ["Create the specialty and the consultation service.", "Approve the doctor on Doctor verification.", "Assign the service on Doctor offerings and set the fee.", "Add a verified clinic on Locations for in-person visits.", "The patient books. The visit holds a payment window, then becomes confirmed or expires unpaid.", "Screening is separate. A patient can start only an active, cleared instrument."],
    limits: ["Administrators do not book the visit on behalf of the patient from the appointments list."],
    actions: [],
    prompts: ["What has to exist before a patient can book?", "Where do I set the payment hold?"],
  },
];

const GROUPS = ["Overview", "People and access", "Healthcare configuration", "Operations", "Platform management", "Account"];

learnPortalFeatures([
  ...TOPICS.flatMap((topic) =>
    [topic.title, topic.summary, ...topic.aliases, ...topic.keywords, ...topic.prompts, ...topic.canDo, ...topic.how, ...topic.actions.flatMap((action) => [action.verbs.join(" "), action.text])].map(
      (text) => ({ featureId: topic.id, text }),
    ),
  ),
  ...GUIDE_EXAMPLES.map((example) => ({ featureId: example.id, text: example.text })),
]);
addGuideFeatures(GUIDE_FEATURES);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["a", "an", "the", "to", "of", "and", "or", "for", "in", "on", "is", "are", "was", "be", "do", "does", "did", "can", "i", "you", "me", "my", "we", "our", "what", "how", "where", "when", "why", "who", "please", "tell", "about", "with", "from", "this", "that", "it", "its", "page", "tab", "screen", "portal", "admin"]);

function tokens(value: string) {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP.has(word));
}

export function topicForPath(pathname: string) {
  const ordered = [...TOPICS].sort((a, b) => b.href.length - a.href.length);
  return ordered.find((topic) => (topic.exact ? pathname === topic.href : pathname === topic.href || pathname.startsWith(`${topic.href}/`))) ?? TOPICS[0];
}

function fold(word: string) {
  return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
}

function phraseIn(question: string, alias: string) {
  const haystack = ` ${normalize(question)} `;
  const phrase = normalize(alias);
  if (haystack.includes(` ${phrase} `)) return true;
  if (!phrase.includes(" ")) return false;
  const folded = ` ${phrase.split(" ").map(fold).join(" ")} `;
  const questionFolded = ` ${normalize(question).split(" ").map(fold).join(" ")} `;
  return questionFolded.includes(folded);
}

function scoreTopic(question: string, topic: GuideTopic) {
  let score = 0;
  for (const alias of topic.aliases) {
    if (phraseIn(question, alias)) score += alias.includes(" ") ? 10 : 6;
  }
  const words = new Set(tokens(question).map(fold));
  const seen = new Set<string>();
  for (const keyword of topic.keywords) {
    const folded = fold(keyword);
    if (words.has(folded) && !seen.has(folded)) {
      seen.add(folded);
      score += 3;
    }
  }
  return score;
}

function linkFor(topic: GuideTopic): GuideLink {
  return { href: topic.href, label: topic.title };
}

function promptsFor(topic: GuideTopic, extras: string[] = []) {
  return [...topic.prompts, ...extras].slice(0, 3);
}

function overview(setup: boolean): GuideReply {
  return {
    topicId: "booking",
    title: setup ? "Set the clinic up in this order" : "How the portal fits together",
    paragraphs: [
      setup
        ? "Start with the catalog, then the people, then watch live visits. Patients book only after those pieces exist."
        : "CareCircle MindTogether administration is one portal. The sidebar is the whole job: people, the care catalog, live operations, and the platform record.",
    ],
    steps: setup
      ? [
          "Platform settings: save the system name, the default currency, the Orange Money and Afrimoney numbers, and the payment hold.",
          "Specialties, consultation services, and a verified location.",
          "Doctor verification: approve a submitted doctor.",
          "Doctor offerings and Fees and pricing: assign the service and the doctor's fee.",
          "Screening management: save the support contact. A super administrator activates an instrument only when it is already cleared.",
          "Appointments, Payments, and Operational issues: watch bookings. Payments cannot be marked successful from here.",
        ]
      : [
          "People and access: users, patients, doctors, administrator roles, and doctor verification.",
          "Healthcare configuration: specialties, consultation services, doctor offerings, fees, mapped locations, and screening.",
          "Operations: appointments, stored payments, reconciliation exceptions, operational issues, and account support requests.",
          "Platform management: your inbox and the delivery log, settings, audit logs, and date-range reports.",
          "A visit needs an approved doctor, an offering, a fee, and a location when it is in person. Screening is a separate patient questionnaire.",
        ],
    links: [
      { href: "/admin/settings", label: "Platform settings" },
      { href: "/admin/doctors/pending", label: "Doctor verification" },
      { href: "/admin/offerings", label: "Doctor offerings" },
    ],
    prompts: ["What is in the sidebar?", "What has to exist before a patient can book?", "Who can grant an administrator?"],
  };
}

function sidebarReply(): GuideReply {
  return {
    topicId: null,
    title: "Every sidebar tab",
    paragraphs: ["The sidebar is grouped. Open any name below, or ask what that tab lets you do."],
    steps: GROUPS.filter((group) => group !== "Account").map((group) => {
      const names = TOPICS.filter((topic) => topic.group === group && topic.id !== "booking" && topic.id !== "configuration" && topic.id !== "invitations").map((topic) => topic.title);
      return `${group}: ${names.join(", ")}.`;
    }),
    links: TOPICS.filter((topic) => topic.id !== "booking").slice(0, 4).map(linkFor),
    prompts: ["How does the portal fit together?", "What can I do on the page I am on?"],
  };
}

function roleReply(superAdmin: boolean): GuideReply {
  return {
    topicId: "roles",
    title: "Administrator and super administrator",
    paragraphs: [
      superAdmin
        ? "You are signed in as a super administrator. You can grant administrator access and you can activate or deactivate a cleared screening instrument."
        : "You are signed in as an administrator. You can run the portal, but granting administrator roles and changing screening governance are reserved for a super administrator.",
      "Public registration cannot assign either administrator role. Patient and doctor access stays separate.",
    ],
    steps: [
      "Both roles can review people, the catalog, appointments, payments, notifications, settings, audit logs, and reports.",
      "Only a super administrator can grant or remove administrator roles.",
      "Only a super administrator can activate or deactivate a screening instrument, or edit its clinical governance.",
      "Any administrator can save the screening support contact.",
    ],
    links: [
      { href: "/admin/roles", label: "Administrators and roles" },
      { href: "/admin/screening", label: "Screening management" },
    ],
    prompts: ["How do I grant an administrator?", "How do I activate a screening instrument?"],
  };
}

function hereReply(pathname: string, superAdmin: boolean): GuideReply {
  const topic = topicForPath(pathname);
  return fullReply(topic, `What can I do on ${topic.title}?`, superAdmin);
}

function compareReply(question: string): GuideReply | null {
  const ranked = TOPICS.map((topic) => ({ topic, score: scoreTopic(question, topic) }))
    .filter((row) => row.score >= 5)
    .sort((a, b) => b.score - a.score);
  if (ranked.length < 2 || ranked[0].score - ranked[1].score > 4) return null;
  const unique: GuideTopic[] = [];
  for (const row of ranked) {
    if (!unique.some((topic) => topic.id === row.topic.id)) unique.push(row.topic);
    if (unique.length === 2) break;
  }
  if (unique.length < 2) return null;
  const [first, second] = unique;
  return {
    topicId: first.id,
    title: `${first.title} and ${second.title}`,
    paragraphs: [first.summary, second.summary],
    steps: [`Use ${first.title} for its own job, then ${second.title} when the next step is different.`],
    links: [linkFor(first), linkFor(second)],
    prompts: first.prompts.slice(0, 2),
  };
}

function matchingActions(topic: GuideTopic, question: string) {
  const words = new Set(tokens(question));
  return topic.actions.filter((action) => action.verbs.some((verb) => words.has(verb) || normalize(question).includes(verb)));
}

function fullReply(topic: GuideTopic, question: string, superAdmin: boolean): GuideReply {
  const normalized = normalize(question);
  const how = /\b(how|why|explain|work|works|steps)\b/.test(normalized);
  const catalog = /\b(what can|can i|able|allowed|do here)\b/.test(normalized);
  const actions = matchingActions(topic, question);
  const steps = actions.length > 0 ? actions.map((action) => action.text) : how || catalog ? [...(catalog ? topic.canDo : []), ...(how ? topic.how : [])] : topic.canDo.slice(0, 4);
  const roleNote =
    topic.id === "roles" || topic.id === "screening"
      ? superAdmin
        ? "Your super administrator sign-in can perform the restricted actions on this tab."
        : "Your administrator sign-in can review this tab. Granting roles and activating screening stay with a super administrator."
      : null;
  return {
    topicId: topic.id,
    title: topic.title,
    paragraphs: [topic.summary, ...topic.limits, ...(roleNote ? [roleNote] : [])],
    steps,
    links: [linkFor(topic)],
    prompts: promptsFor(topic),
  };
}

export function answerPortalQuestion(input: { question: string; pathname: string; superAdmin: boolean; previousTopicId?: string | null }): GuideReply {
  const question = input.question.trim();
  const normalized = normalize(question);
  if (!normalized) {
    return hereReply(input.pathname, input.superAdmin);
  }
  if (/^(hi|hello|hey|help)\b/.test(normalized) || /\b(what can you|who are you|help me)\b/.test(normalized)) {
    const here = topicForPath(input.pathname);
    return {
      topicId: null,
      title: "Portal guide",
      paragraphs: [`I explain how this administration portal works and what you can do on every sidebar tab. You are on ${here.title}. I do not change records, and I do not open a patient's clinical note.`],
      steps: [],
      links: [linkFor(here)],
      prompts: [`What can I do on ${here.title}?`, "How does the portal fit together?", "What is in the sidebar?"],
    };
  }
  if (/\b(sidebar|side bar|navigation|all tabs|every tab|menu)\b/.test(normalized)) return sidebarReply();
  if (/\b(first|getting started|set up|setup|where do i start|where should i start)\b/.test(normalized) || /\b(how does|how do) (the |this )?(system|portal|platform|everything)\b/.test(normalized) || normalized === "everything") {
    return overview(/\b(first|getting started|set up|setup|start)\b/.test(normalized));
  }
  if (/\b(my role|super administrator|ordinary administrator|who can grant|difference between administrator)\b/.test(normalized)) {
    return roleReply(input.superAdmin);
  }
  if (/\b(this page|this tab|this screen|right now|where am i|what am i looking at|what can i do here)\b/.test(normalized)) {
    return hereReply(input.pathname, input.superAdmin);
  }
  if (/\b(difference|versus| vs |compare|different from)\b/.test(normalized)) {
    const compared = compareReply(question);
    if (compared) return compared;
  }

  const ranked = TOPICS.map((topic) => ({ topic, score: scoreTopic(question, topic) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const previous = TOPICS.find((topic) => topic.id === input.previousTopicId);
  const follow =
    /\b(it|that|this|them|those|same|again|one)\b/.test(normalized) ||
    (previous ? matchingActions(previous, question).length > 0 : false);
  if (previous && follow && (!best || best.score < 6)) {
    return fullReply(previous, question, input.superAdmin);
  }
  const predicted = !best || best.score < 5 ? predictGuideFeature(question) : null;
  const learned = predicted ? learnedGuideFeature(predicted.featureId) : null;
  if (learned) {
    return {
      topicId: learned.id,
      title: learned.title,
      paragraphs: [learned.answer],
      steps: [],
      links: [{ href: learned.href, label: learned.title }],
      prompts: [],
    };
  }
  const learnedTopic = predicted ? TOPICS.find((topic) => topic.id === predicted.featureId) : undefined;
  if (learnedTopic && (!best || best.score < 3 || learnedTopic.id !== best.topic.id)) {
    return fullReply(learnedTopic, question, input.superAdmin);
  }
  if (!best || best.score < 3) {
    const here = topicForPath(input.pathname);
    return {
      topicId: here.id,
      title: "I can explain the portal",
      paragraphs: ["I answer questions about the administration sidebar and how the clinic workflow fits together. I cannot look up a person, change a record, or answer something outside this portal."],
      steps: [`You are on ${here.title}. Ask what you can do there, or name another tab.`],
      links: [linkFor(here)],
      prompts: guidesPrompts(input.pathname),
    };
  }
  if (best.score >= 5 && ranked[1] && ranked[1].score >= 5 && /\b(and|or)\b/.test(normalized) && ranked[0].topic.id !== ranked[1].topic.id) {
    const compared = compareReply(question);
    if (compared) return compared;
  }
  return fullReply(best.topic, question, input.superAdmin);
}

export function guidesPrompts(pathname: string) {
  const topic = topicForPath(pathname);
  return [`What can I do on ${topic.title}?`, ...topic.prompts].slice(0, 3);
}

export function guidePlace(pathname: string) {
  return topicForPath(pathname).title;
}

const PHRASE_FIXES: Array<[RegExp, string]> = [
  [/\bhow may\b/g, "how many"],
  [/\bhow an i\b/g, "how can i"],
  [/\bhow cani\b/g, "how can i"],
  [/\bhow i\b/g, "how do i"],
  [/\bhw\b/g, "how"],
  [/\bwat\b/g, "what"],
  [/\bwhr\b/g, "where"],
  [/\bplz\b/g, "please"],
  [/\bpls\b/g, "please"],
  [/\bdocter\b/g, "doctor"],
  [/\bdocotr\b/g, "doctor"],
  [/\bdcotor\b/g, "doctor"],
  [/\bdoctro\b/g, "doctor"],
  [/\bpaitent\b/g, "patient"],
  [/\bappoinment\b/g, "appointment"],
  [/\blocaton\b/g, "location"],
  [/\bactivat\b/g, "activate"],
  [/\baproove\b/g, "approve"],
  [/\baprrove\b/g, "approve"],
];

const LEXICON = [
  "doctor", "doctors", "patient", "patients", "appointment", "appointments", "location", "locations", "specialty", "specialties",
  "screening", "activate", "deactivate", "approve", "approval", "payment", "payments", "offering", "offerings", "service", "services",
  "notification", "notifications", "administrator", "invitation", "verify", "address", "booking", "currency", "audit", "report", "reports",
  "inbox", "email", "grant", "clinic", "refund", "dashboard", "fee", "fees", "pricing", "reconciliation", "questionnaire", "instrument", "portal", "many", "portal", "many",
];

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = left[i - 1] === right[j - 1] ? previous : Math.min(previous, row[j], row[j - 1]) + 1;
      previous = current;
    }
  }
  return row[right.length];
}

function correctToken(word: string) {
  if (word.length < 5 || LEXICON.includes(word)) return word;
  let best = word;
  let bestDistance = 2;
  for (const known of LEXICON) {
    if (Math.abs(known.length - word.length) > 1) continue;
    const distance = editDistance(word, known);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = known;
    }
  }
  return bestDistance <= 1 ? best : word;
}

export function correctQuestion(value: string) {
  let text = normalize(value);
  for (const [pattern, replacement] of PHRASE_FIXES) text = text.replace(pattern, replacement);
  return text.split(" ").map(correctToken).filter(Boolean).join(" ");
}

export type PortalFacts = {
  doctors: number;
  approvedDoctors: number;
  pendingDoctors: number;
  patients: number;
  patientsThisWeek: number;
  todayAppointments: number;
  todayConfirmed: number;
  todayPending: number;
  activeServices: number;
  locations: number;
};

export type ChatTurn = { topicId: string | null; text: string; link: GuideLink | null; navigate?: boolean };

const NEXT_STEP: Record<string, { text: string; href: string; label: string }> = {
  doctors: { text: "Next, wait for the doctor to open the invitation and submit the profile. Then approve it on Doctor verification.", href: "/admin/doctors/pending", label: "Doctor verification" },
  verification: { text: "Next, assign a consultation service to that approved doctor on Doctor offerings, and set the fee.", href: "/admin/offerings", label: "Doctor offerings" },
  offerings: { text: "Next, check Fees and pricing if this doctor's amount should differ from the service default. Booked visits keep the fee they already stored.", href: "/admin/pricing", label: "Fees and pricing" },
  specialties: { text: "Next, add a consultation service patients can book in that specialty.", href: "/admin/services", label: "Consultation services" },
  services: { text: "Next, assign the service to an approved doctor on Doctor offerings.", href: "/admin/offerings", label: "Doctor offerings" },
  locations: { text: "Next, use this clinic on an in-person doctor offering. Online visits do not need a map pin.", href: "/admin/offerings", label: "Doctor offerings" },
  screening: { text: "Next, leave it active if patients should start it. Deactivate stops new starts and keeps the clinical approvals.", href: "/admin/screening", label: "Screening management" },
  pricing: { text: "Next, remember that changing a fee does not rewrite appointments already booked.", href: "/admin/appointments", label: "Appointments" },
  appointments: { text: "Next, look at Payments if you need the stored payment, or Operational issues if a hold has expired.", href: "/admin/operations", label: "Operational issues" },
  payments: { text: "Next, open Payment reconciliation if a payment looks mismatched. This portal cannot mark one paid.", href: "/admin/reconciliation", label: "Payment reconciliation" },
};

function amount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function statusLine(facts: PortalFacts) {
  const pending = facts.pendingDoctors === 0 ? "none waiting for verification" : `${amount(facts.pendingDoctors, "doctor")} waiting for verification`;
  const week = facts.patientsThisWeek === 0 ? "none new this week" : `${facts.patientsThisWeek} new this week`;
  return `Right now there are ${amount(facts.patients, "patient")} (${week}), ${amount(facts.doctors, "doctor")} (${facts.approvedDoctors} approved, ${pending}), and ${amount(facts.todayAppointments, "appointment")} today.`;
}

export function openingLine(place: string) {
  return `Hello. I can walk you through how this administration portal operates. You are on ${place}. Ask me anything, for example how to add a doctor.`;
}

function asksHowTo(question: string) {
  return /\bhow\b/.test(question) && !/\bhow (many|much)\b/.test(question);
}

function stepLines(parts: string[]) {
  const lines = parts.flatMap((part) =>
    part
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return lines
    .map((line, index) => {
      const marked = markClickTargets(line);
      const body = /[.!?]$/.test(marked) ? marked : `${marked}.`;
      return `${index + 1}. ${body}`;
    })
    .join("\n");
}

function prose(reply: GuideReply, howTo = false) {
  if (reply.title === "Portal guide" || reply.title === "I can explain the portal") {
    return "I can walk you through any admin task, from adding a doctor to fees, locations, screening, and the page you are on. I don't look up a person or change a record from this chat. Ask me the step you want.";
  }
  const steps = reply.steps.filter(Boolean);
  const summary = reply.paragraphs[0] ?? "";
  const caution = reply.paragraphs.find((line) => line !== summary) ?? "";
  if (howTo && steps.length > 0) {
    return [summary, stepLines(steps), caution].filter((line, index, all) => line && all.indexOf(line) === index).join("\n\n");
  }
  const spoken = steps.join(" ");
  if (spoken.length > 140) return caution ? `${spoken}\n\n${caution}` : spoken;
  if (spoken) return [summary, spoken, caution].filter((line, index, all) => line && all.indexOf(line) === index).join("\n\n");
  return [summary, caution].filter(Boolean).join("\n\n");
}

function countReply(question: string, facts: PortalFacts | null): ChatTurn | null {
  if (!/\b(how many|total|count|are there)\b/.test(question)) return null;
  if (!facts) {
    if (/\bpatient/.test(question)) {
      return { topicId: "patients", text: "I could not read the live total just now. Open the dashboard and read Total Patients, or open Patients to see the list.", link: { href: "/admin/patients", label: "Patients" } };
    }
    return { topicId: "dashboard", text: "I could not read the live totals just now. The dashboard shows doctors, patients, today's appointments, active services, and locations.", link: { href: "/admin", label: "Dashboard" } };
  }
  if (/\bpatient/.test(question)) {
    const week = facts.patientsThisWeek === 0 ? "None joined this week." : `${amount(facts.patientsThisWeek, "patient")} joined this week.`;
    return { topicId: "patients", text: `There are ${amount(facts.patients, "patient")}. ${week}`, link: { href: "/admin/patients", label: "Patients" } };
  }
  if (/\bdoctor/.test(question)) {
    const waiting = facts.pendingDoctors === 0 ? "None are waiting for verification." : `${amount(facts.pendingDoctors, "doctor")} still waiting for verification.`;
    return { topicId: "doctors", text: `There are ${amount(facts.doctors, "doctor")}. ${facts.approvedDoctors} approved. ${waiting}`, link: { href: "/admin/doctors", label: "Doctors" } };
  }
  if (/\b(appointment|booking|visit)/.test(question)) {
    return { topicId: "appointments", text: `There are ${amount(facts.todayAppointments, "appointment")} today: ${facts.todayConfirmed} confirmed and ${facts.todayPending} still pending.`, link: { href: "/admin/appointments", label: "Appointments" } };
  }
  if (/\b(service)/.test(question)) {
    return { topicId: "services", text: `There are ${amount(facts.activeServices, "active service")}.`, link: { href: "/admin/services", label: "Consultation services" } };
  }
  if (/\b(location|clinic)/.test(question)) {
    return { topicId: "locations", text: `There are ${amount(facts.locations, "location")}.`, link: { href: "/admin/locations", label: "Locations" } };
  }
  return { topicId: "dashboard", text: statusLine(facts), link: { href: "/admin", label: "Dashboard" } };
}

function attentionReply(question: string, facts: PortalFacts | null): ChatTurn | null {
  if (!/\b(attention|pending|waiting|should i do|what now|anything to do|needs me|stuck)\b/.test(question)) return null;
  if (!facts) {
    return { topicId: "dashboard", text: "I could not read the live queue just now. Open the dashboard for today's appointments and Doctor verification for profiles still waiting.", link: { href: "/admin", label: "Dashboard" } };
  }
  if (facts.pendingDoctors > 0) {
    return { topicId: "verification", text: `Start with Doctor verification. ${amount(facts.pendingDoctors, "doctor")} ${facts.pendingDoctors === 1 ? "is" : "are"} waiting. After approval, assign a consultation on Doctor offerings.`, link: { href: "/admin/doctors/pending", label: "Doctor verification" } };
  }
  if (facts.todayPending > 0) {
    return { topicId: "appointments", text: `No doctors are waiting for verification. ${amount(facts.todayPending, "appointment")} today ${facts.todayPending === 1 ? "is" : "are"} still pending. Open Appointments to review ${facts.todayPending === 1 ? "it" : "them"}.`, link: { href: "/admin/appointments", label: "Appointments" } };
  }
  return { topicId: "dashboard", text: `Nothing is waiting on doctor verification. ${statusLine(facts)}`, link: { href: "/admin", label: "Dashboard" } };
}

function carryOn(question: string) {
  return /^(yes|yeah|yep|ok|okay|sure|more|continue|go on)\b/.test(question) || /\b(what next|and then|next step|tell me more|after that)\b/.test(question);
}

export function chatWithPortal(input: { question: string; pathname: string; superAdmin: boolean; previousTopicId?: string | null; facts?: PortalFacts | null }): ChatTurn {
  const question = correctQuestion(input.question);
  const facts = input.facts ?? null;
  const place = guidePlace(input.pathname);
  if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(question)) {
    const status = facts ? ` ${statusLine(facts)}` : "";
    return { topicId: null, text: `${openingLine(place)}${status}`, link: null };
  }
  if (/^(thanks|thank you|thank u)\b/.test(question)) {
    return { topicId: input.previousTopicId ?? null, text: "You're welcome. Ask for the next step, or name another tab.", link: null };
  }
  if (/^(bye|goodbye|good night)\b/.test(question)) {
    return { topicId: null, text: "Goodbye. Open the chat again whenever you want the next step.", link: null };
  }
  if (carryOn(question) && input.previousTopicId && NEXT_STEP[input.previousTopicId]) {
    const next = NEXT_STEP[input.previousTopicId];
    return { topicId: input.previousTopicId, text: next.text, link: { href: next.href, label: next.label } };
  }
  const counted = countReply(question, facts);
  if (counted) return counted;
  const attention = attentionReply(question, facts);
  if (attention) return attention;
  const reply = answerPortalQuestion({ ...input, question });
  if (/^(please )?(take me|go|open|show me|bring me)\b/.test(question) && !/\bhow\b/.test(question) && reply.links[0]) {
    return { topicId: reply.topicId, text: `Click to go to ${reply.links[0].label}.`, link: reply.links[0] };
  }
  const next = reply.topicId ? NEXT_STEP[reply.topicId] : undefined;
  const howTo = asksHowTo(question);
  const procedural = howTo || /\b(add|create|approve|activate|verify)\b/.test(question);
  const body = prose(reply, howTo);
  const text = next && procedural && !body.includes(next.label) ? `${body}\n\n${next.text}` : body;
  return { topicId: reply.topicId, text, link: reply.links[0] ?? (next ? { href: next.href, label: next.label } : null) };
}
