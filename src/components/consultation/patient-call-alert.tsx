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
      if (document.visibilityState === "hidden") return false;
      const started = Date.now();
      try {
        const response = await fetch("/api/patient/consultation-calls", { cache: "no-store" });
        const slow = !response.ok || Date.now() - started > 2_000;
        if (!response.ok) return slow;
        const payload = (await response.json()) as { calls?: IncomingCall[] };
        if (stop) return slow;
        setCalls(Array.isArray(payload.calls) ? payload.calls : []);
        setDeclined(declinedCallIds());
        return slow;
      } catch {
        return true;
      }
    }
    let timer = 0;
    function schedule(delay: number) {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().then((slow) => {
          if (!stop) schedule(slow ? 30_000 : 15_000);
        });
      }, delay);
    }
    void look().then((slow) => {
      if (!stop) schedule(slow ? 30_000 : 15_000);
    });
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
