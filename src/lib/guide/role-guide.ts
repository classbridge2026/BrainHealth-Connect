import { learnPortalFeatures, predictGuideFeature } from "@/lib/admin/guide-model";
import { markClickTargets } from "@/lib/guide/click-targets";

export type RoleLink = { href: string; label: string };
export type RoleTurn = { topicId: string | null; text: string; link: RoleLink | null; navigate?: boolean };

export type PatientGuideFacts = { upcoming: number; followUps: number; pendingPayments: number };
export type DoctorGuideFacts = {
  ready: boolean;
  today: number;
  pendingToday: number;
  activePatients: number;
  pendingNotes: number;
  followUps: number;
};

type Topic = {
  id: string;
  title: string;
  href: string;
  exact?: boolean;
  aliases: string[];
  keywords: string[];
  summary: string;
  how: string;
  limits: string;
};

const PATIENT_TOPICS: Topic[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    href: "/patient",
    exact: true,
    aliases: ["dashboard", "home"],
    keywords: ["welcome", "overview"],
    summary: "Your dashboard shows your upcoming appointments, follow-ups that are due, and your recent payments.",
    how: "Each card opens that part of your own record. It does not show another person's care.",
    limits: "You cannot change a doctor's schedule or an administrator setting from here.",
  },
  {
    id: "find",
    title: "Find a Doctor",
    href: "/patient/find",
    aliases: ["find a doctor", "book a doctor", "book an appointment", "book appointment"],
    keywords: ["find", "book", "booking", "verified", "clinician"],
    summary: "Find a Doctor lists only approved, active doctors. Search by name, open a doctor, then book an online or in-person consultation.",
    how: "Click Find a Doctor. Click Book appointment on the doctor you want. Search by concern, specialty, or doctor. Choose video, audio, or in person before the times appear. For an in-person visit, choose a clinic before the times appear. Pick an open time, write what is wrong, and confirm. The visit keeps a payment window. Pay the self-pay fee with Orange Money or Afrimoney before the hold ends, or the time is released.",
    limits: "You book only for this patient account. A doctor who is not approved does not appear.",
  },
  {
    id: "appointments",
    title: "Appointments",
    href: "/patient/appointments",
    aliases: ["my appointments", "appointment", "cancel appointment", "reschedule"],
    keywords: ["appointment", "appointments", "cancel", "reschedule", "visit"],
    summary: "Appointments lists your upcoming, past, and cancelled visits.",
    how: "Open a visit to read it. You can cancel your own visit while it is waiting for payment, waiting for approval, or confirmed. A completed visit cannot be cancelled. Reschedule is offered only when the visit still allows it, and you pick another open time.",
    limits: "You cannot cancel someone else's visit, and you cannot mark the visit complete. The doctor does that.",
  },
  {
    id: "screening",
    title: "Screening Centre",
    href: "/patient/screening",
    aliases: ["screening", "questionnaire", "screening centre", "screening result"],
    keywords: ["screening", "questionnaire", "phq", "gad", "instrument"],
    summary: "Screening Centre lists mental health questionnaires. Start screening only when that card says Start screening. View status means it is not open for you.",
    how: "Answer the questions and submit. Your history is under Screening history. A result is not a diagnosis. If a screen raises a safety flag, the support contact saved by the clinic is what you are shown.",
    limits: "You cannot turn a questionnaire on for the clinic. A super administrator does that, and only after it is already cleared.",
  },
  {
    id: "payments",
    title: "Payments",
    href: "/patient/payments",
    aliases: ["payments", "payment history"],
    keywords: ["payment", "payments", "paid", "pending"],
    summary: "Payments and History shows the charges stored for your visits, including what is paid and what is still pending.",
    how: "Open the appointment and pay with Orange Money or Afrimoney while the payment window is open. This page is the history. Filter it by status.",
    limits: "You cannot mark a payment successful, captured, or refunded.",
  },
  {
    id: "summaries",
    title: "Clinical Summaries",
    href: "/patient/summaries",
    aliases: ["clinical summaries", "summary", "summaries"],
    keywords: ["summary", "summaries", "note", "notes"],
    summary: "Clinical Summaries shows the summaries your doctor has released to you.",
    how: "Open a released summary to read it. A summary appears here only after the doctor releases it.",
    limits: "The doctor's private working notes are not shown here, and this chat does not open the text of a summary.",
  },
  {
    id: "followups",
    title: "Follow-ups",
    href: "/patient/follow-ups",
    aliases: ["follow-ups", "follow up", "follow ups"],
    keywords: ["follow", "followup"],
    summary: "Follow-ups lists return visits that are due, overdue, or coming up for you.",
    how: "Open the visit when you are ready to attend or to book the recommended return.",
    limits: "You see only follow-ups on your record.",
  },
  {
    id: "notifications",
    title: "Notifications",
    href: "/patient/notifications",
    aliases: ["notifications", "inbox"],
    keywords: ["notification", "notifications", "inbox", "unread"],
    summary: "Notifications is your own inbox.",
    how: "Open a notice to read it. The bell in the header shows how many are unread.",
    limits: "You do not see the clinic's delivery log or another person's notices.",
  },
  {
    id: "profile",
    title: "Profile",
    href: "/patient/profile",
    aliases: ["profile", "my account", "password"],
    keywords: ["profile", "photo", "password", "account"],
    summary: "Profile is your name, photo, and account details.",
    how: "Update the details the page offers and save. Reset password is in the account menu.",
    limits: "This does not change your role. Public registration cannot make you an administrator or a doctor.",
  },
];

