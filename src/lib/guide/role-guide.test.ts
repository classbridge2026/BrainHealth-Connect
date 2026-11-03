import { describe, expect, it } from "vitest";
import { chatWithDoctor, chatWithPatient } from "./role-guide";

const patientFacts = { upcoming: 1, followUps: 0, pendingPayments: 2 };
const doctorFacts = { ready: true, today: 3, pendingToday: 1, activePatients: 4, pendingNotes: 2, followUps: 1 };

describe("role guide", () => {
  it("tells a patient how to book and refuses administrator work", () => {
    const booked = chatWithPatient({ pathname: "/patient", question: "How do I book a doctor?" });
    expect(booked.text).toMatch(/1\. Click \*\*Find a Doctor\*\*/);
    expect(booked.text).toMatch(/2\. Click \*\*Book appointment\*\*/);
    expect(booked.link?.href).toBe("/patient/find");
    expect(booked.text).toMatch(/payment window/);
    const denied = chatWithPatient({ pathname: "/patient", question: "How do I grant an administrator?" });
    expect(denied.text).toMatch(/administrator task/);
    expect(denied.text).toMatch(/patient sign-in cannot/);
    const own = chatWithPatient({ pathname: "/patient", question: "How many appointments do I have?", facts: patientFacts });
    expect(own.text).toMatch(/1 upcoming appointment/);
    expect(own.text).not.toMatch(/Total Patients/);
    const others = chatWithPatient({ pathname: "/patient", question: "How many patients are in the portal?" });
    expect(others.text).toMatch(/does not count other patients/);
  });

  it("keeps a doctor inside their own practice", () => {
    const visit = chatWithDoctor({ pathname: "/doctor", question: "How do I start a consultation?" });
    expect(visit.text).toMatch(/1\. Click the booking, then click \*\*Approve\*\* or \*\*Decline\*\*/);
    expect(visit.text).toMatch(/2\. After you approve, click \*\*Open consultation\*\*/);
    expect(visit.text).toMatch(/3\. When the visit is finished, click \*\*End consultation\*\*/);
    expect(visit.text).toMatch(/marks the visit complete/);
    expect(visit.text).toMatch(/another doctor/);
    expect(visit.link?.href).toBe("/doctor/appointments");
    const people = chatWithDoctor({ pathname: "/doctor/patients", question: "Who can I see?" });
    expect(people.text).toMatch(/visit with you/);
    expect(people.text).not.toMatch(/hospital register is open/);
    const counted = chatWithDoctor({ pathname: "/doctor", question: "How many patients do I have?", facts: doctorFacts });
    expect(counted.text).toMatch(/4 patients/);
    expect(counted.text).toMatch(/not every patient/);
    const self = chatWithDoctor({ pathname: "/doctor", question: "How do I approve my profile?" });
    expect(self.text).toMatch(/stays with an administrator/);
    const closed = chatWithDoctor({
      pathname: "/doctor",
      question: "What should I do now?",
      facts: { ...doctorFacts, ready: false },
    });
    expect(closed.text).toMatch(/administrator to approve/);
    expect(closed.link?.href).toBe("/doctor/onboarding");
  });

  it("does not let either role answer something outside their portal", () => {
    const weather = chatWithPatient({ pathname: "/patient/payments", question: "What is the weather in Freetown?" });
    expect(weather.text).toMatch(/your own care only/);
    const settings = chatWithDoctor({ pathname: "/doctor", question: "Open platform settings" });
    expect(settings.text).toMatch(/administrator/);
  });
});
