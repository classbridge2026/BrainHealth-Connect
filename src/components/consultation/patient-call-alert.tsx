"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { declinedCallIds, rememberDeclinedCall } from "./declined-calls";
import { IncomingCallDialog } from "./incoming-call";
import { primeRingtone } from "./ringtone";

type IncomingCall = {
  appointmentId: string;
  callId: string;
  channel?: "audio" | "video";
  doctorName: string;
  doctorUserId?: string;
  doctorImageVersion?: string | null;
  when: string;
};

export function PatientCallAlert() {
  const pathname = usePathname();
  const router = useRouter();
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [declined, setDeclined] = useState<string[]>([]);
  const [joining, setJoining] = useState(false);
  const onConsultation = /\/patient\/appointments\/[^/]+\/consultation\/?$/.test(pathname);

  useEffect(() => {
    primeRingtone();
  }, []);

  useEffect(() => {
    if (onConsultation) return;
    let stop = false;
    async function look() {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/patient/consultation-calls", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { calls?: IncomingCall[] };
        if (stop) return;
        setCalls(Array.isArray(payload.calls) ? payload.calls : []);
        setDeclined(declinedCallIds());
      } catch {
        // The next check tries again.
      }
    }
    let timer = 0;
    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().finally(schedule);
      }, 15000);
    }
    void look().finally(schedule);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [onConsultation]);

  const call = calls.find((item) => !declined.includes(item.callId) && pathname !== `/patient/appointments/${item.appointmentId}/consultation`);
  if (!call) return null;

  function decline() {
    rememberDeclinedCall(call!.callId);
    setDeclined(declinedCallIds());
    void fetch(`/api/appointments/${call!.appointmentId}/consultation/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "decline", callId: call!.callId }),
    }).catch(() => undefined);
  }

  const channel = call.channel === "audio" ? "audio" : "video";

  return (
    <IncomingCallDialog
      channel={channel}
      doctorName={call.doctorName}
      doctorUserId={call.doctorUserId}
      doctorImageVersion={call.doctorImageVersion}
      error={null}
      joining={joining}
      when={call.when}
      onAccept={() => {
        setJoining(true);
        router.push(`/patient/appointments/${call.appointmentId}/consultation?accept=${channel}`);
      }}
      onDecline={decline}
    />
  );
}