const DOCTOR_TOPICS: Topic[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    href: "/doctor",
    exact: true,
    aliases: ["dashboard", "home"],
    keywords: ["today", "overview", "schedule"],
    summary: "Your dashboard counts today's appointments, upcoming follow-ups, patients who have a visit with you, and notes still waiting.",
    how: "Today's schedule is on this page. View all opens your appointment list.",
    limits: "If your profile is not approved, clinical records stay closed until an administrator approves you.",
  },
  {
    id: "appointments",
    title: "Appointments",
    href: "/doctor/appointments",
    aliases: ["appointments", "consultation", "check in", "start a consultation"],
    keywords: ["appointment", "appointments", "check", "consultation", "noshow", "complete"],
    summary: "Appointments are the visits assigned to you.",
    how: "Click the booking, then click Approve or Decline. After you approve, click Open consultation. When the visit is finished, click End consultation. The system marks the visit complete. Cancel asks you to confirm before it is saved, and you can reschedule when the visit allows it.",
    limits: "You cannot change a visit assigned to another doctor. An unapproved profile cannot take these actions.",
  },
  {
    id: "patients",
    title: "Patients",
    href: "/doctor/patients",
    aliases: ["my patients", "patients", "who can i see"],
    keywords: ["patient", "patients"],
    summary: "Patients lists people who have a visit with you.",
    how: "Open a patient to read the record this portal shares for your visits together.",
    limits: "This is not the hospital register. You cannot open a person who has never had a visit with you, and you cannot create a patient account the way an administrator can.",
  },
  {
    id: "screening",
    title: "Screening Assessments",
    href: "/doctor/screening",
    aliases: ["screening assessments", "screening review"],
    keywords: ["screening", "assessment", "questionnaire", "review"],
    summary: "Screening Assessments are questionnaires submitted by patients linked to your care. You can review one and amend a review you already saved.",
    how: "Open the assessment, read it, and save your review.",
    limits: "You cannot activate or deactivate a questionnaire for the whole clinic. That is a super administrator action. A score is not a diagnosis.",
  },
  {
    id: "availability",
    title: "Availability",
    href: "/doctor/availability",
    aliases: ["availability", "working hours", "time off", "set my hours"],
    keywords: ["availability", "hours", "schedule", "timeoff"],
    summary: "Availability is your weekly hours and time off. Patients can book only the open times that remain.",
    how: "Save a weekly rule, turn a rule off, or add time off for a range. Removing time off puts those hours back if the weekly rule is still active.",
    limits: "You edit only your own hours. You do not set another doctor's calendar or the clinic fee.",
  },
  {
    id: "notes",
    title: "Notes and Summaries",
    href: "/doctor/notes",
    aliases: ["notes", "clinical notes", "patient summary", "release summary"],
    keywords: ["note", "notes", "summary", "release"],
    summary: "Notes and Summaries holds your clinical writing. A working note stays with you. A patient summary is shared only after you release it.",
    how: "Open the visit record, write the note, and save. To share it, preview the patient summary and confirm the release. The patient can read it after that. You can withdraw a released summary when the page offers it.",
    limits: "Do not release a summary you have not previewed. This chat does not read or write the note for you.",
  },
  {
    id: "followups",
    title: "Follow-ups",
    href: "/doctor/follow-ups",
    aliases: ["follow-ups", "follow up"],
    keywords: ["follow", "followup"],
    summary: "Follow-ups are return visits for your patients.",
    how: "Schedule a follow-up from a visit when you recommend the patient come back.",
    limits: "You schedule follow-ups only for patients already in your care.",
  },
  {
    id: "notifications",
    title: "Notifications",
    href: "/doctor/notifications",
    aliases: ["notifications", "inbox"],
    keywords: ["notification", "notifications", "inbox"],
    summary: "Notifications is your own inbox.",
    how: "Mark a notice read, or clear the notices the page allows.",
    limits: "You do not see the clinic delivery log.",
  },
  {
    id: "profile",
    title: "Profile",
    href: "/doctor/profile",
    aliases: ["profile", "professional profile", "onboarding", "credentials"],
    keywords: ["profile", "credential", "credentials", "onboarding", "verification"],
    summary: "Profile and Professional profile are where you keep your photo, biography, credentials, and the profile you submit for review.",
    how: "Finish the professional profile and submit it. Upload a credential from that page. Patients cannot book you until an administrator approves the profile and a consultation is assigned.",
    limits: "You cannot approve yourself, and you cannot grant yourself administrator access.",
  },
];

const PATIENT_BLOCK =
  /\b(grant( an| the)? administrator|super administrator|administrator role|fee schedule|platform settings|audit log|delivery log|activate (an |the )?(instrument|questionnaire)|create (a )?doctor account|approve (a |the )?doctor|all patients|every patient)\b/;
const DOCTOR_BLOCK =
  /\b(grant( an| the)? administrator|super administrator|administrator role|fee schedule|platform settings|audit log|delivery log|activate (an |the )?(instrument|questionnaire)|create (a )?doctor account|approve myself|approve my profile|all patients in the (hospital|clinic|system)|every patient in the (hospital|clinic|system))\b/;

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((word) => word.length > 1);
}

function phraseIn(question: string, alias: string) {
  return ` ${normalize(question)} `.includes(` ${normalize(alias)} `);
}

function scoreTopic(question: string, topic: Topic) {
  let score = 0;
  for (const alias of topic.aliases) {
    if (phraseIn(question, alias)) score += alias.includes(" ") ? 10 : 6;
  }
  const words = new Set(tokens(question));
  for (const keyword of topic.keywords) {
    if (words.has(keyword)) score += 3;
  }
  return score;
}

function topicForPath(topics: Topic[], pathname: string) {
  const ordered = [...topics].sort((a, b) => b.href.length - a.href.length);
  return ordered.find((topic) => (topic.exact ? pathname === topic.href : pathname === topic.href || pathname.startsWith(`${topic.href}/`))) ?? topics[0];
}

function amount(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function asksHowTo(question: string) {
  return /\bhow\b/.test(question) && !/\bhow (many|much)\b/.test(question);
}

function stepLines(text: string) {
  const lines = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line, index) => {
      const marked = markClickTargets(line);
      const body = /[.!?]$/.test(marked) ? marked : `${marked}.`;
      return `${index + 1}. ${body}`;
    })
    .join("\n");
}

function train(audience: "patient" | "doctor", topics: Topic[]) {
  learnPortalFeatures(
    topics.flatMap((topic) => [topic.title, topic.summary, topic.how, ...topic.aliases, ...topic.keywords].map((text) => ({ featureId: topic.id, text }))),
    audience,
  );
}

train("patient", PATIENT_TOPICS);
train("doctor", DOCTOR_TOPICS);

function privilege(audience: "patient" | "doctor", question: string): RoleTurn | null {
  const blocked = audience === "patient" ? PATIENT_BLOCK.test(question) : DOCTOR_BLOCK.test(question);
  if (!blocked) return null;
  if (audience === "patient") {
    return {
      topicId: null,
      text: "That is an administrator task, so this patient sign-in cannot do it. You can find a verified doctor, book and cancel your own visits, start a screening that is already open, and read your own payments and released summaries.",
      link: { href: "/patient", label: "Dashboard" },
    };
  }
  return {
    topicId: null,
    text: "That stays with an administrator. Your clinician sign-in covers your own hours, the visits assigned to you, the patients who have a visit with you, and the notes you write for those visits. You cannot approve your own profile or open another doctor's records.",
    link: { href: "/doctor/profile", label: "Profile" },
  };
}

function patientCounts(question: string, facts: PatientGuideFacts | null): RoleTurn | null {
  if (!/\b(how many|total|count)\b/.test(question)) return null;
  if (/\bpatient/.test(question) && !/\bappointment/.test(question)) {
    return { topicId: "profile", text: "This sign-in is your own patient record. It does not count other patients.", link: { href: "/patient/profile", label: "Profile" } };
  }
  if (!facts) return { topicId: "dashboard", text: "I could not read your totals just now. Open your dashboard to see your appointments, follow-ups, and payments.", link: { href: "/patient", label: "Dashboard" } };
  if (/\b(appointment|booking|visit)/.test(question)) {
    return { topicId: "appointments", text: `You have ${amount(facts.upcoming, "upcoming appointment")}.`, link: { href: "/patient/appointments", label: "Appointments" } };
  }
  if (/\bfollow/.test(question)) {
    return { topicId: "followups", text: `You have ${amount(facts.followUps, "follow-up")} still ahead.`, link: { href: "/patient/follow-ups", label: "Follow-ups" } };
  }
  if (/\bpayment/.test(question)) {
    return { topicId: "payments", text: `You have ${amount(facts.pendingPayments, "pending payment")}.`, link: { href: "/patient/payments", label: "Payments" } };
  }
  return {
    topicId: "dashboard",
    text: `You have ${amount(facts.upcoming, "upcoming appointment")}, ${amount(facts.followUps, "follow-up")} ahead, and ${amount(facts.pendingPayments, "pending payment")}.`,
    link: { href: "/patient", label: "Dashboard" },
  };
}

function doctorCounts(question: string, facts: DoctorGuideFacts | null): RoleTurn | null {
  if (!/\b(how many|total|count)\b/.test(question)) return null;
  if (/\b(all|every) patients?\b/.test(question)) return privilege("doctor", "every patient in the clinic");
  if (!facts) return { topicId: "dashboard", text: "I could not read your practice totals just now. Open your dashboard.", link: { href: "/doctor", label: "Dashboard" } };
  if (!facts.ready) {
    return { topicId: "profile", text: "Clinical totals stay hidden until an administrator approves your profile. You can still finish your professional profile and submit it.", link: { href: "/doctor/onboarding", label: "Professional profile" } };
  }
  if (/\b(appointment|booking|visit)/.test(question)) {
    return { topicId: "appointments", text: `You have ${amount(facts.today, "appointment")} today, and ${facts.pendingToday} of them still need attention.`, link: { href: "/doctor/appointments", label: "Appointments" } };
  }
  if (/\bpatient/.test(question)) {
    return { topicId: "patients", text: `You have ${amount(facts.activePatients, "patient")} with a visit that is still open. This is not every patient in the clinic.`, link: { href: "/doctor/patients", label: "Patients" } };
  }
  if (/\b(note|summary)/.test(question)) {
    return { topicId: "notes", text: `You have ${amount(facts.pendingNotes, "note")} still waiting.`, link: { href: "/doctor/notes", label: "Notes and Summaries" } };
  }
  return {
    topicId: "dashboard",
    text: `Today you have ${amount(facts.today, "appointment")} (${facts.pendingToday} still need attention), ${amount(facts.activePatients, "patient")} in your care, and ${amount(facts.pendingNotes, "note")} waiting.`,
    link: { href: "/doctor", label: "Dashboard" },
  };
}

function attention(audience: "patient" | "doctor", question: string, facts: PatientGuideFacts | DoctorGuideFacts | null): RoleTurn | null {
  if (!/\b(what should i do|what now|attention|waiting)\b/.test(question)) return null;
  if (audience === "patient") {
    const own = facts as PatientGuideFacts | null;
    if (!own) return { topicId: "dashboard", text: "Open your dashboard. It shows the next appointment, follow-ups, and your latest payment.", link: { href: "/patient", label: "Dashboard" } };
    if (own.pendingPayments > 0) return { topicId: "payments", text: `Start with Payments. ${amount(own.pendingPayments, "payment")} still pending on your visits.`, link: { href: "/patient/payments", label: "Payments" } };
    if (own.followUps > 0) return { topicId: "followups", text: `You have ${amount(own.followUps, "follow-up")} ahead. Open Follow-ups.`, link: { href: "/patient/follow-ups", label: "Follow-ups" } };
    return { topicId: "dashboard", text: `Nothing is waiting on a payment. You have ${amount(own.upcoming, "upcoming appointment")}.`, link: { href: "/patient", label: "Dashboard" } };
  }
  const own = facts as DoctorGuideFacts | null;
  if (!own) return { topicId: "dashboard", text: "Open your dashboard for today's schedule.", link: { href: "/doctor", label: "Dashboard" } };
  if (!own.ready) return { topicId: "profile", text: "Finish your professional profile and wait for an administrator to approve it. Clinical work stays closed until then.", link: { href: "/doctor/onboarding", label: "Professional profile" } };
  if (own.pendingNotes > 0) return { topicId: "notes", text: `Start with notes. ${amount(own.pendingNotes, "note")} still waiting on your visits.`, link: { href: "/doctor/notes", label: "Notes and Summaries" } };
  if (own.pendingToday > 0) return { topicId: "appointments", text: `${amount(own.pendingToday, "appointment")} today still need you. Open Appointments.`, link: { href: "/doctor/appointments", label: "Appointments" } };
  return { topicId: "dashboard", text: "Nothing in your own queue is waiting. Your dashboard shows today's schedule.", link: { href: "/doctor", label: "Dashboard" } };
}

function answer(audience: "patient" | "doctor", topics: Topic[], question: string, pathname: string): RoleTurn {
  const place = topicForPath(topics, pathname);
  if (/\b(sidebar|menu|tabs)\b/.test(question)) {
    return { topicId: null, text: `Your sidebar is ${topics.map((topic) => topic.title).join(", ")}. Ask what one of them lets you do.`, link: { href: place.href, label: place.title } };
  }
  const ranked = topics.map((topic) => ({ topic, score: scoreTopic(question, topic) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const predicted = !best || best.score < 5 ? predictGuideFeature(question, audience) : null;
  const learned = predicted ? topics.find((topic) => topic.id === predicted.featureId) : undefined;
  const topic = learned && (!best || best.score < 3 || learned.id !== best.topic.id) ? learned : best && best.score >= 3 ? best.topic : null;
  if (!topic) {
    const refusal =
      audience === "patient"
        ? "I can explain your own care only: booking, your appointments, screening that is already open, your payments, and summaries released to you."
        : "I can explain your own practice only: your appointments, your patients, your notes, and your hours.";
    return { topicId: place.id, text: `${refusal} You are on ${place.title}.`, link: { href: place.href, label: place.title } };
  }
  const steps = asksHowTo(question) ? stepLines(topic.how) : topic.how;
  return { topicId: topic.id, text: `${steps}\n\n${topic.limits}`, link: { href: topic.href, label: topic.title } };
}

export function patientPlace(pathname: string) {
  return topicForPath(PATIENT_TOPICS, pathname).title;
}

export function doctorPlace(pathname: string) {
  return topicForPath(DOCTOR_TOPICS, pathname).title;
}

export function patientOpening(place: string) {
  return `Hello. I can help with your own care: finding a doctor, your bookings, screening, payments, and summaries released to you. You are on ${place}.`;
}

export function doctorOpening(place: string) {
  return `Hello. I can help with your own practice: your appointments, your patients, your notes, and your hours. You are on ${place}.`;
}

export const PATIENT_STARTERS = ["How do I book a doctor?", "What is in the sidebar?", "Can I see my screening result?"];
export const DOCTOR_STARTERS = ["How do I start a consultation?", "Who can I see?", "How do I set my hours?"];

function greet(question: string) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(question);
}

export function chatWithPatient(input: { question: string; pathname: string; previousTopicId?: string | null; facts?: PatientGuideFacts | null }): RoleTurn {
  const question = normalize(input.question);
  const facts = input.facts ?? null;
  if (!question) return { topicId: null, text: patientOpening(patientPlace(input.pathname)), link: null };
  if (greet(question)) return { topicId: null, text: patientOpening(patientPlace(input.pathname)), link: null };
  const denied = privilege("patient", question);
  if (denied) return denied;
  const counted = patientCounts(question, facts);
  if (counted) return counted;
  const next = attention("patient", question, facts);
  if (next) return next;
  if (/^(please )?(take me|go|open|show me)\b/.test(question) && !/\bhow\b/.test(question)) {
    const reply = answer("patient", PATIENT_TOPICS, question, input.pathname);
    if (reply.link) return { ...reply, text: `Click to go to ${reply.link.label}.` };
  }
  return answer("patient", PATIENT_TOPICS, question, input.pathname);
}

export function chatWithDoctor(input: { question: string; pathname: string; previousTopicId?: string | null; facts?: DoctorGuideFacts | null }): RoleTurn {
  const question = normalize(input.question);
  const facts = input.facts ?? null;
  if (!question) return { topicId: null, text: doctorOpening(doctorPlace(input.pathname)), link: null };
  if (greet(question)) return { topicId: null, text: doctorOpening(doctorPlace(input.pathname)), link: null };
  const denied = privilege("doctor", question);
  if (denied) return denied;
  const counted = doctorCounts(question, facts);
  if (counted) return counted;
  const next = attention("doctor", question, facts);
  if (next) return next;
  if (/^(please )?(take me|go|open|show me)\b/.test(question) && !/\bhow\b/.test(question)) {
    const reply = answer("doctor", DOCTOR_TOPICS, question, input.pathname);
    if (reply.link) return { ...reply, text: `Click to go to ${reply.link.label}.` };
  }
  return answer("doctor", DOCTOR_TOPICS, question, input.pathname);
}
